import PostalMime, { type Email } from 'postal-mime';

/**
 * The inbound-mail Worker — 31-doc §1, 32-doc §2.
 *
 * Cloudflare Email Routing hands this a raw RFC 5322 stream. It parses the
 * MIME, builds the JSON `POST /webhooks/email/inbound` is written against,
 * signs it, and posts it.
 *
 * **It lives in this repo rather than only in the Cloudflare dashboard.** A
 * signing secret and a payload contract that exist only in a web console are
 * undiscoverable, unreviewable and unversioned — and this payload is one half
 * of a contract whose other half is `InboundEmailDto`.
 *
 * **Outside `apps/` on purpose.** The npm workspaces are `apps/*` and `libs/*`,
 * so anything under them becomes a turbo build and lint target — and this is a
 * Workers runtime with different globals, no Nest, and no shared tsconfig.
 */

export type Env = {
  /** Where the gateway serves the webhook. */
  WEBHOOK_URL: string;
  /** Shared with the gateway. Must match `INBOUND_EMAIL_SECRET` exactly. */
  INBOUND_SECRET: string;
};

/** What Cloudflare passes to `email()`. Typed here to avoid a types dependency. */
type EmailMessage = {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream;
  setReject: (reason: string) => void;
};

export default {
  async email(message: EmailMessage, env: Env): Promise<void> {
    const parsed = await PostalMime.parse(message.raw);

    // **Serialise ONCE, sign that, send that** — 32-doc §2.
    //
    // Signing a re-serialised copy is the Stripe raw-body trap in a new
    // costume: key order or whitespace differs, the digest differs, and every
    // request fails in production while passing any test that builds its own
    // body. `body` is the only string that exists here for exactly that reason.
    const body = JSON.stringify(buildPayload(message, parsed));

    const response = await fetch(env.WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-inbound-signature': await hmacSha256(body, env.INBOUND_SECRET),
      },
      body,
    });

    // **Do not swallow this** — 32-doc §2. A Worker that catches and returns
    // success loses the mail; throwing makes Cloudflare retry, and the
    // gateway's `(organization_id, message_id)` dedup is what makes that retry
    // safe rather than duplicating a ticket.
    //
    // A 401 is the exception: the secret is wrong, and no number of retries
    // will fix it — so it is reported and not retried, which is why the
    // gateway answers 401 rather than 5xx for a bad signature.
    if (response.status === 401) {
      throw new Error(
        'The gateway rejected this Worker’s signature — INBOUND_SECRET does not match',
      );
    }

    if (!response.ok) {
      throw new Error(`The gateway answered ${response.status}`);
    }
  },
};

/**
 * The webhook payload — the other half of `InboundEmailDto`.
 *
 * **`text` and `html` are always PRESENT, possibly null.** The DTO requires the
 * keys and allows the values to be empty, because "no text part" and "the field
 * was forgotten" are different facts; omitting them is a 400.
 */
export function buildPayload(
  message: EmailMessage,
  parsed: Email,
): Record<string, unknown> {
  return {
    messageId: parsed.messageId ?? undefined,
    // The RECIPIENT as delivered, which is what carries the tenant token. The
    // parsed `To:` header can name something else entirely — a mailing list, or
    // the address a message was forwarded from.
    to: message.to,
    from: parsed.from?.address ?? message.from,
    fromName: parsed.from?.name || undefined,
    subject: parsed.subject ?? '',
    text: parsed.text ?? null,
    html: parsed.html ?? null,
    inReplyTo: parsed.inReplyTo ?? undefined,
    // **The message's own `Date`, which the gateway needs for idempotency** —
    // 31-doc §7. A message with no `Message-ID` is keyed on a digest of its own
    // properties, and `receivedAt` below cannot be one of them: this Worker is
    // re-run on failure, and each run stamps a new one.
    date: message.headers.get('date') ?? undefined,
    references: splitReferences(parsed.references),
    // **Only the two loop headers** — 32-doc §2. They are invisible once the
    // body is parsed, and they are what stop an auto-responder and this system
    // replying to each other forever. Read from the ENVELOPE headers rather
    // than the parsed set: Cloudflare gives them verbatim.
    headers: loopHeaders(message.headers),
    // Attachments are dropped here, deliberately (31-doc §5) — but their names
    // travel, so the ticket can say what was omitted rather than the message
    // arriving as though nothing was attached.
    droppedAttachments: parsed.attachments?.map(
      (attachment) => attachment.filename || 'unnamed attachment',
    ),
    receivedAt: new Date().toISOString(),
  };
}

/** `References` is one whitespace-separated string on the wire. */
function splitReferences(references: string | undefined): string[] | undefined {
  const ids = references?.trim().split(/\s+/).filter(Boolean);

  return ids?.length ? ids : undefined;
}

function loopHeaders(headers: Headers): Record<string, string> | undefined {
  const carried: Record<string, string> = {};

  for (const name of ['auto-submitted', 'precedence']) {
    const value = headers.get(name);
    if (value) carried[name] = value;
  }

  return Object.keys(carried).length ? carried : undefined;
}

/** HMAC-SHA256, hex — the same digest `verifyHmacSignature` computes. */
async function hmacSha256(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload),
  );

  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
