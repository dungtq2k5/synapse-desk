-- DropIndex
DROP INDEX "document_chunks_document_id_chunk_index_key";

-- AlterTable
ALTER TABLE "document_chunks" ADD COLUMN     "is_staged" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_document_id_chunk_index_is_staged_key" ON "document_chunks"("document_id", "chunk_index", "is_staged");

