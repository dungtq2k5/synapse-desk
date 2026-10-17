-- AlterTable: expand only. Nullable columns with no default: existing rows
-- read NULL (no code, no stage, an ordinary queue), and nothing reads them
-- before this release's code does.
ALTER TABLE "ingestion_jobs" ADD COLUMN "error_code" VARCHAR(30);
ALTER TABLE "ingestion_jobs" ADD COLUMN "failed_stage" VARCHAR(20);
ALTER TABLE "ingestion_jobs" ADD COLUMN "waiting_reason" VARCHAR(30);
