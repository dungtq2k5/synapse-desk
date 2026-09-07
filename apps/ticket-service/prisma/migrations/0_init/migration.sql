-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_number" BIGSERIAL NOT NULL,
    "organization_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'WEB',
    "status" VARCHAR(20) NOT NULL DEFAULT 'NEW',
    "priority" VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "current_assignee_id" UUID,
    "current_department_id" UUID,
    "escalated_at" TIMESTAMPTZ,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by_id" UUID,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_emails" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "message_id" VARCHAR(255) NOT NULL,
    "ticket_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_status_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "from_status" VARCHAR(20),
    "to_status" VARCHAR(20) NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "reason" TEXT,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_read_states" (
    "ticket_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "last_read_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ticket_read_states_pkey" PRIMARY KEY ("ticket_id","user_id")
);

-- CreateTable
CREATE TABLE "ticket_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" UUID NOT NULL,
    "assigned_to_id" UUID NOT NULL,
    "assigned_by_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMPTZ,
    "reason" VARCHAR(20) NOT NULL DEFAULT 'INITIAL',
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" UUID NOT NULL,
    "sender_id" UUID,
    "content" TEXT NOT NULL,
    "is_ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "is_internal_note" BOOLEAN NOT NULL DEFAULT false,
    "excluded_from_ai_context" BOOLEAN NOT NULL DEFAULT false,
    "answer_status" VARCHAR(30),
    "model_name" VARCHAR(100),
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "edited_at" TIMESTAMPTZ,
    "redacted_at" TIMESTAMPTZ,
    "redacted_by_id" UUID,
    "client_message_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "file_size_bytes" BIGINT NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "extracted_text" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" UUID NOT NULL,
    "summary_text" TEXT NOT NULL,
    "suggested_action" TEXT NOT NULL,
    "confidence_score" DOUBLE PRECISION NOT NULL,
    "model_name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_response_feedbacks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "feedback_text" TEXT,
    "citation_accurate" BOOLEAN,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_response_feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID,
    "organization_id" UUID,
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(50),
    "resource_id" UUID,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_daily_stats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "department_id" UUID,
    "tickets_created" INTEGER NOT NULL DEFAULT 0,
    "tickets_resolved" INTEGER NOT NULL DEFAULT 0,
    "tickets_escalated" INTEGER NOT NULL DEFAULT 0,
    "chat_conversations" INTEGER NOT NULL DEFAULT 0,
    "chat_resolved_without_escalation" INTEGER NOT NULL DEFAULT 0,
    "first_response_seconds_sum" INTEGER NOT NULL DEFAULT 0,
    "first_response_count" INTEGER NOT NULL DEFAULT 0,
    "ai_first_response_seconds_sum" INTEGER NOT NULL DEFAULT 0,
    "ai_first_response_count" INTEGER NOT NULL DEFAULT 0,
    "resolution_seconds_sum" INTEGER NOT NULL DEFAULT 0,
    "resolution_count" INTEGER NOT NULL DEFAULT 0,
    "feedback_positive" INTEGER NOT NULL DEFAULT 0,
    "feedback_negative" INTEGER NOT NULL DEFAULT 0,
    "citation_accurate_count" INTEGER NOT NULL DEFAULT 0,
    "citation_rated_count" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_daily_stats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "agent_id" UUID NOT NULL,
    "assigned" INTEGER NOT NULL DEFAULT 0,
    "resolved" INTEGER NOT NULL DEFAULT 0,
    "messages_sent" INTEGER NOT NULL DEFAULT 0,
    "resolution_seconds_sum" INTEGER NOT NULL DEFAULT 0,
    "resolution_count" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_exports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "from_day" DATE NOT NULL,
    "to_day" DATE NOT NULL,
    "department_id" UUID,
    "timezone" VARCHAR(64),
    "unrestricted" BOOLEAN NOT NULL DEFAULT false,
    "filters" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "object_path" TEXT,
    "row_count" INTEGER,
    "rollup_computed_at" TIMESTAMPTZ,
    "error_log" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "analytics_exports_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE UNIQUE INDEX "tickets_ticket_number_key" ON "tickets"("ticket_number");

-- CreateIndex
CREATE INDEX "tickets_organization_id_status_idx" ON "tickets"("organization_id", "status");

-- CreateIndex
CREATE INDEX "tickets_current_assignee_id_idx" ON "tickets"("current_assignee_id");

-- CreateIndex
CREATE INDEX "tickets_current_department_id_idx" ON "tickets"("current_department_id");

-- CreateIndex
CREATE INDEX "tickets_organization_id_author_id_idx" ON "tickets"("organization_id", "author_id");

-- CreateIndex
CREATE INDEX "inbound_emails_ticket_id_idx" ON "inbound_emails"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_emails_organization_id_message_id_key" ON "inbound_emails"("organization_id", "message_id");

-- CreateIndex
CREATE INDEX "ticket_status_changes_ticket_id_changed_at_idx" ON "ticket_status_changes"("ticket_id", "changed_at");

-- CreateIndex
CREATE INDEX "ticket_read_states_user_id_ticket_id_idx" ON "ticket_read_states"("user_id", "ticket_id");

-- CreateIndex
CREATE INDEX "ticket_assignments_ticket_id_is_current_idx" ON "ticket_assignments"("ticket_id", "is_current");

-- CreateIndex
CREATE INDEX "ticket_assignments_assigned_to_id_created_at_idx" ON "ticket_assignments"("assigned_to_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ticket_messages_ticket_id_created_at_idx" ON "ticket_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "message_attachments_message_id_idx" ON "message_attachments"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_summaries_ticket_id_key" ON "ai_summaries"("ticket_id");

-- CreateIndex
CREATE INDEX "ai_response_feedbacks_organization_id_created_at_idx" ON "ai_response_feedbacks"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ai_response_feedbacks_ticket_message_id_user_id_key" ON "ai_response_feedbacks"("ticket_message_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_event_id_key" ON "audit_logs"("event_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_action_idx" ON "audit_logs"("organization_id", "action");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "ticket_daily_stats_organization_id_day_idx" ON "ticket_daily_stats"("organization_id", "day");

-- CreateIndex
CREATE INDEX "agent_daily_stats_organization_id_day_idx" ON "agent_daily_stats"("organization_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "agent_daily_stats_organization_id_day_agent_id_key" ON "agent_daily_stats"("organization_id", "day", "agent_id");

-- CreateIndex
CREATE INDEX "analytics_exports_organization_id_created_at_idx" ON "analytics_exports"("organization_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_status_changes" ADD CONSTRAINT "ticket_status_changes_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_read_states" ADD CONSTRAINT "ticket_read_states_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_assignments" ADD CONSTRAINT "ticket_assignments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ticket_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

