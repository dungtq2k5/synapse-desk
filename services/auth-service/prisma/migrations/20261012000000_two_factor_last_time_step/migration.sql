-- AlterTable: expand only. A nullable column with no default: existing rows
-- read NULL, which accepts their next code, and nothing reads it before this
-- release's code does.
ALTER TABLE "users" ADD COLUMN "two_factor_last_time_step" INTEGER;
