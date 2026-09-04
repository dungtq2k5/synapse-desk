-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_type" VARCHAR(50) NOT NULL,
    "file_size_bytes" BIGINT NOT NULL,
    "file_hash" VARCHAR(64) NOT NULL,
    "is_organization_wide" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "ocr_languages" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by_id" UUID,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content_text" TEXT NOT NULL,
    "page_number" INTEGER,
    "token_count" INTEGER NOT NULL,
    "vector_point_id" UUID,
    "organization_id" UUID NOT NULL,
    "is_organization_wide" BOOLEAN NOT NULL DEFAULT true,
    "department_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "retrieval_count" INTEGER NOT NULL DEFAULT 0,
    "last_retrieved_at" TIMESTAMPTZ,
    "citation_count" INTEGER NOT NULL DEFAULT 0,
    "last_cited_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "bullmq_job_id" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    "error_log" TEXT,
    "superseded_by_id" UUID,
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_flags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "related_document_id" UUID,
    "related_chunk_id" UUID,
    "flag_type" VARCHAR(30) NOT NULL,
    "severity" VARCHAR(20) NOT NULL DEFAULT 'INFO',
    "detail" TEXT NOT NULL,
    "confidence_score" DOUBLE PRECISION,
    "detected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,
    "resolved_by_id" UUID,
    "resolution" VARCHAR(30),
    "resolution_comment" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_generations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "ticket_id" UUID,
    "purpose" VARCHAR(30) NOT NULL,
    "model_name" VARCHAR(100) NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_micros" BIGINT NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    "content" TEXT,
    "retrieved_chunk_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "cited_chunk_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "attachment_count" INTEGER NOT NULL DEFAULT 0,
    "outcome" VARCHAR(20),
    "resulting_message_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_generation_daily_stats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "purpose" VARCHAR(30) NOT NULL,
    "model_name" VARCHAR(100) NOT NULL,
    "generations" INTEGER NOT NULL DEFAULT 0,
    "prompt_tokens" BIGINT NOT NULL DEFAULT 0,
    "completion_tokens" BIGINT NOT NULL DEFAULT 0,
    "cost_micros" BIGINT NOT NULL DEFAULT 0,
    "latency_ms_sum" BIGINT NOT NULL DEFAULT 0,
    "latency_count" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "empty_retrievals" INTEGER NOT NULL DEFAULT 0,
    "attachment_generations" INTEGER NOT NULL DEFAULT 0,
    "attachment_empty_retrievals" INTEGER NOT NULL DEFAULT 0,
    "drafts_accepted" INTEGER NOT NULL DEFAULT 0,
    "drafts_edited" INTEGER NOT NULL DEFAULT 0,
    "drafts_discarded" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generation_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "job_name" TEXT NOT NULL,
    "last_started_at" TIMESTAMP(3) NOT NULL,
    "last_succeeded_at" TIMESTAMP(3),
    "last_duration_ms" INTEGER,
    "last_error" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("job_name")
);

-- CreateTable
CREATE TABLE "limit_alert_generations" (
    "organization_id" UUID NOT NULL,
    "dimension" VARCHAR(32) NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "limit_alert_generations_pkey" PRIMARY KEY ("organization_id","dimension")
);

-- CreateIndex
CREATE INDEX "documents_organization_id_created_at_idx" ON "documents"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "documents_organization_id_status_idx" ON "documents"("organization_id", "status");

-- CreateIndex
CREATE INDEX "department_documents_department_id_idx" ON "department_documents"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "department_documents_document_id_department_id_key" ON "department_documents"("document_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_vector_point_id_key" ON "document_chunks"("vector_point_id");

-- CreateIndex
CREATE INDEX "document_chunks_document_id_idx" ON "document_chunks"("document_id");

-- CreateIndex
CREATE INDEX "document_chunks_organization_id_idx" ON "document_chunks"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_document_id_chunk_index_key" ON "document_chunks"("document_id", "chunk_index");

-- CreateIndex
CREATE INDEX "ingestion_jobs_bullmq_job_id_idx" ON "ingestion_jobs"("bullmq_job_id");

-- CreateIndex
CREATE INDEX "ingestion_jobs_document_id_created_at_idx" ON "ingestion_jobs"("document_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ingestion_jobs_organization_id_status_created_at_idx" ON "ingestion_jobs"("organization_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "document_flags_organization_id_flag_type_idx" ON "document_flags"("organization_id", "flag_type");

-- CreateIndex
CREATE INDEX "document_flags_document_id_idx" ON "document_flags"("document_id");

-- CreateIndex
CREATE INDEX "ai_generations_organization_id_created_at_idx" ON "ai_generations"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_generations_organization_id_purpose_created_at_idx" ON "ai_generations"("organization_id", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "ai_generations_ticket_id_idx" ON "ai_generations"("ticket_id");

-- CreateIndex
CREATE INDEX "ai_generation_daily_stats_organization_id_day_idx" ON "ai_generation_daily_stats"("organization_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "ai_generation_daily_stats_organization_id_day_purpose_model_key" ON "ai_generation_daily_stats"("organization_id", "day", "purpose", "model_name");

-- AddForeignKey
ALTER TABLE "department_documents" ADD CONSTRAINT "department_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_flags" ADD CONSTRAINT "document_flags_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_flags" ADD CONSTRAINT "document_flags_related_document_id_fkey" FOREIGN KEY ("related_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_flags" ADD CONSTRAINT "document_flags_related_chunk_id_fkey" FOREIGN KEY ("related_chunk_id") REFERENCES "document_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

