-- AlterTable: expand only. Existing rows stay NULL (unknown, never guessed);
-- a new organization starts its status at creation. The trigger that stamps a
-- change is applied by the seeder at boot, as the CHECK constraints are.
ALTER TABLE "organizations" ADD COLUMN "status_changed_at" TIMESTAMPTZ;
ALTER TABLE "organizations" ALTER COLUMN "status_changed_at" SET DEFAULT now();
