-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "pending_file_hash" VARCHAR(64),
ADD COLUMN     "pending_file_size_bytes" BIGINT,
ADD COLUMN     "pending_file_type" VARCHAR(50),
ADD COLUMN     "pending_file_url" TEXT;

