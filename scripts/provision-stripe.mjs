#!/usr/bin/env node
/**
 * Creates the Stripe side of the plan catalogue: one Product per plan, one
 * Price per billing interval, and one billing portal configuration.
 *
 * **Dry-run unless `--apply`.** Everything this writes is visible to customers
 * and none of it is trivially undone — a Price cannot be deleted once created,
 * only deactivated. An accidental run must therefore do nothing.
 *
 *   node scripts/provision-stripe.mjs             # report what it WOULD do
 *   node scripts/provision-stripe.mjs --apply     # actually create
 *
 * Reads `STRIPE_RESTRICT_KEY` from the repo-root `.env`, which is where it
 * lives: root `.env` is docker-compose's file and this script is the only other
 * thing run from the repo root. `STRIPE_SECRET_KEY` is the fallback and belongs
 * to auth-service, whose `ConfigModule` loads `apps/auth-service/.env`.
 *
 * **A RESTRICTED key (`rk_…`) scoped to Products, Prices, Billing Portal and
 * Webhook Endpoints (READ AND WRITE) is all this needs.** Read is not optional
 * even for a dry run: the webhook block LISTS before it decides, and a
 * write-only key fails there with Stripe's own `webhook_read` permission
 * error — measured. A full `sk_` is a credential with far more reach than the
 * job, which is why the restricted one is preferred rather than merely
 * accepted.
 *
 * **It carries no entitlements, deliberately.** What a plan GRANTS lives in
 * `subscription_plans`; what it COSTS lives in Stripe. Putting seat counts here
 * would rebuild the two-sources-of-truth problem `billing.config.ts` exists to
 * prevent. The ids printed at the end are what seeds the table.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/**
 * The event types the webhook endpoint is allowed to send, from the built lib.
 *
 * **Imported, not copied.** `entitlement-writer.service.ts` decides what to ACT
 * on; this script decides what Stripe may SEND, and a type the writer handles
 * that the endpoint never enables is a figure that reads as zero rather than as
 * missing — which is the whole of known-gaps #25.
 *
 * Requires `npm run build -w @synapsedesk/common` first, the same instruction
 * `scheduling.md` gives for `generate-job-alerts.mjs`: a stale `dist` silently
 * emits the old list.
 *
 * The `apiVersion` literal below is NOT imported, deliberately —
 * `stripe-api-version.spec.ts` reads this file as text and keeps the literal
 * equal to `STRIPE_API_VERSION`. An import would be invisible to that regex.
 */
const { STRIPE_ENTITLEMENT_EVENTS, STRIPE_DUNNING_EVENTS } = await import(
  join(ROOT, 'libs/common/dist/main.js')
);

// --------------------------------- REVIEW THESE BEFORE `--apply`. Amounts are in the currency's smallest unit.

const CURRENCY = 'usd';
const PLANS = [
  { key: 'starter', name: 'Starter', monthly: 4900, annual: 49000 },
  { key: 'pro', name: 'Professional', monthly: 19900, annual: 199000 },
  { key: 'enterprise', name: 'Enterprise', monthly: 99900, annual: 999000 },
];

/**
 * The idempotency key, on Product metadata rather than on the name.
 *
 * A name is editable in the Dashboard, so matching on it makes a rename look
 * like a missing product and produces a duplicate on the next run.
 */
const MARKER = 'synapsedesk_plan';

/** The same idea for the portal configuration and the webhook endpoint. */
const PORTAL_MARKER = 'synapsedesk_portal';
const WEBHOOK_MARKER = 'synapsedesk_webhook';

const apply = process.argv.includes('--apply');

// The repo-root `.env`, loaded here rather than left to the caller. Without it
// every invocation needs the key mapped onto `STRIPE_SECRET_KEY` by hand, which
// is a step that gets skipped or — worse — gets it from the wrong file.
//
// Anything already in the environment WINS: `loadEnvFile` does not overwrite,
// so `STRIPE_RESTRICT_KEY=… node scripts/provision-stripe.mjs` still works and
// CI needs no file at all.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // Absent is fine. The key may come from the environment directly, and the
  // check below is what actually decides.
}

