# Launch checklist

What a first deploy must do that the repository can't do for itself. Each
item names where it's done and how to tell it's done. There's no cluster yet,
so nothing here has been run.

## Before the first deploy

| # | Item | Where | Done when |
| :--- | :--- | :--- | :--- |
| 1 | **TLS on the Ingress, and HSTS with it** | `k8s/ingress.yaml` has no `tls:` section yet; ingress-nginx sends `Strict-Transport-Security` by default once TLS is configured | A response over HTTPS carries `Strict-Transport-Security`. The web never sends it itself, and a row holds that |
| 2 | **`SUPPORT_EMAIL`** set on the web | the web ConfigMap holds `REPLACE_ME` | The frozen page and the console's "Contact support" show the real address |
| 3 | **`GIT_SHA`** passed to the web image build | the image build already requires it; it becomes the browser's build id (`NEXT_PUBLIC_BUILD_ID`) | A browser error's log line carries the deployed commit |
| 4 | **`CORS` lists every origin the web is served from** | each gateway's config | A state-changing request from the web isn't refused 403 by the `Origin` check. Served through the same Ingress origin as the gateway, nothing needs listing |
| 5 | **Stripe live mode** | the Stripe secret key, the webhook endpoint and secret, the portal configuration (`STRIPE_PORTAL_MARKER`), and the plans seeded from the live catalog | A test checkout in live mode lands its webhook and moves the plan |
| 6 | **The Super Admin enrolls in two-step at first sign-in** | `SUPER_ADMIN_TOTP_SECRET` is refused in production | The first sign-in sends them to setup |
| 7 | **Every database is created before its service starts** | the `migrate` init container refuses a missing database (ADR 0049) | Each init container exits 0; a typo'd `DATABASE_URL` fails it |

## Dependencies

| # | Item | Done when |
| :--- | :--- | :--- |
| 8 | **`next` 16.4.0 → 16.4.3** (a critical advisory; the three need SVG in the image optimizer, `use cache` or Server Actions, which the web doesn't use). **Not before 2026-11-06,** when the release is two weeks old | `npm audit` shows no `next` advisory |
| 9 | **One dependency pass:** `fast-uri`, `qs`, `ws`, `zod` (runtime, transitive) and `orval`, `undici`, `@scalar/*` (codegen, dev) each have a non-major fix | `npm audit` lists only the accepted `firebase` → `@grpc/grpc-js` path (the web uses Firebase Auth only) |

## Watching it once it runs

- **Browser errors:** WARN lines with `"event":"client_error"` (the
  `ClientErrors` logger on both gateways), and `client_errors_total{kind}` on
  the gateway's metrics port.
- **Web Vitals, measured in the lab:** CI's `web-vitals` job gates the main
  screens at **LCP ≤ 1 s, CLS ≤ 0.1, INP ≤ 200 ms** (the worst of three
  runner runs was 428 ms LCP and 16 ms INP). These are lab numbers on a local
  stack with no network; real users will see slower ones, which nothing
  measures yet.
