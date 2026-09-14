-- A migration of its own rather than a regenerated `0_init`.
--
-- `k8s/README.md` instructs baselining every existing database with
-- `prisma migrate resolve --applied 0_init`. On a database that has done so, a
-- regenerated `0_init` counts as already applied and this column would never be
-- created — and the first answer carrying citations would then fail its write
-- after the generation was paid for. A separate step is correct whether or not
-- the baseline has run.

-- AlterTable
ALTER TABLE "ticket_messages" ADD COLUMN "citations" JSONB;