const key = process.env.STRIPE_RESTRICT_KEY ?? process.env.STRIPE_SECRET_KEY;

if (!key) {
  console.error(
    'Neither STRIPE_RESTRICT_KEY nor STRIPE_SECRET_KEY is set. Refusing to guess.',
  );
  process.exit(1);
}
if (key.startsWith('sk_')) {
  console.warn(
    'WARNING: this is a full secret key. A restricted key (rk_) scoped to\n' +
      '         `Products`, `Prices`, `Billing Portal` and `Webhook Endpoints`\n' +
      '         (read and write) is all this script needs.\n',
  );
}

// **Which ACCOUNT this is about to touch, printed before it touches it.**
// A live key and a test key differ by four characters in a file nobody reads
// twice, and the same run against the wrong one creates customer-visible
// Products whose Prices cannot be deleted afterwards — only deactivated.
console.log(`mode: ${key.includes('_live_') ? 'LIVE' : 'TEST'}\n`);

// Pinned. This script creates exactly the objects whose shape moves between
// versions — Prices and the portal configuration's feature block — so inheriting
// whatever the account default happens to be is how a run stops matching the
// one that provisioned the last environment.
const stripe = new Stripe(key, { apiVersion: '2026-07-29.dahlia' });

// **Read back off the client, never repeated.** The webhook endpoint below is
// created with an `api_version` and this file must hold exactly ONE version
// literal — the one `stripe-api-version.spec.ts` extracts by regex and keeps
// equal to `STRIPE_API_VERSION`. A second copy here would be a second thing to
// keep in step, in the file whose whole job is not drifting.
const API_VERSION = stripe.getApiField('version');

const say = (line) => console.log(`${apply ? '' : '[dry-run] '}${line}`);

/**
 * Every product this script owns, by marker.
 *
 * **`list`, not `search`.** Stripe's Search API is eventually consistent, so a
 * product created moments ago may be absent from its results — which in an
 * idempotency check reads as "not created yet" and produces a second one. The
 * catalogue is small enough to page through.
 */
async function ownedProducts() {
  const owned = new Map();
  for await (const product of stripe.products.list({ limit: 100 })) {
    const marker = product.metadata?.[MARKER];
    if (marker) owned.set(marker, product);
  }
  return owned;
}

