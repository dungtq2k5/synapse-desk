#!/usr/bin/env node
/**
 * Creates the Resend side of inbound email: one webhook, subscribed to
 * `email.received`, pointed at the gateway's public route.
 *
 * **Dry-run unless `--apply`.** The webhook decides what mail this system
 * receives, so an accidental run must do nothing.
 *
 *   node scripts/provision-resend.mjs                   # report what it WOULD do
 *   node scripts/provision-resend.mjs --apply           # create, or repair its event list
 *   node scripts/provision-resend.mjs --print-secret    # read the signing secret back
 *
 * Reads `RESEND_PROVISION_KEY` and `RESEND_WEBHOOK_URL` from the repo-root
 * `.env`; anything already in the environment wins. The key must be
 * **full-access** — webhooks are not a sending endpoint, and a sending-only key
 * answers `401 restricted_api_key`.
 *
 * **The signing secret is not once-only.** Resend returns it on create AND on
 * `webhooks.get`, so a lost secret is read back with `--print-secret`, never
 * fixed by deleting the webhook. It is printed only on create or when asked:
 * a routine re-run should not put a credential in a terminal's scrollback.
 *
 * **Matched by URL.** The webhook whose `endpoint` equals `RESEND_WEBHOOK_URL`
 * is ours; a second one on the same URL is reported and left alone, because
 * two webhooks on one URL deliver every mail twice under two secrets.
 */

import { Resend } from 'resend';

/** What the gateway handles. A type added here needs a branch in `ResendInboundService`. */
const EVENTS = ['email.received'];

const apply = process.argv.includes('--apply');
const printSecret = process.argv.includes('--print-secret');

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // Absent is fine: the values may come from the environment, and the checks
  // below are what decide.
}

const key = process.env.RESEND_PROVISION_KEY;
const webhookUrl = process.env.RESEND_WEBHOOK_URL;

if (!key?.startsWith('re_')) {
  console.error(
    'RESEND_PROVISION_KEY is not set to a re_ key. Refusing to guess.',
  );
  process.exit(1);
}
if (!webhookUrl) {
  console.error(
    'RESEND_WEBHOOK_URL is not set. Set it to the PUBLIC gateway origin plus /api/v1/webhooks/email/resend.',
  );
  process.exit(1);
}

const say = (line) => console.log(`${apply ? '' : '[dry-run] '}${line}`);

/** Unwraps the SDK's `{ data, error }`; the SDK does not throw for API errors. */
function unwrap({ data, error }, action) {
  if (error) {
    throw new Error(
      `${action}: ${error.name} (${error.statusCode ?? 'no status'}) ${error.message}`,
    );
  }
  return data;
}

async function main() {
  const resend = new Resend(key);
  const webhooks = unwrap(
    await resend.webhooks.list({ limit: 100 }),
    'list webhooks',
  );
  const matching = webhooks.data.filter(
    (webhook) => webhook.endpoint === webhookUrl,
  );

  if (matching.length > 1) {
    say(
      `webhook: ${matching.length} webhooks point at ${webhookUrl} (${matching.map((w) => w.id).join(', ')}).\n` +
        '         Every mail is delivered once per webhook, each under its own secret.\n' +
        '         Delete all but one in the Resend dashboard, then re-run. Nothing changed.',
    );
    return;
  }

  const [ours] = matching;

  if (!ours) {
    if (!apply) {
      say(`webhook: WOULD create ${webhookUrl} for ${EVENTS.join(', ')}`);
      console.log('\nNothing was written. Re-run with --apply.');
      return;
    }

    const created = unwrap(
      await resend.webhooks.create({ endpoint: webhookUrl, events: EVENTS }),
      'create webhook',
    );
    console.log(
      `webhook: created ${created.id} for ${EVENTS.join(', ')}\n\n` +
        `  RESEND_WEBHOOK_SECRET = ${created.signing_secret}\n\n` +
        '  ^ Put this in apps/api-gateway/.env. It can be read back later with\n' +
        '    `node scripts/provision-resend.mjs --print-secret`.\n',
    );
    return;
  }

  const current = ours.events ?? [];
  const missing = EVENTS.filter((type) => !current.includes(type));
  const extra = current.filter((type) => !EVENTS.includes(type));

  if (missing.length > 0 || extra.length > 0) {
    if (apply) {
      unwrap(
        await resend.webhooks.update(ours.id, { events: EVENTS }),
        'update webhook',
      );
      say(`webhook: ${ours.id} events updated to ${EVENTS.join(', ')}`);
    } else {
      say(
        `webhook: ${ours.id} WOULD update its events\n` +
          (missing.length ? `         + ${missing.join(', ')}\n` : '') +
          (extra.length ? `         - ${extra.join(', ')}` : ''),
      );
    }
  } else {
    say(`webhook: ${ours.id} up to date (${EVENTS.join(', ')})`);
  }

  if (ours.status !== 'enabled') {
    // Reported, not repaired: a disabled webhook may have been disabled on
    // purpose, and re-enabling it starts mail flowing.
    say(
      `webhook: ${ours.id} is ${ours.status} — enable it in the dashboard to receive mail.`,
    );
  }

  if (printSecret) {
    const detail = unwrap(await resend.webhooks.get(ours.id), 'read webhook');
    console.log(`\n  RESEND_WEBHOOK_SECRET = ${detail.signing_secret}\n`);
  }

  if (!apply && (missing.length > 0 || extra.length > 0)) {
    console.log('\nNothing was written. Re-run with --apply.');
  }
}

try {
  await main();
} catch (error) {
  console.error(`Provisioning failed: ${error.message}`);
  process.exit(1);
}
