-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "file_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;


-- Backfill: the confirm is the only file date the rows record.
UPDATE "documents" SET "file_updated_at" = "created_at";
