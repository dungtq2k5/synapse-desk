-- AlterTable
ALTER TABLE "message_attachments" ADD COLUMN     "ticket_id" UUID,
ALTER COLUMN "message_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "opening_excluded_from_ai_context" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "message_attachments_ticket_id_idx" ON "message_attachments"("ticket_id");

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

