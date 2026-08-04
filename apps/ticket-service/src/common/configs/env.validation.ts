import * as Joi from 'joi';
import { NODE_ENV_OPTIONS } from '@synapsedesk/common';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid(...NODE_ENV_OPTIONS)
    .required(),

  DATABASE_URL: Joi.string().required(),

  // Required for BOTH directions. ticket-service publishes ticket.* domain
  // events AND subscribes to audit.record — it is the first service in this
  // repo to be a NATS consumer, not just a publisher.
  NATS_URL: Joi.string().required(),

  // The gRPC server this service exposes to the gateway.
  GRPC_HOST: Joi.string().required(),
  GRPC_PORT: Joi.number().required(),

  // The gRPC CLIENT pointed back at auth-service, for the write-time validation
  // of cross-database references (author_id, assignee_id, department_id). There
  // is no foreign key that could do this, so a service that cannot reach
  // auth-service cannot safely create a ticket — hence required, not optional.
  AUTH_SERVICE_URL: Joi.string().required(),

  // The gRPC client pointed at storage-service, for message attachments.
  // Required rather than optional: an attachment endpoint that 500s because a
  // URL was never configured is worse than a service that refuses to boot.
  STORAGE_SERVICE_URL: Joi.string().required(),

  // Applies the partial unique index and the CHECK constraint on boot. False in
  // the test environment, where the fixture calls the seeder explicitly.
  SEED_ON_BOOTSTRAP: Joi.boolean().required(),

  // How long a sender may edit their own message. Named and configured rather
  // than a hardcoded number, the same treatment OTP_EXPIRY_MINUTES gets.
  MESSAGE_EDIT_WINDOW_MINUTES: Joi.number().required(),

  // rag-service (Python) does not exist yet. Absent means every AI RPC answers
  // UNAVAILABLE — which is why this is optional rather than required: making it
  // required would mean this service could not boot until Domain C ships.
  RAG_SERVICE_URL: Joi.string().optional(),
});
