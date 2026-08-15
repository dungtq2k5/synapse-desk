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

import PostalMime, { type Email } from 'postal-mime';

export type Env = {
  /** Where the gateway serves the webhook. */
  WEBHOOK_URL: string;
  /**
   * Where the gateway presigns attachment uploads — 31-doc §5.
   *
   * A sibling of `WEBHOOK_URL` rather than derived from it: deriving would
   * assume the two always share a prefix, and a deployment that serves them
   * from different hosts would fail at runtime with a 404 nobody could read.
   */
  ATTACHMENTS_URL: string;
  /** Shared with the gateway. Must match `INBOUND_EMAIL_SECRET` exactly. */
  INBOUND_SECRET: string;
};

/** One file the gateway agreed to store, and where to PUT it. */
type PresignedUpload = {
  fileName: string;
  uploadUrl: string;
  objectPath: string;
};

type PresignResponse = {
  data?: {
    uploads?: PresignedUpload[];
    declined?: { fileName: string; reason: string }[];
  };
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

    // **The attachments go to storage BEFORE the webhook** — 31-doc §5.
    //
    // The bytes travel from here straight to the bucket and never reach an
    // application server, which is the property the presign flow exists to
    // hold. Uploading them through the webhook would make that route the one
    // place in the system accepting arbitrary file bytes from an
    // unauthenticated sender.
    //
    // **Never fatal.** A mail whose attachments cannot be stored is still a
    // mail: the names fall through to `droppedAttachments` and the ticket says
    // what was left out, which is what happened to every attachment before
    // this existed.
    const { uploaded, dropped } = await uploadAttachments(message, parsed, env);

    // **Serialize ONCE, sign that, send that** — 32-doc §2.
    //
    // Signing a re-serialized copy is the Stripe raw-body trap in a new
    // costume: key order or whitespace differs, the digest differs, and every
    // request fails in production while passing any test that builds its own
    // body. `body` is the only string that exists here for exactly that reason.
    const body = JSON.stringify(
      buildPayload(message, parsed, uploaded, dropped),
    );

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
  uploaded: PresignedUpload[] = [],
  dropped: string[] = [],
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
    // **What the gateway agreed to store**, already in the bucket — 31-doc §5.
    // Only paths travel; the bytes went direct.
    attachments: uploaded.map(({ objectPath, fileName }) => ({
      objectPath,
      fileName,
    })),
    // And what it would not, by name — the ineligible, the oversized, and
    // everything on a mail that opens a NEW ticket, which has no message to
    // attach to. The ticket says what was omitted rather than the message
    // arriving as though nothing had been sent.
    droppedAttachments: dropped.length ? dropped : undefined,
    receivedAt: new Date().toISOString(),
  };
}

/**
 * Presigns, PUTs, and reports what did not make it — 31-doc §5.
 *
 * **The gateway decides eligibility, not this Worker.** It is told which files
 * it may store and where; the allowlist, the size cap and the per-message
 * ceiling stay in one place. A copy of that policy here is a copy that drifts
 * from the one storage-service actually enforces.
 *
 * **A name is never lost.** Anything not uploaded — declined by the gateway, or
 * a PUT that failed — comes back in `dropped`, which becomes the ticket's
 * "attachments were not accepted" note.
 */
async function uploadAttachments(
  message: EmailMessage,
  parsed: Email,
  env: Env,
): Promise<{ uploaded: PresignedUpload[]; dropped: string[] }> {
  const attachments = parsed.attachments ?? [];
  if (!attachments.length) return { uploaded: [], dropped: [] };

  const named = attachments.map((attachment, index) => ({
    attachment,
    fileName: attachment.filename || `attachment-${index + 1}`,
  }));

  let response: PresignResponse;
  try {
    const request = JSON.stringify({
      // The same routing facts the webhook is about to carry, because the
      // gateway has to resolve the SAME ticket twice — it owns the reply
      // token's MAC and the tenant lookup, and this Worker cannot do either.
      to: message.to,
      from: parsed.from?.address ?? message.from,
      fromName: parsed.from?.name || undefined,
      inReplyTo: parsed.inReplyTo ?? undefined,
      references: splitReferences(parsed.references),
      files: named.map(({ attachment, fileName }) => ({
        fileName,
        mimeType: attachment.mimeType,
        sizeBytes: byteLength(attachment.content),
      })),
    });

    const presign = await fetch(env.ATTACHMENTS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-inbound-signature': await hmacSha256(request, env.INBOUND_SECRET),
      },
      body: request,
    });

    // **Not thrown.** The mail matters more than its attachments: a gateway
    // that cannot presign right now must not stop the message being delivered,
    // and the names still travel.
    if (!presign.ok) {
      return { uploaded: [], dropped: named.map((file) => file.fileName) };
    }

    response = (await presign.json()) as PresignResponse;
  } catch {
    return { uploaded: [], dropped: named.map((file) => file.fileName) };
  }

  const allowed = response.data?.uploads ?? [];
  const dropped = (response.data?.declined ?? []).map((file) => file.fileName);
  const uploaded: PresignedUpload[] = [];

  for (const upload of allowed) {
    const source = named.find((file) => file.fileName === upload.fileName);
    if (!source) continue;

    try {
      const put = await fetch(upload.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': source.attachment.mimeType },
        body: source.attachment.content,
      });

      if (put.ok) {
        uploaded.push(upload);
      } else {
        // Presigned but never landed. The gateway confirms every path as it
        // writes the message, so sending this one would produce a named skip
        // there — reporting it here says the same thing one hop earlier.
        dropped.push(upload.fileName);
      }
    } catch {
      dropped.push(upload.fileName);
    }
  }

  return { uploaded, dropped };
}

/**
 * The size the gateway checks against the cap.
 *
 * `postal-mime` types `content` three ways — a string for text parts, and
 * either an `ArrayBuffer` or a `Uint8Array` for binary ones depending on how it
 * decoded them. All three have a length; only the string's needs encoding
 * first, because a cap in BYTES cannot be measured in characters.
 */
function byteLength(content: string | ArrayBuffer | Uint8Array): number {
  if (typeof content === 'string') {
    return new TextEncoder().encode(content).length;
  }

  return content.byteLength;
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
