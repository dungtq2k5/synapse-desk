-- CreateTable
CREATE TABLE "pending_draft_outcomes" (
    "generation_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "sent_text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_draft_outcomes_pkey" PRIMARY KEY ("generation_id")
);

-- CreateIndex
CREATE INDEX "pending_draft_outcomes_created_at_idx" ON "pending_draft_outcomes"("created_at");

