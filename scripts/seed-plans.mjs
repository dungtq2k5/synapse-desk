/**
 * @file Seeds `subscription_plans` from the Products this environment's Stripe
 * account actually holds.
 *
 * The catalogue is a TABLE, and its Stripe ids differ per environment: the test
 * account's `price_1Ox…` is not the live one's. So the ids are READ from Stripe
 * rather than written down here, and only the GRANTS live in this file.
 *
 * **Dry-run unless `--apply`.** Prints exactly what it would write.
 *
 *   node scripts/seed-plans.mjs              # show the plan
 *   node scripts/seed-plans.mjs --apply      # write it
 *
 * Run `provision-stripe.mjs --apply` first: without Products carrying the
 * `synapsedesk_plan` marker there is nothing to seed from, and this script says
 * so rather than inventing ids.
 */

import Stripe from 'stripe';
import { Client } from 'pg';

// ---------------------------------------------------------------------------
// REVIEW THESE BEFORE `--apply`. They are what every subscriber gets.
//
// Keyed by the Product metadata marker `provision-stripe.mjs` writes, NOT by
// name: a name is editable in the Dashboard, and matching on it makes a rename
// look like a missing plan.
// ---------------------------------------------------------------------------
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/**
 * A 5/25/100 MB document ladder is a visible one; 2/5/10 MB is the narrow one
 * attachments allow — the
 * platform ceiling there is 10 MB because the gRPC message limit binds, not
 * because anyone chose it as policy.
 *
 * Neither may exceed its platform constant. `MAX_DOCUMENT_BYTES` (100 MB) and
 * `MAX_ATTACHMENT_BYTES` (10 MB) are arguments to `min()` at every enforcement
 * point, so a larger number here does not sell anything — it just goes stale.
 */
const GRANTS = {
  starter: {
    maxAgentSeats: 5,
    maxStorageBytes: 5 * GIB,
    monthlyAiTokenBudget: 1_000_000,
    aiModelTier: 'FAST',
    maxDocumentBytes: 5 * MIB,
    maxAttachmentBytes: 2 * MIB,
    maxDocumentUploads: 1_000,
    maxAnalyticsRangeDays: 30,
  },
  pro: {
    maxAgentSeats: 25,
    maxStorageBytes: 50 * GIB,
    monthlyAiTokenBudget: 10_000_000,
    aiModelTier: 'QUALITY',
    maxDocumentBytes: 25 * MIB,
    maxAttachmentBytes: 5 * MIB,
    maxDocumentUploads: 10_000,
    maxAnalyticsRangeDays: 180,
  },
  enterprise: {
    maxAgentSeats: 200,
    maxStorageBytes: 500 * GIB,
    monthlyAiTokenBudget: 100_000_000,
    aiModelTier: 'QUALITY',
    maxDocumentBytes: 100 * MIB,
    maxAttachmentBytes: 10 * MIB,
    maxDocumentUploads: 100_000,
    maxAnalyticsRangeDays: 400,
  },
};

const MARKER = 'synapsedesk_plan';
const apply = process.argv.includes('--apply');

// The root `.env` holds the Stripe key; auth-service's holds the database it
// writes to. Both, because this script is the one place the two meet.
for (const file of ['../.env', '../apps/auth-service/.env']) {
  try {
    process.loadEnvFile(new URL(file, import.meta.url));
  } catch {
    // Absent is fine — the checks below decide.
  }
}

const key = process.env.STRIPE_RESTRICT_KEY ?? process.env.STRIPE_SECRET_KEY;
const databaseUrl = process.env.DATABASE_URL;

if (!key) {
  console.error('No Stripe key (STRIPE_RESTRICT_KEY / STRIPE_SECRET_KEY).');
  process.exit(1);
}
if (!databaseUrl) {
  console.error('No DATABASE_URL. Refusing to guess which database to seed.');
  process.exit(1);
}

// Which ACCOUNT and which DATABASE, printed before either is touched. A live
// key and a test key differ by four characters in a file nobody reads twice.
const mode = key.includes('_live_') ? 'LIVE' : 'TEST';
console.log(`stripe:   ${mode}`);
console.log(`database: ${databaseUrl.replace(/:[^:@/]*@/, ':***@')}\n`);

if (mode === 'LIVE' && apply) {
  console.warn(
    'WARNING: seeding from the LIVE account. The grants above become what\n' +
      '         paying customers get on their next webhook.\n',
  );
}

const stripe = new Stripe(key, { apiVersion: '2026-07-29.dahlia' });
const say = (line) => console.log(`${apply ? '' : '[dry-run] '}${line}`);

