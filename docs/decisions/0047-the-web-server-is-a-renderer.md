# 0047 — The web client's server renders pages and holds nothing: no session, no token, no rule

**Status:** accepted · **Code:** `apps/web/src/server/server-fetcher.ts`, `apps/web/src/server/prefetch.ts`, `packages/api-client/src/browser-fetcher.ts`, `packages/config/src/web-client.spec.ts`

## Decision

The Next.js server in `apps/web` renders pages, and that's all. It renders a signed-in page by forwarding the browser's own `Cookie`, `User-Agent` and `X-Forwarded-For` to the gateway's public API, unchanged. **It never:**

- keeps a session, or reads, refreshes or sets a token;
- calls a service other than the gateway, or a gateway route the browser couldn't call itself;
- decides who may see what. The gateway answers, and the page renders what it answered.

**A 401 during server rendering isn't an error.** The page renders without its data. The browser then fetches it, and the browser fetcher refreshes once (one `POST /auth/refresh` shared by every call waiting at that moment) and retries. Every server call is `cache: 'no-store'`.

## Why

- **One place decides access, and it's the gateway.** A server that refreshed tokens or skipped a call because "this user can't see that" would be a second copy of rules the gateway already enforces, and the copy that drifts. The gateway's 401 and 403 are the only answers to "who are you" and "may you".
- **The refresh token never needs to reach server code.** The cookies are `HttpOnly` and `Path=/`, so the server receives them with the page request. If the server refreshed, it would have to set cookies on its response and race the browser's own refresh. Leaving the refresh to the browser keeps one refresher per tab.
- **`no-store` is a security rule.** Next.js can cache `fetch` results across requests, and a cached response from a call that carried one user's cookies would be served to the next user.
- **`X-Forwarded-For` unchanged keeps the caller's address.** The gateway takes the rightmost entry as the client (`ClientIp`, [0043](./0043-the-cluster-shape.md)). The server forwards the header the Ingress wrote, without appending its own peer, so a server-rendered call lands in the user's own rate-limit bucket and records the user's address, not the pod's.
- **The alternative that lost: a backend-for-frontend.** The Next.js server would own the session: it would hold the tokens, call the gateway with its own credentials, and shape the responses. That's a second authentication surface and a second API to secure, for a client that the gateway's public API already serves completely.
- **The alternative that lost: client rendering only.** It's simpler, but every signed-in page starts empty and waits for the browser. Server rendering with the fallback costs one extra client round trip only when the access cookie expired.

## Consequences

- **The server fetcher is the only code that reads the incoming request's headers.** It reads three and forwards them. `web-client.spec.ts` holds the rest:
  - no `fetch(` outside the two fetchers;
  - no server package imported by the client, and Node built-ins only under `src/server/`;
  - `apps/web/.env.example` declares only `GATEWAY_URL`.
- **`src/proxy.ts` (Next.js's request hook) sets the Content-Security-Policy nonce and does nothing about who is signed in**, not even "no cookie, so redirect".
- **Anything that depends on a user is rendered per request.** The nonce makes every page dynamic anyway.
- **Public data can be cached later, safely, only without cookies.** No public endpoint is worth caching today. A future one gets its own fetch that forwards no cookies, with a revalidation interval.
- **A gateway bug the web finds is fixed in the gateway**, never worked around in the web.
