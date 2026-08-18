# Inbound email Worker

Parses inbound MIME, signs a JSON payload, and posts it to
`POST /webhooks/email/inbound`. Decisions are in
the architecture notes; the payload contract is
`InboundEmailDto` in the gateway, and this Worker is the only caller.

## Why it is not under `apps/`

The npm workspaces are `apps/*` and `libs/*`, so anything there becomes a turbo
build and lint target. This is a Workers runtime — different globals, no Nest
build, and no tsconfig in the root eslint `parserOptions.project` covers it.
Placing it under `apps/` produces `none of those tsconfigs include this file`,
which is the same breakage a stray config file caused in a recent lint sweep.

It is excluded from root linting and carries its own `tsconfig.json`. Run
`npm run typecheck` from this directory.

## Deploying

```bash
cd workers/email-inbound
npm install
npx wrangler secret put INBOUND_SECRET   # must equal the gateway's INBOUND_EMAIL_SECRET
npx wrangler deploy
```

Set `WEBHOOK_URL` in `wrangler.toml` to the deployed gateway.

## The MX record — do this LAST

Leaving the MX record until last is deliberate: everything above is testable from a recorded
payload, and pointing a live MX record at an unfinished endpoint means debugging
business logic through a mail transport, where every iteration is an email you
send yourself and wait for.

1. In Cloudflare, enable **Email Routing** for the domain. It creates the MX and
   SPF records itself.
2. Add a **catch-all** rule that sends to this Worker. Not per-address rules:
   the tenant is in the local part (`support+{token}@…`), so every tenant shares
   one route.
3. Give a tenant an address by setting `organizations.inbound_token` — 32 hex
   characters, from `generateInboundToken()`. A tenant with a NULL token
   receives no mail, which is the default.

## What it does not do

- **Attachments are dropped**, and their filenames travel so the ticket can say
  what was omitted. The bytes never reach an application server,
  which is the property the presign flow exists to keep.
- **Errors are not swallowed.** A failure throws so Cloudflare retries; the
  gateway's `(organization_id, message_id)` dedup makes a retry safe. The one
  exception is 401 — a wrong secret is not fixed by retrying.
