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
 * **A RESTRICTED key (`rk_…`) scoped to Products, Prices and Billing Portal is
 * all this needs.** A full `sk_` is a credential with far more reach than the
 * job, which is why the restricted one is preferred rather than merely
 * accepted.
 *
 * **It carries no entitlements, deliberately.** What a plan GRANTS lives in
 * `subscription_plans`; what it COSTS lives in Stripe. Putting seat counts here
 * would rebuild the two-sources-of-truth problem `billing.config.ts` exists to
 * prevent. The ids printed at the end are what seeds the table.
 */

import Stripe from 'stripe';

// ---------------------------------------------------------------------------
// REVIEW THESE BEFORE `--apply`. Amounts are in the currency's smallest unit.
// ---------------------------------------------------------------------------
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
      '         `Products`, `Prices` and `Billing Portal` is all this script needs.\n',
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

async function main() { // NOSONAR
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

  // -------------------------------------------------------------------------
  // The portal configuration
  // -------------------------------------------------------------------------
  const configs = await stripe.billingPortal.configurations.list({ limit: 10 });

  if (configs.data.length > 0) {
    say(
      `portal: ${configs.data.length} configuration(s) already exist — left alone.\n` +
        '        Verify subscription_update.enabled is FALSE before relying on\n' +
        '        the downgrade check: a plan change made in the portal reaches\n' +
        '        this system only AFTER Stripe has applied it.',
    );
  } else if (apply) {
    const config = await stripe.billingPortal.configurations.create({
      business_profile: { headline: 'Manage your SynapseDesk subscription' },
      features: {
        // FALSE on purpose. A plan change made in Stripe's portal reaches us as
        // `customer.subscription.updated` AFTER Stripe applied it, and todo 16.7
        // — block a downgrade that would put a tenant over the new plan's
        // limits — is only enforceable before that. Plan changes route through
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
    say(`portal: created ${config.id} with subscription_update DISABLED`);
  } else {
    say('portal: WOULD create one with subscription_update DISABLED');
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