const products = await stripe.products.list({ limit: 100, active: true });
const mine = products.data.filter((product) => product.metadata?.[MARKER]);

if (mine.length === 0) {
  console.error(
    `No Products carry the \`${MARKER}\` marker in this ${mode} account.\n` +
      'Run `node scripts/provision-stripe.mjs --apply` first.',
  );
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();

// **One transaction, for one specific failure rather than general safety.**
//
// The loop writes a plan and THEN its prices. Interrupted between the two — a
// dropped connection, a Ctrl-C, a Stripe call that throws on the next product —
// it leaves a plan row with no price: a catalogue entry nothing can subscribe
// to, and the idempotent re-run FINDS it by `stripe_product_id` and updates it
// in place, so the missing prices are never noticed. That is the one state a
// re-run cannot repair, which is what makes the transaction worth the two lines.
await client.query('BEGIN');

try {
  for (const product of mine) {
    const planKey = product.metadata[MARKER];
    const grants = GRANTS[planKey];

    if (!grants) {
      // Loud, and it does NOT fall back to the cheapest plan: granting
      // entitlements for a product nobody mapped is the one wrong direction.
      console.error(
        `SKIPPED ${product.name}: marker '${planKey}' has no grants in this script.`,
      );
      continue;
    }

    const prices = await stripe.prices.list({
      product: product.id,
      limit: 100,
      active: true,
    });

    say(
      `plan ${product.name} (${product.id}) — ${grants.maxAgentSeats} seats, ` +
        `${grants.maxStorageBytes / GIB} GiB, ${grants.aiModelTier}, ` +
        `doc ${grants.maxDocumentBytes / MIB} MB, att ${grants.maxAttachmentBytes / MIB} MB, ` +
        `${grants.maxDocumentUploads} docs, ${grants.maxAnalyticsRangeDays}d history`,
    );

    for (const price of prices.data) {
      say(`  price ${price.id} (${price.recurring?.interval ?? 'one-time'})`);
    }

    if (!apply) continue;

    // Keyed on `stripe_product_id`, which is UNIQUE: re-running updates the
    // grants rather than creating a second row for the same Product.
    const { rows } = await client.query(
      `INSERT INTO subscription_plans
         (name, stripe_product_id, max_agent_seats, max_storage_bytes,
          monthly_ai_token_budget, ai_model_tier, max_document_bytes,
          max_attachment_bytes, max_document_uploads, max_analytics_range_days,
          is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, now())
       ON CONFLICT (stripe_product_id) DO UPDATE SET
         name = EXCLUDED.name,
         max_agent_seats = EXCLUDED.max_agent_seats,
         max_storage_bytes = EXCLUDED.max_storage_bytes,
         monthly_ai_token_budget = EXCLUDED.monthly_ai_token_budget,
         ai_model_tier = EXCLUDED.ai_model_tier,
         max_document_bytes = EXCLUDED.max_document_bytes,
         max_attachment_bytes = EXCLUDED.max_attachment_bytes,
         max_document_uploads = EXCLUDED.max_document_uploads,
         max_analytics_range_days = EXCLUDED.max_analytics_range_days,
         updated_at = now()
       RETURNING id`,
      [
        product.name,
        product.id,
        grants.maxAgentSeats,
        grants.maxStorageBytes,
        grants.monthlyAiTokenBudget,
        grants.aiModelTier,
        grants.maxDocumentBytes,
        grants.maxAttachmentBytes,
        grants.maxDocumentUploads,
        grants.maxAnalyticsRangeDays,
      ],
    );

    const planId = rows[0].id;

    for (const price of prices.data) {
      await client.query(
        `INSERT INTO subscription_plan_prices
           (plan_id, stripe_price_id, interval)
         VALUES ($1, $2, $3)
         ON CONFLICT (stripe_price_id) DO UPDATE SET
           plan_id = EXCLUDED.plan_id,
           interval = EXCLUDED.interval`,
        [planId, price.id, price.recurring?.interval ?? 'month'],
      );
    }
  }

  await client.query('COMMIT');

  if (apply) {
    console.log(
      '\nSeeded. Existing subscribers are UNCHANGED: a catalogue write is not\n' +
        'an apply. Use POST /platform/plans/:id/apply?dryRun=true to see the\n' +
        'blast radius, then apply it.',
    );
  } else {
    console.log('\nNothing written. Re-run with --apply.');
  }
} catch (error) {
  // Nothing half-written survives. A partial catalogue is worse than none: the
  // re-run would treat it as already seeded.
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
