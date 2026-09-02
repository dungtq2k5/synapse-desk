# Outbound webhooks — a reference for integrators

SynapseDesk can POST a signed JSON event to an HTTPS endpoint you register
whenever something happens in your organization — a ticket assigned, an SLA
breached, an import finished. This document is the contract: what you receive,
how to verify it, how retries behave, and the handful of behaviours that will
cost you an afternoon if you assume the obvious thing.

Everything here mirrors the code's own declarations —
`libs/common/src/contracts/webhook.contract.ts` holds the payload type, the
signing scheme, and every constant quoted below. **If this document and that
file disagree, it is right and this is stale**; please report it.

---

## 1. Managing endpoints

Endpoints are tenant configuration, managed over REST at `/webhook-endpoints`
(gated by `organization.read` / `organization.update`):

| Route | What it does |
| --- | --- |
| `GET /webhook-endpoints` | List your endpoints. Never includes secrets. |
| `GET /webhook-endpoints/event-types` | Every event type you can subscribe to. |
| `GET /webhook-endpoints/:id` | One endpoint, with its subscribed types. |
| `POST /webhook-endpoints` | Register one. **The signing secret is in this response only.** |
| `PATCH /webhook-endpoints/:id` | Edit URL, description, subscriptions, or enable/disable. |
| `DELETE /webhook-endpoints/:id` | Delete the endpoint and its delivery history. |
| `POST /webhook-endpoints/:id/rotate-secret` | New secret; the old one keeps verifying for 24 hours. |
| `POST /webhook-endpoints/:id/test` | Send a signed test event through the real delivery path. |
| `GET /webhook-endpoints/:id/deliveries` | Recent deliveries, newest first (kept 30 days). |

Constraints:

- **HTTPS only**, and the URL must resolve to a **public** address. A private,
  loopback, or link-local IP given directly in the URL is refused when you
  register it; a hostname that resolves to one is refused at delivery time —
  a webhook pointed at `10.0.0.5` will never be delivered, whatever DNS says.
- At most **10 endpoints** per organization.
- An endpoint subscribes to **at least one** event type. Read the catalogue
  from `GET /webhook-endpoints/event-types` rather than hard-coding it — the
  set grows.

## 2. What your endpoint receives

One HTTPS `POST` per event per endpoint, `Content-Type: application/json`:

```json
{
  "id": "3f8a…",
  "type": "ticket.assigned",
  "occurredAt": "2026-09-02T10:15:00.000Z",
  "organizationId": "…",
  "resourceType": "ticket",
  "resourceId": "…",
  "data": { "ticketNumber": 1042 }
}
```

- **`id` is stable across retries.** Five delivery attempts of the same event
  carry the same `id` — deduplicate on it, because our queue *will* retry.
- **`type` is the event vocabulary** (`ticket.assigned`,
  `webhook.endpoint_disabled`, …), the same strings the catalogue endpoint
  lists.
- **There is no `title` or `body`.** Those are product copy written for a
  person; the payload is the event. Build your own text from `type` and
  `data`.
- **`resourceType` and `resourceId` can both be `null`.** Not every event is
  about a resource you can link to. Write the null arm; a consumer that
  interpolates them straight into a URL will produce `/tickets/null`.
- `data` is typed per event type; treat unknown keys as additive, not
  breaking.

## 3. Verifying the signature

Every delivery carries the header:

```text
x-synapsedesk-signature: t=1756809300,v1=5257a869e7…
```

- `t` — unix **seconds** when we signed the request.
- `v1` — hex HMAC-SHA256, keyed by your endpoint's secret, over the string
  `"{t}.{rawBody}"` — the timestamp, a literal dot, then the **exact raw
  request body bytes**.

Verification, in Node.js:

```js
const { createHmac, timingSafeEqual } = require('node:crypto');

// rawBody MUST be the bytes as received — verify BEFORE any JSON parsing.
// A body you re-serialize (JSON.parse then JSON.stringify) has different
// key order and whitespace and will fail verification forever.
function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(
    header.split(',').map((entry) => entry.split('=')),
  );
  const timestamp = Number(parts.t);

  // The timestamp is INSIDE the signed material, so checking it bounds
  // replays. Pick a tolerance that suits you; five minutes is conventional.
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const expected = Buffer.from(
    createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex'),
    'hex',
  );
  const actual = Buffer.from(parts.v1, 'hex');

  // Constant-time comparison — `expected === actual` as strings leaks
  // timing. This is the mistake receiving code usually makes.
  return (
    expected.length === actual.length && timingSafeEqual(expected, actual)
  );
}
```

This mirrors `verifyWebhookSignature` in
`libs/common/src/contracts/webhook.contract.ts`, which is unit-tested against
the real signer — if you translate it to another language, translate *that*
function.

### During secret rotation

After `POST /webhook-endpoints/:id/rotate-secret`, deliveries carry **two**
`v1=` entries for 24 hours — the new secret's signature first, the old one
second:

```text
x-synapsedesk-signature: t=1756809300,v1=<new>,v1=<old>
```

Accept the delivery if **any** `v1` verifies. The example above happens to
keep only the last `v1` after `Object.fromEntries`; a rotation-safe verifier
collects every `v1` entry and tries each. Roll your stored secret at your own
pace inside the window and no event is dropped.

## 4. Responding, retries, and auto-disable

- Answer **2xx within 10 seconds**. Anything else — including a redirect — is
  a failed attempt. **Redirects are never followed.**
- Respond fast and process later: we read at most 16 KB of your response and
  ignore the body entirely; only the status code matters.
- A failed delivery is retried up to **5 attempts** with exponential backoff
  starting at 30 seconds and doubling: the four retries land at roughly
  **+30s, +1m30s, +3m30s and +7m30s** after the first try, so the whole
  sequence is over in **under ten minutes**. It covers a receiver restart, not
  a receiver outage — for that, read the delivery list and re-drive from your
  own side.
- After **10 consecutive** exhausted deliveries the endpoint is
  **auto-disabled**, the reason is recorded on it, and your admins receive a
  high-priority in-app notification (`webhook.endpoint_disabled` — which is
  itself a subscribable event type). Re-enable with
  `PATCH /webhook-endpoints/:id { "isActive": true }` once the receiver is
  fixed; the failure streak resets.
- `GET /webhook-endpoints/:id/deliveries` shows attempt counts, the last
  response status, and the last error for each event — read it before opening
  a support thread; it is the surface that makes an auto-disable explicable.

## 5. Ordering

Deliveries are **not ordered**. Retries and concurrency mean an event that
occurred later can arrive first. Order by `occurredAt` (when the event
happened, not when the attempt was made) and deduplicate by `id`.