async function main() {
  const existing = await ownedProducts();
  say(`found ${existing.size} product(s) already carrying \`${MARKER}\``);

  const seed = [];

  for (const plan of PLANS) {
    let product = existing.get(plan.key);

    if (product) {
      say(`product ${plan.key}: exists (${product.id}) — left alone`);
    } else if (apply) {
      product = await stripe.products.create({
        name: plan.name,
        metadata: { [MARKER]: plan.key },
      });
      say(`product ${plan.key}: created ${product.id}`);
    } else {
      say(`product ${plan.key}: WOULD create`);
    }

    // One Product per plan, never one Product with three Prices for three
    // tiers: Checkout and invoices render the PRODUCT name on every line item,
    // so shared tiers are indistinguishable on a customer's receipt.
    const prices = product
      ? (await stripe.prices.list({ product: product.id, limit: 100 })).data
      : [];

    for (const interval of ['month', 'year']) {
      const amount = interval === 'month' ? plan.monthly : plan.annual;
      const found = prices.find(
        (price) =>
          price.active &&
          price.recurring?.interval === interval &&
          price.unit_amount === amount &&
          price.currency === CURRENCY,
      );

      if (found) {
        say(`  price ${plan.key}/${interval}: exists (${found.id})`);
        seed.push({ plan: plan.key, interval, priceId: found.id });
      } else if (apply && product) {
        const price = await stripe.prices.create({
          product: product.id,
          currency: CURRENCY,
          unit_amount: amount,
          recurring: { interval },
        });
        say(`  price ${plan.key}/${interval}: created ${price.id}`);
        seed.push({ plan: plan.key, interval, priceId: price.id });
      } else {
        say(
          `  price ${plan.key}/${interval}: WOULD create (${amount} ${CURRENCY})`,
        );
      }
    }
  }

  // ------------------------------------------------------------------------- The portal configuration

  // **`limit: 100`, matching `BillingService.portalConfiguration()`.** The two
  // read the same list for the same marker, and a page size that differs is a
  // way for the script to report a configuration the service cannot find.
  const configs = await stripe.billingPortal.configurations.list({
    limit: 100,
  });
  const ourConfig = configs.data.find((c) => c.metadata?.[PORTAL_MARKER]);
  const unmarked = configs.data.filter((c) => !c.metadata?.[PORTAL_MARKER]);

  if (unmarked.length > 0) {
    // Reported, never adopted — the same rule the Products block follows. A
    // configuration nobody created on purpose is not one to start relying on.
    say(
      `portal: ${unmarked.length} unmarked configuration(s) exist — left alone: ` +
        unmarked.map((c) => c.id).join(', '),
    );
  }

  if (ourConfig) {
    // **The flip this row exists for.** `subscription_update` back on means a
    // tenant can change plan inside Stripe's portal; the change reaches this
    // system as `customer.subscription.updated` AFTER Stripe applied it, so the
    // over-limit block in `POST /billing/plan` never runs. Reported in BOTH
    // modes — a provisioning run is the right place to notice it, and there is
    // nothing to "apply".
    if (ourConfig.features?.subscription_update?.enabled) {
      say(
        `portal: ${ourConfig.id} has subscription_update ENABLED — refusing.\n` +
          '        A plan change made in the portal bypasses the over-limit\n' +
          '        check in POST /billing/plan. Disable it in the Dashboard.',
      );
    } else {
      say(`portal: ${ourConfig.id} up to date (subscription_update disabled)`);
    }
  } else if (apply) {
    const config = await stripe.billingPortal.configurations.create({
      business_profile: { headline: 'Manage your SynapseDesk subscription' },
      // The marker, for the same reason Products carry one: this is the
      // configuration `BillingService.createPortalSession` resolves and passes
      // explicitly, so it has to be findable by something a Dashboard edit
      // cannot silently change.
      metadata: { [PORTAL_MARKER]: 'v1' },
      features: {
        // FALSE on purpose. A plan change made in Stripe's portal reaches us as
        // `customer.subscription.updated` AFTER Stripe applied it, and the
        // downgrade block — refusing a change that would put a tenant over the
        // new plan's limits — is only enforceable before that. Plan changes route through
        // our own UI; the portal keeps what it is better at.
        subscription_update: { enabled: false },
        subscription_cancel: { enabled: true, mode: 'at_period_end' },
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        customer_update: {
          enabled: true,
          allowed_updates: ['email', 'address'],
        },
      },
    });
    say(
      `portal: created ${config.id} with subscription_update DISABLED and marker ${PORTAL_MARKER}`,
    );
  } else {
    say('portal: WOULD create one with subscription_update DISABLED');
  }

  // ------------------------------------------- The webhook endpoint

  // **What Stripe is allowed to SEND.** `billing_events` counts what arrives,
  // and what arrives is `enabled_events` on the endpoint — configured by hand
  // in the Dashboard, or by `stripe listen`, or not at all. "No cancellations
  // this month" and "cancellations were never enabled" render identically on
  // `GET /platform/finance/events`. known-gaps #25.
  const webhookUrl = process.env.STRIPE_WEBHOOK_URL;

  if (!webhookUrl) {
    say(
      'webhook: STRIPE_WEBHOOK_URL is not set — skipped.\n' +
        '         Set it to the PUBLIC gateway origin plus /api/v1/webhooks/stripe.',
    );
  } else {
    const enabledEvents = [
      ...STRIPE_ENTITLEMENT_EVENTS,
      ...STRIPE_DUNNING_EVENTS,
    ];
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const ours = endpoints.data.find((e) => e.metadata?.[WEBHOOK_MARKER]);
    const strays = endpoints.data.filter(
      (e) => !e.metadata?.[WEBHOOK_MARKER] && e.url === webhookUrl,
    );

    for (const stray of strays) {
      // Adopting an endpoint nobody created on purpose is how a second producer
      // appears — two endpoints on one URL, each with its own secret and its
      // own event list.
      say(
        `webhook: ${stray.id} points at this URL and carries no marker — refusing to adopt.\n` +
          '         Delete it, or add the marker by hand if it is really ours.',
      );
    }

    if (!ours) {
      if (apply) {
        const endpoint = await stripe.webhookEndpoints.create({
          url: webhookUrl,
          enabled_events: enabledEvents,
          // The same version the client pins. The endpoint decides the payload
          // SHAPE it sends, and `EntitlementWriterService` parses it — two
          // versions across that boundary is a field that is simply missing.
          api_version: API_VERSION,
          description: 'SynapseDesk — created by provision-stripe.mjs',
          metadata: { [WEBHOOK_MARKER]: 'v1' },
        });

        console.log(
          `webhook: created ${endpoint.id} with ${enabledEvents.length} event type(s)\n\n` +
            `  STRIPE_WEBHOOK_SECRET = ${endpoint.secret}\n\n` +
            '  ^ Put this in apps/auth-service/.env NOW. Stripe returns the\n' +
            '    signing secret ONLY at creation — it is not readable later,\n' +
            '    and losing it means deleting this endpoint and making another.\n',
        );
      } else {
        say(
          `webhook: WOULD create ${webhookUrl} with ${enabledEvents.length} event type(s):\n` +
            `         ${enabledEvents.join(', ')}`,
        );
      }
    } else {
      const missing = enabledEvents.filter(
        (type) => !ours.enabled_events.includes(type),
      );
      const extra = ours.enabled_events.filter(
        (type) => !enabledEvents.includes(type),
      );

      if (missing.length > 0 || extra.length > 0) {
        // **The row's actual failure mode**: a type added to the writer and
        // never enabled on the endpoint. `enabled_events` is the one field that
        // drifts and the one this script can repair.
        if (apply) {
          await stripe.webhookEndpoints.update(ours.id, {
            enabled_events: enabledEvents,
          });
          say(`webhook: ${ours.id} enabled_events updated`);
        } else {
          say(
            `webhook: ${ours.id} WOULD update enabled_events\n` +
              (missing.length ? `         + ${missing.join(', ')}\n` : '') +
              (extra.length ? `         - ${extra.join(', ')}` : ''),
          );
        }
      }

      // **Reported, never repaired.** `WebhookEndpointUpdateParams` is
      // description / disabled / enabled_events / metadata / url — there is no
      // `api_version`, so it is settable at creation only. Comparing
      // `enabled_events` alone would print "up to date" while the endpoint sent
      // an older payload shape than the writer parses: the same silent-zero
      // shape as the row itself, one field over.
      if (ours.api_version !== API_VERSION) {
        say(
          `webhook: ${ours.id} sends api_version ${ours.api_version ?? 'account default'}, ` +
            `this build expects ${API_VERSION}.\n` +
            '         It CANNOT be updated — Stripe allows it only at creation.\n' +
            '         Fixing it means deleting this endpoint and creating another,\n' +
            '         which issues a NEW signing secret: rotate STRIPE_WEBHOOK_SECRET\n' +
            '         in the same step. Left alone; this is your call.',
        );
      } else if (missing.length === 0 && extra.length === 0) {
        say(
          `webhook: ${ours.id} up to date (${enabledEvents.length} event type(s))`,
        );
      }
    }
  }

  if (seed.length > 0) {
    console.log('\nSeed `subscription_plan_prices` with:\n');
    console.table(seed);
  }

  if (!apply) {
    console.log(
      '\nNothing was written. Re-run with --apply once the amounts above are right.',
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(`Provisioning failed: ${error.message}`);
  process.exit(1);
}
