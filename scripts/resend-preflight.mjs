#!/usr/bin/env node
/**
 * Reads what a real Resend account returns for inbound mail — the facts the
 * inbound adapter is written to degrade around until they are measured.
 *
 * **Read-only.** Nothing here sends, creates or changes anything. It prints
 * key NAMES, shapes, hosts and status codes — never a header VALUE from a
 * received mail and never a signed URL's query string.
 *
 *   node scripts/resend-preflight.mjs --inbound [--id <email_id>]       # loop headers, received_for, from, message_id
 *   node scripts/resend-preflight.mjs --attachments [--id <email_id>]   # download_url host and redirects, expiry, types
 *
 * Without `--id`, the newest received mail is used. Reads `RESEND_PROVISION_KEY`
 * from the repo-root `.env`, as `provision-resend.mjs` does; anything already in
 * the environment wins, so `RESEND_PROVISION_KEY=re_… node …` probes another key
 * (a sending-only one, to learn whether `receiving.get` refuses it).
 */

import { request as httpsRequest } from 'node:https';
import { Resend } from 'resend';

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // Absent is fine; the check below decides.
}

const key = process.env.RESEND_PROVISION_KEY;
if (!key?.startsWith('re_')) {
  console.error('RESEND_PROVISION_KEY is not set to a re_ key.');
  process.exit(1);
}
if (!args.includes('--inbound') && !args.includes('--attachments')) {
  console.error(
    'Pass --inbound or --attachments (see the header of this file).',
  );
  process.exit(1);
}

const resend = new Resend(key);
const shape = (value) =>
  value == null
    ? String(value)
    : Array.isArray(value) // NOSONAR
      ? `array(${value.length})`
      : typeof value;

/** The SDK returns `{ data, error }`; an error ends the run with its name and status. */
function unwrap({ data, error }, action) {
  if (error) {
    console.error(
      `${action}: ${error.name} (${error.statusCode ?? 'no status'})`,
    );
    process.exit(1);
  }
  return data;
}

/** The newest received mail's id, or the one given with `--id`. */
async function emailId() {
  const given = option('--id');
  if (given) return given;

  const list = unwrap(
    await resend.emails.receiving.list({ limit: 1 }),
    'list received mail',
  );
  const newest = list.data?.[0]?.id;
  if (!newest) {
    console.log(
      'No received mail yet. Send one to the receiving address and re-run.',
    );
    process.exit(0);
  }
  return newest;
}

/** `https://host/path?…` → `https://host/path` — the query string is the signature. */
const withoutQuery = (url) => `${url.protocol}//${url.host}${url.pathname}`;

/**
 * A one-byte GET, following redirects by hand so each hop is reported.
 *
 * GET with `Range: bytes=0-0`, not HEAD: presigned object-store URLs are often
 * signed for GET only and answer HEAD with 403 — a failure the fetcher never sees.
 */
function oneByteGet(url, hops = []) {
  return new Promise((resolve) => {
    const req = httpsRequest(
      url,
      { method: 'GET', headers: { range: 'bytes=0-0' }, timeout: 15_000 },
      (res) => {
        res.resume();
        const hop = {
          url: withoutQuery(url),
          status: res.statusCode,
          contentType: res.headers['content-type'],
        };
        const location = res.headers.location;
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          location &&
          hops.length < 5
        ) {
          resolve(oneByteGet(new URL(location, url), [...hops, hop]));
        } else {
          resolve([...hops, hop]);
        }
      },
    );
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', (error) =>
      resolve([...hops, { url: withoutQuery(url), error: error.message }]),
    );
    req.end();
  });
}

// ---------------------------------------------------------------- --inbound

if (args.includes('--inbound')) {
  const id = await emailId();
  const mail = unwrap(
    await resend.emails.receiving.get(id),
    `get received mail ${id}`,
  );
  const headerKeys = Object.keys(mail.headers ?? {});

  console.log(`== received mail ${id} ==`);
  console.log(`top-level fields: ${Object.keys(mail).join(', ')}`);
  console.log(`headers: ${shape(mail.headers)} with ${headerKeys.length} keys`);
  for (const name of [
    'message-id',
    'in-reply-to',
    'references',
    'date',
    'auto-submitted',
    'precedence',
  ]) {
    const found = headerKeys.find((header) => header.toLowerCase() === name);
    console.log(
      `  ${name.padEnd(15)} ${found ? `present (as '${found}')` : 'absent'}`, // NOSONAR
    );
  }
  console.log(
    `received_for: ${shape(mail.received_for)}; to: ${shape(mail.to)}; cc: ${shape(mail.cc)}; bcc: ${shape(mail.bcc)}`,
  );
  console.log(
    `from carries a display name: ${String(mail.from).includes('<')}`,
  );
  console.log(
    `message_id: ${shape(mail.message_id)}, angle brackets: ${/^<.*>$/.test(mail.message_id ?? '')}`,
  );
  console.log(
    `created_at format: ${String(mail.created_at).replace(/\d/g, '9')}`,
  );
}

// ---------------------------------------------------------------- --attachments

if (args.includes('--attachments')) {
  const id = await emailId();
  const listed = unwrap(
    await resend.emails.receiving.attachments.list({ emailId: id, limit: 100 }),
    `list attachments of ${id}`,
  );

  console.log(`== attachments of ${id} ==`);
  console.log(`count: ${listed.data.length}, has_more: ${listed.has_more}`);

  for (const attachment of listed.data) {
    const expiresIn = Math.round(
      (new Date(attachment.expires_at).getTime() - Date.now()) / 1000,
    );
    console.log(`\n- ${attachment.id}`);
    console.log(
      `  content_type: '${attachment.content_type}' (parameters: ${attachment.content_type.includes(';')})`,
    );
    console.log(
      `  filename present: ${attachment.filename != null}; size: ${attachment.size}; disposition: ${attachment.content_disposition}; content_id: ${attachment.content_id != null}`,
    );
    console.log(`  expires_at − now: ${expiresIn}s`);

    const url = new URL(attachment.download_url);
    console.log(
      `  download_url: scheme ${url.protocol} host ${url.host}, ${attachment.download_url.length} chars`,
    );
    for (const [index, hop] of (await oneByteGet(url)).entries()) {
      console.log(
        `  hop ${index}: ${hop.url} → ${hop.error ? `error: ${hop.error}` : `${hop.status} ${hop.contentType ?? ''}`}`, // NOSONAR
      );
    }
  }
}
