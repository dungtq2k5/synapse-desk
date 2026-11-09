# The demo on the PC

`https://synapsedeskapp.com`, served from this PC through the Cloudflare
Tunnel. Every process runs in the `synapsedesk-demo` Compose project
(`compose.yaml`). It publishes no host ports and keeps its own volumes, so
development, `db:reset` and the test suites never touch it.

All commands run from the demo worktree's `deploy/demo/`, unless they say
otherwise.

## Once

1. **A worktree, outside the Syncthing folder.** The images are built from it,
   so a dirty development tree never reaches them:

   ```sh
   git -C ~/Documents/code/synapse-desk-java worktree add ~/synapsedesk-demo main-java
   cd ~/synapsedesk-demo && npm ci && npm run build   # for the tools service
   mkdir -p .demo-seed   # where the read-only mount takes the seed's manifest
   cd deploy/demo
   ```

2. **Settings.** Copy each example and fill in the secrets:

   ```sh
   cp .env.example .env
   for f in env/*.env.example; do cp "$f" "${f%.example}"; done
   ```

   - **`.env`:**
     - `DEMO_SOURCE`: this worktree's root.
     - `DB_PASSWORD`: the same password in every `DATABASE_URL` under `env/`.
   - **`env/*.env`:** the secrets each service's example marks.
   - **`env/tools.env`:** `SEED_DEMO_PASSWORD`.

3. **Keys.** In `secrets/` (gitignored, mounted read-only at
   `/run/secrets/synapsedesk`): `serviceAccountKey.json` (the real Firebase
   project) and the demo's own JWT key pairs, generated in the worktree:

   ```sh
   (cd ~/synapsedesk-demo && npm run keys:generate)
   mkdir -p secrets && cp ~/synapsedesk-demo/services/auth-service/secrets/jwt-*.key \
     ~/synapsedesk-demo/services/api-gateway/secrets/jwt-*.pub secrets/
   chmod 600 secrets/*.key secrets/serviceAccountKey.json
   chmod 644 secrets/*.pub   # the gateway runs as its own user; these are public
   ```

   The Node services run as uid 1000, which owns the private files if you do.

   The web's `FIREBASE_API_KEY` is the real project's Web API key, from the
   Firebase console (the project's web app config).

4. **The tunnel.**

   ```sh
   mkdir cloudflared
   cp cloudflared.example.yaml cloudflared/config.yaml   # put the tunnel id in it
   cp ~/.cloudflared/<tunnel-id>.json cloudflared/
   cloudflared tunnel route dns synapsedesk-local synapsedeskapp.com
   ```

   **One connector per tunnel:** while the demo is up, don't run
   `cloudflared tunnel run` on the host. Development that needs a public
   address uses a tunnel of its own.

5. **Outside the PC:**
   - Cloudflare: HSTS on for the zone, and `www` redirected to the root.
   - Firebase Auth: `synapsedeskapp.com` under authorized domains.
   - The storage bucket's CORS: the origin allowed.
   - Stripe, test mode: a webhook endpoint at
     `https://synapsedeskapp.com/api/v1/webhooks/stripe`, its secret in
     `env/auth-service.env`.

## Build and start

```sh
git -C ~/synapsedesk-demo checkout --detach <commit>
export DEMO_SHA=$(git -C ~/synapsedesk-demo rev-parse --short HEAD)
export DEMO_BUILD_TIME=$(date -u +%FT%TZ)
docker compose build
docker compose up -d       # the migrate services run first, then the rest
docker compose ps          # everything healthy; the migrate ones "exited (0)"
```

## First data

The demo starts empty: the plan catalog, plus the Super Admin that
auth-service creates from `SUPER_ADMIN_*`.

```sh
# From the host, against Stripe's test mode: the products and prices.
node ~/synapsedesk-demo/scripts/provision-stripe.mjs
# On the demo's network:
docker compose --profile tools run --rm tools npm run plans:seed:apply
```

Optionally, sample organizations. Documents are skipped; they come in through
the app.

```sh
docker compose --profile tools run --rm tools npm run seed:demo        # what it would write
docker compose --profile tools run --rm tools npm run seed:demo:apply
```

The Super Admin enrolls in two-step at first sign-in.

## Every day

```sh
docker compose ps
docker compose logs -f api-gateway          # any service by its name
docker compose restart web
docker compose down                         # stop; the volumes stay
```

Logs rotate at 5 × 20 MB per service.

## Update to a new commit

Rebuild and start as above. `up -d` replaces what changed, and the migrate
services run before their services start again.

## Back up

The four Postgres volumes and Qdrant's. Redis and NATS rebuild themselves.

```sh
docker compose exec postgres-auth pg_dump -U postgres synapsedesk_auth > auth-$(date +%F).sql
docker run --rm -v synapsedesk-demo_qdrant_data:/q -v "$PWD":/out alpine tar czf /out/qdrant-$(date +%F).tgz -C /q .
```

## The offline page

A Cloudflare Worker (`offline-worker/`) passes every request to the site
unchanged. When the PC or a container isn't answering, a visitor's page load
gets the demo's own "offline right now" page instead of Cloudflare's error.
The API, GraphQL, the socket, any `POST` and inbound mail keep their real
errors. It runs on Cloudflare, so it works with the PC off.

```sh
cd offline-worker
npx wrangler@4 login
npx wrangler@4 deploy          # routes: synapsedeskapp.com/* and www
npx wrangler@4 delete          # to remove it
```

To see it work: `docker compose stop cloudflared`, open the site, and the
page shows; `docker compose start cloudflared` brings the site back.

## The same file in CI

CI's `stack` job (`npm run images:stack`, `ci-stack.sh`) builds and starts
this file with `compose.ci.yaml` layered on top: the Firebase emulator instead
of a Google project, placeholder Stripe, Resend and Gemini keys, and no
cloudflared. It runs as its own project (`synapsedesk-ci`) with `ci-<sha>`
image tags and writes its env files to a temporary directory, so running it
on this PC never touches the demo's containers, volumes, images or
`env/*.env`.

## When the site doesn't answer

1. **`docker compose ps`:** which one isn't healthy. Its `logs` say why.
2. **`docker compose logs cloudflared`:** "Registered tunnel connection"
   means the tunnel is up. If it isn't, Cloudflare answers with error 1033.
3. **A migrate service that exited non-zero** keeps its service from
   starting. Its log names the database problem.
4. **A full `test:e2e:web` run takes the whole machine** for about 50
   minutes, so the demo answers slowly meanwhile.
5. **Mail:** Resend's free quota is 100 a day, and it's the demo's alone,
   since the tests use a fake.
