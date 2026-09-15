# 0046 — Email is Resend in both directions, and the transport is the only thing that changed

**Status:** accepted · **Supersedes the transport bullets of:** [0018](./0018-inbound-email-routing-and-threading.md) · **Code:** `apps/notification-service/src/modules/email/email.service.ts`, `apps/api-gateway/src/modules/inbound-email/`

## Decision

Outbound mail is sent through the Resend API from notification-service, with
an idempotency key on every send — the uuid the publisher already mints for
`Nats-Msg-Id`, carried on the command as `sendId`, plus the recipient on a
fan-out — and a caller-set RFC `Message-ID` that is the SHA-256 of that key
at the sender's domain, stored as the delivery's provider id. Resend
preserves the header byte for byte (measured; plan 75 §8). Inbound mail
arrives as a Resend
`email.received` webhook at the gateway, verified with the webhook signing
secret over the raw body, with the body and headers fetched from the
receiving API. There is no SMTP relay and no Cloudflare Worker.

Everything downstream of the transport is unchanged: the tenant token in the
local part, the reply token in `Reply-To`, the `In-Reply-To` fallback, the
loop guards, the `(organization_id, message_id)` dedup, the rejection reply,
and `INBOUND_EMAIL_SECRET` as the value both services share to mint and parse
the reply token.

Inbound attachments are fetched **by storage-service**, from the signed URL
Resend issues per file, through the same SSRF control as an outbound
webhook target, and landed under `pending/` with a `PendingUpload` record —
presign with the PUT done server-side, so `createMessage` binds them exactly
as it binds a client's upload. The gateway carries URLs and gets back paths;
ticket-service authorizes each write and learns nothing about email.
Anything refused is named in the ticket's note.

## Why

- **One provider, one SDK, one credential per direction.** The previous shape
  was three runtimes (SMTP relay, a Workers runtime outside turbo, the
  gateway) holding one shared secret in three places, with a failure table
  whose two rows failed in opposite directions. It is now two services, and
  the secret has two holders that do the same thing with it.
- **The threading fallback is the one thing a provider swap can silently
  break.** `provider_message_id` must hold what a customer's mail client
  echoes back in `In-Reply-To` — the RFC `Message-ID`, not a provider's own
  id. So the sender sets that header itself and stores its own value, and
  the pre-flight that confirms Resend preserves it is recorded in the plan
  rather than assumed.
- **The attachment bytes never touch the gateway.** The Worker put them in
  the bucket without touching an application server — the property the
  presign flow exists to hold. Resend hands bytes back behind a signed URL,
  and the only shape that keeps the property is a fetch by the one process
  built for bytes. That fetch is the system's second outbound path to a host
  nobody here chose, which is why the SSRF guard moved to `libs/common`
  rather than being copied, and why storage-service has an egress policy.
- **The alternative that lost: keep the Worker for inbound and use Resend
  only for outbound.** It keeps the property above for free and keeps three
  runtimes, a second lockfile, a CI job, and a secret in three places — the
  cost this decision exists to remove.
- **The alternative that lost: another transactional provider with SMTP.**
  It changes nothing about inbound, which is where the complexity is.

## Consequences

- `EMAIL_HOST/PORT/SECURE/USER/PASS` are gone. Three secrets replace them:
  `RESEND_API_KEY` (notification-service, sending), `RESEND_GATEWAY_API_KEY`
  (the gateway, receiving — a separate key by name and scope), and
  `RESEND_WEBHOOK_SECRET`, created by `scripts/provision-resend.mjs` and
  readable back through the API, so it is rotated rather than lost.
- `INBOUND_EMAIL_DOMAIN` is a Resend receiving domain — `.resend.app` in
  development, a subdomain with one MX record in production, **MX last**.
- Retries are the provider's: Resend redelivers a webhook on any non-2xx for
  hours, so the gateway answers 200 for every verified event it decides
  about and 503 only when a retry can change the answer. JetStream
  redelivers a failed outbound send, so the idempotency key is what makes
  that safe — and the send-side rule is one function, `isRetryableResendError`
  in `libs/common`, classifying by status code, used by both services.
- The `Message-ID` is hashed rather than spelled out because a `sendId` can
  be an event id with `:` in it, which RFC 5322 does not allow before the
  `@`. It is still reproducible from the command, which is all the
  threading fallback needs.
- ADR 0018's rules about routing and threading stand. Its bullets about the
  Worker — HMAC signing with `INBOUND_SECRET`, the Worker outside turbo, the
  fixture contract test as its only check — are superseded, and so is its
  _"No attachments via inbound email"_: a reply's attachments are stored, a
  ticket-opening mail's are named, because `createTicket` writes no message
  to attach to.
- Three deadlines nest around the fetch (20 s socket, 30 s ticket→storage,
  35 s gateway→ticket) so a timeout consumes its record and deletes its
  partial object before the caller gives up; files ingest two at a time. A
  cut-off, a redelivery that hits the dedup, or a client that never confirms
  leaves an object under `pending/` — the prefix that exists for a bucket
  lifecycle rule (known gap 35).
- The `agent-email-inbox` pattern's sender allowlisting is already this
  system's design (an unknown sender is a drop); no new control is added.
