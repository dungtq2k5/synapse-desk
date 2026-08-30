# The demo seeder

```bash
npm run seed:demo                                  # dry run: prints the plan, writes nothing
npm run seed:demo -- --apply
npm run seed:demo -- --apply --profile=large
npm run seed:demo -- --apply --only=ticket
npm run seed:demo -- --apply --force --seed=99
```

**Preconditions.** Boot auth-service once (`npm run dev`) so its `DatabaseSeeder`
writes the permission catalogue and the system roles, then
`npm run plans:seed:apply`. Every seeded quantity is derived from a plan grant,
so without the catalogue there is nothing to derive from — both are checked up
front with a message saying what to run.

**Run `npm run typecheck` before an `--apply` that matters.** `tsx`
compiles and runs without typechecking, so a wrong enum member is `undefined` at
runtime rather than an error. That is not hypothetical: an early revision wrote
`DocumentStatus.COMPLETED`, which does not exist, and Prisma silently applied the
column default — every seeded document came out `PENDING` and the run reported
success. These files are in the root tsconfig's program precisely so the repo's
own typecheck sees them; there is no separate command to remember.

---

## What it deliberately does NOT seed

These are demo surfaces that will look broken. **None of them is a bug.**

| Not seeded | What you will see | Why |
| :--- | :--- | :--- |
| **Qdrant vectors** | knowledge search and `Ask` return nothing | Real embeddings cost money per run and need an API key. Fake ones rank nonsense, which demos worse than an honest empty state. The chunk rows exist with `vector_point_id = NULL` — the state the pipeline genuinely holds between writing rows and upserting. |
| **Firebase Storage objects** | a document download 404s | Documents carry a `file_url` path and no object behind it. The alternative is generating and uploading hundreds of PDFs. |
| **The notification feed** | the bell is empty | Domain E rows are produced by CONSUMING commands. Writing them directly means minting `event_id` values — the column whose partial unique index decides *"have we already told this person?"* — and a collision there suppresses a real notification forever, silently. **The feed fills the first time you click through the app with the services running**, which is the honest way to produce those rows. |
| **Stripe customers and subscriptions** | the billing page says "Free" and lists no invoices | Both ids stay `NULL`, which is the grandfathered state the code handles everywhere: `listInvoices` returns empty *before* touching Stripe, and the portal is unreachable. A fake `cus_…` would send a live API read that fails. |

**Seeded billing history is display-only and unreplayable.** `billing_events`
rows are written for tenants that deliberately have no `stripe_customer_id`, and
on the real path a webhook resolves its tenant *by* that column — so this history
could never have been produced by the integration that normally writes it. The
rows are read by tenant id, which is what the finance dashboard does with them.

---

## Shape

- **Order is the failure model.** `auth → ticket → ingestion`, one transaction
  per tenant per service. A failure leaves every earlier step committed and
  internally consistent: a smaller demo, never an invalid one.
- **Every quantity comes from the tenant's plan grant**, never a fixed range, so
  a seeded tenant is never over a limit the product enforces. One tenant is
  seeded just past 80% on purpose, so the level alarm has something to show.
- **Deterministic.** The same `--seed` produces the same demo. The factories'
  counters are per-process, so ids are stable across identical runs and not
  across runs that seed a different set.
- **`--force` needs a different `--seed`.** A second run at the same seed
  regenerates the first run's slugs exactly, and `slug` is globally unique.
