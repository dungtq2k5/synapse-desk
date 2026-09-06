import {
  AiGenerationOutcome,
  type AiModelTier,
  ExportKind,
  ExportStatus,
  AnswerStatus,
  AuditAction,
  AuditResourceType,
  DigestMode,
  type DocumentFileType,
  DocumentFlagResolution,
  DocumentFlagSeverity,
  DocumentFlagType,
  DocumentStatus,
  IngestionJobStatus,
  Gender,
  InvitationStatus,
  NOTIFICATION_TYPES,
  WebhookDeliveryStatus,
  DevicePlatform,
  NotificationChannel,
  NotificationPriority,
  NotificationResourceType,
  type NotificationType,
  OrgStatus,
  OtpPurpose,
  PreferenceSource,
  StoragePurpose,
  ReassignmentReason,
  TicketPriority,
  TicketSource,
  TicketStatus,
} from '@synapsedesk/common';
import {
  AiModelTier as ProtoAiModelTier,
  Gender as ProtoGender,
  OrgStatus as ProtoOrgStatus,
} from '../generated/synapsedesk/auth/common';
import { InvitationStatus as ProtoInvitationStatus } from '../generated/synapsedesk/auth/invitation';
import { OtpPurpose as ProtoOtpPurpose } from '../generated/synapsedesk/auth/otp';
import {
  DigestMode as ProtoDigestMode,
  DevicePlatform as ProtoDevicePlatform,
  NotificationChannel as ProtoNotificationChannel,
  NotificationPriority as ProtoNotificationPriority,
  NotificationResourceType as ProtoNotificationResourceType,
  NotificationType as ProtoNotificationType,
  WebhookDeliveryStatus as ProtoWebhookDeliveryStatus,
  PreferenceSource as ProtoPreferenceSource,
} from '../generated/synapsedesk/notification/notification';
import {
  DocumentFileType as ProtoDocumentFileType,
  DocumentFlagResolution as ProtoDocumentFlagResolution,
  DocumentFlagSeverity as ProtoDocumentFlagSeverity,
  DocumentFlagType as ProtoDocumentFlagType,
  DocumentStatus as ProtoDocumentStatus,
  IngestionJobStatus as ProtoIngestionJobStatus,
} from '../generated/synapsedesk/ingestion/document';
import { AiGenerationOutcome as ProtoAiGenerationOutcome } from '../generated/synapsedesk/ingestion/ledger';
import {
  AuditAction as ProtoAuditAction,
  AuditResourceType as ProtoAuditResourceType,
} from '../generated/synapsedesk/ticket/audit';
import {
  ExportKind as ProtoExportKind,
  ExportStatus as ProtoExportStatus,
} from '../generated/synapsedesk/ticket/analytics';
import {
  ReassignmentReason as ProtoReassignmentReason,
  TicketPriority as ProtoTicketPriority,
  TicketSource as ProtoTicketSource,
  TicketStatus as ProtoTicketStatus,
} from '../generated/synapsedesk/ticket/common';
import { MessageAnswerStatus as ProtoMessageAnswerStatus } from '../generated/synapsedesk/ticket/message';
import { AnswerStatus as ProtoRagAnswerStatus } from '../generated/synapsedesk/rag/rag';
import { StoragePurpose as ProtoStoragePurpose } from '../generated/synapsedesk/storage/storage';
import { enumBridge } from './enum-bridge';

/**
 * Two different types share the name `Gender` and they are NOT interchangeable:
 * the shared domain enum is a string ('MALE'), the proto one is numeric (1).
 * These two functions are the only sanctioned bridge.
 *
 * **Hand-written rather than `enumBridge`, and it has to stay that way.**
 * `Gender.UNSPECIFIED` is a real domain member, so `fromProtoGender` is TOTAL —
 * it answers `Gender`, never null. `enumBridge`'s `fromProto` answers
 * `D | null` and would turn an `UNRECOGNIZED` (-1) into null, where the whole
 * point here is that an unknown value reads as "unspecified" rather than as an
 * absence the caller has to handle.
 */
const PROTO_GENDER_BY_NAME: Record<Gender, ProtoGender> = {
  [Gender.UNSPECIFIED]: ProtoGender.GENDER_UNSPECIFIED,
  [Gender.MALE]: ProtoGender.GENDER_MALE,
  [Gender.FEMALE]: ProtoGender.GENDER_FEMALE,
  [Gender.OTHER]: ProtoGender.GENDER_OTHER,
};

const GENDER_NAME_BY_PROTO: Record<number, Gender> = {
  [ProtoGender.GENDER_UNSPECIFIED]: Gender.UNSPECIFIED,
  [ProtoGender.GENDER_MALE]: Gender.MALE,
  [ProtoGender.GENDER_FEMALE]: Gender.FEMALE,
  [ProtoGender.GENDER_OTHER]: Gender.OTHER,
};

/** The column is a nullable VarChar; the proto field is non-optional, so null
 * maps onto UNSPECIFIED — which is what proto3's mandatory zero value is for. */
export function toProtoGender(gender: string | null): ProtoGender {
  if (!gender) return ProtoGender.GENDER_UNSPECIFIED;

  return (
    PROTO_GENDER_BY_NAME[gender as Gender] ?? ProtoGender.GENDER_UNSPECIFIED
  );
}

export function fromProtoGender(gender: ProtoGender): Gender {
  // UNRECOGNIZED (-1) lands here too: a value this build does not know about is
  // closer to "unspecified" than to a crash.
  return GENDER_NAME_BY_PROTO[gender] ?? Gender.UNSPECIFIED;
}

/**
 * Bridges the proto's numeric `OtpPurpose` to the domain enum stored in
 * `otps.purpose` as text.
 *
 * With the purpose enumerated in the contract there is nothing left to validate:
 * protoc will not let a caller send a value outside the enum, so the only case
 * to handle is UNSPECIFIED — the proto3 zero value, which here means "the field
 * was omitted" and must be rejected rather than defaulting to a real purpose.
 * Returns null for that, leaving the "how do I complain?" decision (RpcException
 * vs HTTP 400) to the caller, which knows its own transport.
 *
 * **Hand-written rather than `enumBridge`, unlike its neighbours.** `to*` takes
 * the domain enum and has no fallback: an OTP purpose is chosen in code, never
 * read out of a `VarChar`, and its call site passes a real domain value. The
 * narrow parameter is doing work here — which is exactly what stopped being
 * true for `InvitationStatus` below.
 */
const DOMAIN_OTP_PURPOSE_BY_PROTO: Record<number, OtpPurpose> = {
  [ProtoOtpPurpose.OTP_PURPOSE_EMAIL_VERIFICATION]:
    OtpPurpose.EMAIL_VERIFICATION,
  [ProtoOtpPurpose.OTP_PURPOSE_PHONE_VERIFICATION]:
    OtpPurpose.PHONE_VERIFICATION,
};

const PROTO_OTP_PURPOSE_BY_DOMAIN: Record<OtpPurpose, ProtoOtpPurpose> = {
  [OtpPurpose.EMAIL_VERIFICATION]:
    ProtoOtpPurpose.OTP_PURPOSE_EMAIL_VERIFICATION,
  [OtpPurpose.PHONE_VERIFICATION]:
    ProtoOtpPurpose.OTP_PURPOSE_PHONE_VERIFICATION,
};

export function fromProtoOtpPurpose(
  purpose: ProtoOtpPurpose,
): OtpPurpose | null {
  // UNRECOGNIZED (-1) lands here too — a member added by a newer build than
  // this one, which is equally "not something we can act on".
  return DOMAIN_OTP_PURPOSE_BY_PROTO[purpose] ?? null;
}

export function toProtoOtpPurpose(purpose: OtpPurpose): ProtoOtpPurpose {
  return PROTO_OTP_PURPOSE_BY_DOMAIN[purpose];
}

/**
 * `user_invitations.status`.
 *
 * UNSPECIFIED means "the caller omitted the field" and maps to null, so a
 * filter that was never set cannot silently become a filter for PENDING.
 *
 * **`to*` takes a `string` now, and that DELETED a cast rather than adding a
 * risk.** It used to take `InvitationStatus`, which reads as the safer
 * signature — but the column is a `VarChar`, so the service call site satisfied
 * it with `invitation.status as InvitationStatus`. The narrow parameter was
 * being defeated at the one place it would have mattered.
 */
const invitationStatus = enumBridge<InvitationStatus, ProtoInvitationStatus>(
  {
    [InvitationStatus.PENDING]: ProtoInvitationStatus.INVITATION_STATUS_PENDING,
    [InvitationStatus.ACCEPTED]:
      ProtoInvitationStatus.INVITATION_STATUS_ACCEPTED,
    [InvitationStatus.REVOKED]: ProtoInvitationStatus.INVITATION_STATUS_REVOKED,
    [InvitationStatus.EXPIRED]: ProtoInvitationStatus.INVITATION_STATUS_EXPIRED,
  },
  ProtoInvitationStatus.INVITATION_STATUS_UNSPECIFIED,
);

export const toProtoInvitationStatus = invitationStatus.toProto;
export const fromProtoInvitationStatus = invitationStatus.fromProto;

/**
 * `UNSPECIFIED` maps to null rather than to a status.
 *
 * proto3's zero value means "the field was not set", and there is no
 * safe status to read that as: defaulting to ACTIVE would let an unset field
 * unfreeze a tenant, and defaulting to FROZEN would lock one out. The caller is
 * given null and decides how to complain, because it knows its own transport.
 */
const orgStatus = enumBridge<OrgStatus, ProtoOrgStatus>(
  {
    [OrgStatus.PENDING_ONBOARDING]:
      ProtoOrgStatus.ORG_STATUS_PENDING_ONBOARDING,
    [OrgStatus.ACTIVE]: ProtoOrgStatus.ORG_STATUS_ACTIVE,
    [OrgStatus.SUSPENDED_PAST_DUE]:
      ProtoOrgStatus.ORG_STATUS_SUSPENDED_PAST_DUE,
    [OrgStatus.FROZEN]: ProtoOrgStatus.ORG_STATUS_FROZEN,
  },
  ProtoOrgStatus.ORG_STATUS_UNSPECIFIED,
);

/**
 * `to*` takes the bare `string` Prisma hands back for a `VarChar` column
 * (conventions §7.3), and an unknown one maps to UNSPECIFIED rather than
 * throwing: this runs on the RESPONSE path, and a row carrying a status nobody
 * recognizes should surface as "unset" rather than failing a read the caller is
 * entitled to. The write paths validate before storing, so it should not arise.
 */
export const toProtoOrgStatus = orgStatus.toProto;
export const fromProtoOrgStatus = orgStatus.fromProto;

/**
 * The AI tier
 *
 * Same UNSPECIFIED-is-null rule as above, and it matters more here: the tier
 * selects which MODEL a tenant's questions are answered by, so reading an unset
 * field as FAST would silently downgrade a paying customer and reading it as
 * QUALITY would hand the expensive model to everyone.
 */
const aiModelTier = enumBridge<AiModelTier, ProtoAiModelTier>(
  {
    FAST: ProtoAiModelTier.AI_MODEL_TIER_FAST,
    QUALITY: ProtoAiModelTier.AI_MODEL_TIER_QUALITY,
  },
  ProtoAiModelTier.AI_MODEL_TIER_UNSPECIFIED,
);

export const toProtoAiModelTier = aiModelTier.toProto;
export const fromProtoAiModelTier = aiModelTier.fromProto;

/**
 * `notifications.priority` — a `VarChar` with a `"NORMAL"` default, which is
 * why `to*` takes a bare string.
 *
 * Null for UNSPECIFIED on the way back, and note which way the damage runs:
 * `CRITICAL` is the level that bypasses quiet hours and digest batching, so
 * reading an unset field as `NORMAL` would mute an alert meant to wake someone,
 * at 3am, silently. Reading it as `CRITICAL` would do the opposite and wake
 * everyone. Null forces the caller to decide.
 */
const notificationPriority = enumBridge<
  NotificationPriority,
  ProtoNotificationPriority
>(
  {
    [NotificationPriority.LOW]:
      ProtoNotificationPriority.NOTIFICATION_PRIORITY_LOW,
    [NotificationPriority.NORMAL]:
      ProtoNotificationPriority.NOTIFICATION_PRIORITY_NORMAL,
    [NotificationPriority.HIGH]:
      ProtoNotificationPriority.NOTIFICATION_PRIORITY_HIGH,
    [NotificationPriority.CRITICAL]:
      ProtoNotificationPriority.NOTIFICATION_PRIORITY_CRITICAL,
  },
  ProtoNotificationPriority.NOTIFICATION_PRIORITY_UNSPECIFIED,
);

export const toProtoNotificationPriority = notificationPriority.toProto;
export const fromProtoNotificationPriority = notificationPriority.fromProto;

const notificationChannel = enumBridge<
  NotificationChannel,
  ProtoNotificationChannel
>(
  {
    [NotificationChannel.IN_APP]:
      ProtoNotificationChannel.NOTIFICATION_CHANNEL_IN_APP,
    [NotificationChannel.EMAIL]:
      ProtoNotificationChannel.NOTIFICATION_CHANNEL_EMAIL,
    [NotificationChannel.SMS]:
      ProtoNotificationChannel.NOTIFICATION_CHANNEL_SMS,
    [NotificationChannel.WEBHOOK]:
      ProtoNotificationChannel.NOTIFICATION_CHANNEL_WEBHOOK,
    [NotificationChannel.PUSH]:
      ProtoNotificationChannel.NOTIFICATION_CHANNEL_PUSH,
  },
  ProtoNotificationChannel.NOTIFICATION_CHANNEL_UNSPECIFIED,
);

export const toProtoNotificationChannel = notificationChannel.toProto;
export const fromProtoNotificationChannel = notificationChannel.fromProto;

/**
 * `device_tokens.platform` — the same UNSPECIFIED-is-null rule as the channels
 * above, and the reason the gRPC edge needs no hand-written check.
 */
const devicePlatform = enumBridge<DevicePlatform, ProtoDevicePlatform>(
  {
    [DevicePlatform.IOS]: ProtoDevicePlatform.DEVICE_PLATFORM_IOS,
    [DevicePlatform.ANDROID]: ProtoDevicePlatform.DEVICE_PLATFORM_ANDROID,
    [DevicePlatform.WEB]: ProtoDevicePlatform.DEVICE_PLATFORM_WEB,
  },
  ProtoDevicePlatform.DEVICE_PLATFORM_UNSPECIFIED,
);

export const toProtoDevicePlatform = devicePlatform.toProto;
export const fromProtoDevicePlatform = devicePlatform.fromProto;

/**
 * Null for UNSPECIFIED, and that is load-bearing rather than incidental: an
 * `UpdatePreference` that omits `digest` must leave the stored value alone.
 * Reading "unset" as `IMMEDIATE` would switch a user off a digest they chose,
 * on a PATCH that never mentioned it.
 */
const digestMode = enumBridge<DigestMode, ProtoDigestMode>(
  {
    [DigestMode.IMMEDIATE]: ProtoDigestMode.DIGEST_MODE_IMMEDIATE,
    [DigestMode.HOURLY]: ProtoDigestMode.DIGEST_MODE_HOURLY,
    [DigestMode.DAILY]: ProtoDigestMode.DIGEST_MODE_DAILY,
    [DigestMode.OFF]: ProtoDigestMode.DIGEST_MODE_OFF,
  },
  ProtoDigestMode.DIGEST_MODE_UNSPECIFIED,
);

export const toProtoDigestMode = digestMode.toProto;
export const fromProtoDigestMode = digestMode.fromProto;

const preferenceSource = enumBridge<PreferenceSource, ProtoPreferenceSource>(
  {
    [PreferenceSource.EXPLICIT]:
      ProtoPreferenceSource.PREFERENCE_SOURCE_EXPLICIT,
    [PreferenceSource.WILDCARD]:
      ProtoPreferenceSource.PREFERENCE_SOURCE_WILDCARD,
    [PreferenceSource.DEFAULT]: ProtoPreferenceSource.PREFERENCE_SOURCE_DEFAULT,
  },
  ProtoPreferenceSource.PREFERENCE_SOURCE_UNSPECIFIED,
);

export const toProtoPreferenceSource = preferenceSource.toProto;
export const fromProtoPreferenceSource = preferenceSource.fromProto;

/**
 * `notifications.type` — the ORIGINATING event.
 *
 * Keyed off {@link NOTIFICATION_TYPES} rather than a TS `enum`, because the
 * domain side is an `as const` map whose values are dotted subjects
 * (`ticket.assigned`). `Record<NotificationType, …>` is still exhaustive over
 * that union, so a seventh type fails to compile here until it is mapped.
 *
 * **Not for a PREFERENCE's type**, which may be the `'*'` wildcard and is
 * therefore still a string on the wire — see `notification.proto`.
 */
const notificationType = enumBridge<NotificationType, ProtoNotificationType>(
  {
    [NOTIFICATION_TYPES.ticketAssigned]:
      ProtoNotificationType.NOTIFICATION_TYPE_TICKET_ASSIGNED,
    [NOTIFICATION_TYPES.ticketReassigned]:
      ProtoNotificationType.NOTIFICATION_TYPE_TICKET_REASSIGNED,
    [NOTIFICATION_TYPES.ticketEscalated]:
      ProtoNotificationType.NOTIFICATION_TYPE_TICKET_ESCALATED,
    [NOTIFICATION_TYPES.ticketMessageCreated]:
      ProtoNotificationType.NOTIFICATION_TYPE_TICKET_MESSAGE_CREATED,
    [NOTIFICATION_TYPES.ticketStatusChanged]:
      ProtoNotificationType.NOTIFICATION_TYPE_TICKET_STATUS_CHANGED,
    [NOTIFICATION_TYPES.quotaThreshold]:
      ProtoNotificationType.NOTIFICATION_TYPE_QUOTA_THRESHOLD,
    [NOTIFICATION_TYPES.limitThreshold]:
      ProtoNotificationType.NOTIFICATION_TYPE_LIMIT_THRESHOLD,
    [NOTIFICATION_TYPES.paymentFailed]:
      ProtoNotificationType.NOTIFICATION_TYPE_PAYMENT_FAILED,
    [NOTIFICATION_TYPES.planChanged]:
      ProtoNotificationType.NOTIFICATION_TYPE_PLAN_CHANGED,
    [NOTIFICATION_TYPES.webhookEndpointDisabled]:
      ProtoNotificationType.NOTIFICATION_TYPE_WEBHOOK_ENDPOINT_DISABLED,
  },
  ProtoNotificationType.NOTIFICATION_TYPE_UNSPECIFIED,
);

export const toProtoNotificationType = notificationType.toProto;
export const fromProtoNotificationType = notificationType.fromProto;

/**
 * `webhook_deliveries.status` — a persisted domain value, so an enum with a
 * bridge (§7.3), and `Record<D, P>` makes a fourth status a compile error here
 * until it is mapped.
 */
const webhookDeliveryStatus = enumBridge<
  WebhookDeliveryStatus,
  ProtoWebhookDeliveryStatus
>(
  {
    [WebhookDeliveryStatus.PENDING]:
      ProtoWebhookDeliveryStatus.WEBHOOK_DELIVERY_STATUS_PENDING,
    [WebhookDeliveryStatus.DELIVERED]:
      ProtoWebhookDeliveryStatus.WEBHOOK_DELIVERY_STATUS_DELIVERED,
    [WebhookDeliveryStatus.FAILED]:
      ProtoWebhookDeliveryStatus.WEBHOOK_DELIVERY_STATUS_FAILED,
  },
  ProtoWebhookDeliveryStatus.WEBHOOK_DELIVERY_STATUS_UNSPECIFIED,
);

export const toProtoWebhookDeliveryStatus = webhookDeliveryStatus.toProto;
export const fromProtoWebhookDeliveryStatus = webhookDeliveryStatus.fromProto;

/** `notifications.resource_type` — what the notification is ABOUT. */
const notificationResourceType = enumBridge<
  NotificationResourceType,
  ProtoNotificationResourceType
>(
  {
    [NotificationResourceType.TICKET]:
      ProtoNotificationResourceType.NOTIFICATION_RESOURCE_TYPE_TICKET,
    [NotificationResourceType.DOCUMENT]:
      ProtoNotificationResourceType.NOTIFICATION_RESOURCE_TYPE_DOCUMENT,
    [NotificationResourceType.USER]:
      ProtoNotificationResourceType.NOTIFICATION_RESOURCE_TYPE_USER,
    [NotificationResourceType.ORGANIZATION]:
      ProtoNotificationResourceType.NOTIFICATION_RESOURCE_TYPE_ORGANIZATION,
  },
  ProtoNotificationResourceType.NOTIFICATION_RESOURCE_TYPE_UNSPECIFIED,
);

export const toProtoNotificationResourceType = notificationResourceType.toProto;
export const fromProtoNotificationResourceType =
  notificationResourceType.fromProto;

/** `documents.status`. */
const documentStatus = enumBridge<DocumentStatus, ProtoDocumentStatus>(
  {
    [DocumentStatus.PENDING]: ProtoDocumentStatus.DOCUMENT_STATUS_PENDING,
    [DocumentStatus.PROCESSING]: ProtoDocumentStatus.DOCUMENT_STATUS_PROCESSING,
    [DocumentStatus.INDEXED]: ProtoDocumentStatus.DOCUMENT_STATUS_INDEXED,
    [DocumentStatus.FAILED]: ProtoDocumentStatus.DOCUMENT_STATUS_FAILED,
  },
  ProtoDocumentStatus.DOCUMENT_STATUS_UNSPECIFIED,
);

export const toProtoDocumentStatus = documentStatus.toProto;
export const fromProtoDocumentStatus = documentStatus.fromProto;

/**
 * `ingestion_jobs.status`.
 *
 * Seven members, and `CANCELLED` has no counterpart in `documentStatus` above
 * on purpose — a cancelled job leaves its document `FAILED`. The `Record` this
 * bridge takes is exhaustive, so adding a member to either enum without its
 * partner is a compile error rather than a value that silently maps to
 * UNSPECIFIED.
 */
const ingestionJobStatus = enumBridge<
  IngestionJobStatus,
  ProtoIngestionJobStatus
>(
  {
    [IngestionJobStatus.QUEUED]:
      ProtoIngestionJobStatus.INGESTION_JOB_STATUS_QUEUED,
    [IngestionJobStatus.PARSING]:
      ProtoIngestionJobStatus.INGESTION_JOB_STATUS_PARSING,
    [IngestionJobStatus.CHUNKING]:
      ProtoIngestionJobStatus.INGESTION_JOB_STATUS_CHUNKING,
    [IngestionJobStatus.EMBEDDING]:
      ProtoIngestionJobStatus.INGESTION_JOB_STATUS_EMBEDDING,
    [IngestionJobStatus.COMPLETED]:
      ProtoIngestionJobStatus.INGESTION_JOB_STATUS_COMPLETED,
    [IngestionJobStatus.FAILED]:
      ProtoIngestionJobStatus.INGESTION_JOB_STATUS_FAILED,
    [IngestionJobStatus.CANCELLED]:
      ProtoIngestionJobStatus.INGESTION_JOB_STATUS_CANCELLED,
  },
  ProtoIngestionJobStatus.INGESTION_JOB_STATUS_UNSPECIFIED,
);

export const toProtoIngestionJobStatus = ingestionJobStatus.toProto;
export const fromProtoIngestionJobStatus = ingestionJobStatus.fromProto;

const documentFileType = enumBridge<DocumentFileType, ProtoDocumentFileType>(
  {
    pdf: ProtoDocumentFileType.DOCUMENT_FILE_TYPE_PDF,
    // No `doc`. `DOCUMENT_FILE_TYPE_DOC` is reserved in the proto and
    // `application/msword` is no longer an accepted document type, so there is
    // no extension to bridge. An old client's `5` now falls to UNSPECIFIED,
    // which is what `enumBridge`'s fallback is for.
    docx: ProtoDocumentFileType.DOCUMENT_FILE_TYPE_DOCX,
    txt: ProtoDocumentFileType.DOCUMENT_FILE_TYPE_TXT,
    md: ProtoDocumentFileType.DOCUMENT_FILE_TYPE_MD,
    // A real stored value: confirm writes it for an accepted type with no
    // extension mapping.
    bin: ProtoDocumentFileType.DOCUMENT_FILE_TYPE_BIN,
  },
  ProtoDocumentFileType.DOCUMENT_FILE_TYPE_UNSPECIFIED,
);

export const toProtoDocumentFileType = documentFileType.toProto;
export const fromProtoDocumentFileType = documentFileType.fromProto;

const documentFlagType = enumBridge<DocumentFlagType, ProtoDocumentFlagType>(
  {
    [DocumentFlagType.OUTDATED]:
      ProtoDocumentFlagType.DOCUMENT_FLAG_TYPE_OUTDATED,
    [DocumentFlagType.UNRETRIEVED]:
      ProtoDocumentFlagType.DOCUMENT_FLAG_TYPE_UNRETRIEVED,
    [DocumentFlagType.UNCITED]:
      ProtoDocumentFlagType.DOCUMENT_FLAG_TYPE_UNCITED,
    [DocumentFlagType.LOW_CONFIDENCE]:
      ProtoDocumentFlagType.DOCUMENT_FLAG_TYPE_LOW_CONFIDENCE,
    [DocumentFlagType.NEGATIVE_FEEDBACK]:
      ProtoDocumentFlagType.DOCUMENT_FLAG_TYPE_NEGATIVE_FEEDBACK,
    [DocumentFlagType.CONFLICTING]:
      ProtoDocumentFlagType.DOCUMENT_FLAG_TYPE_CONFLICTING,
    [DocumentFlagType.PAGES_NOT_INDEXED]:
      ProtoDocumentFlagType.DOCUMENT_FLAG_TYPE_PAGES_NOT_INDEXED,
  },
  ProtoDocumentFlagType.DOCUMENT_FLAG_TYPE_UNSPECIFIED,
);

export const toProtoDocumentFlagType = documentFlagType.toProto;
export const fromProtoDocumentFlagType = documentFlagType.fromProto;

const documentFlagSeverity = enumBridge<
  DocumentFlagSeverity,
  ProtoDocumentFlagSeverity
>(
  {
    [DocumentFlagSeverity.INFO]:
      ProtoDocumentFlagSeverity.DOCUMENT_FLAG_SEVERITY_INFO,
    [DocumentFlagSeverity.WARNING]:
      ProtoDocumentFlagSeverity.DOCUMENT_FLAG_SEVERITY_WARNING,
    [DocumentFlagSeverity.CRITICAL]:
      ProtoDocumentFlagSeverity.DOCUMENT_FLAG_SEVERITY_CRITICAL,
  },
  ProtoDocumentFlagSeverity.DOCUMENT_FLAG_SEVERITY_UNSPECIFIED,
);

export const toProtoDocumentFlagSeverity = documentFlagSeverity.toProto;
export const fromProtoDocumentFlagSeverity = documentFlagSeverity.fromProto;

/** `document_flags.resolution` — null on the domain side while the flag is open. */
const documentFlagResolution = enumBridge<
  DocumentFlagResolution,
  ProtoDocumentFlagResolution
>(
  {
    [DocumentFlagResolution.FIXED]:
      ProtoDocumentFlagResolution.DOCUMENT_FLAG_RESOLUTION_FIXED,
    [DocumentFlagResolution.DISMISSED]:
      ProtoDocumentFlagResolution.DOCUMENT_FLAG_RESOLUTION_DISMISSED,
    [DocumentFlagResolution.DOCUMENT_REPLACED]:
      ProtoDocumentFlagResolution.DOCUMENT_FLAG_RESOLUTION_DOCUMENT_REPLACED,
  },
  ProtoDocumentFlagResolution.DOCUMENT_FLAG_RESOLUTION_UNSPECIFIED,
);

export const toProtoDocumentFlagResolution = documentFlagResolution.toProto;
export const fromProtoDocumentFlagResolution = documentFlagResolution.fromProto;

/** `ai_generations.outcome` — drafts only. */
const aiGenerationOutcome = enumBridge<
  AiGenerationOutcome,
  ProtoAiGenerationOutcome
>(
  {
    [AiGenerationOutcome.ACCEPTED]:
      ProtoAiGenerationOutcome.AI_GENERATION_OUTCOME_ACCEPTED,
    [AiGenerationOutcome.EDITED]:
      ProtoAiGenerationOutcome.AI_GENERATION_OUTCOME_EDITED,
    [AiGenerationOutcome.DISCARDED]:
      ProtoAiGenerationOutcome.AI_GENERATION_OUTCOME_DISCARDED,
  },
  ProtoAiGenerationOutcome.AI_GENERATION_OUTCOME_UNSPECIFIED,
);

export const toProtoAiGenerationOutcome = aiGenerationOutcome.toProto;
export const fromProtoAiGenerationOutcome = aiGenerationOutcome.fromProto;

/** `audit_logs.action`. */
const auditAction = enumBridge<AuditAction, ProtoAuditAction>(
  {
    [AuditAction.USER_LOGOUT_ALL]:
      ProtoAuditAction.AUDIT_ACTION_USER_LOGOUT_ALL,
    [AuditAction.PASSWORD_CHANGED]:
      ProtoAuditAction.AUDIT_ACTION_PASSWORD_CHANGED,
    [AuditAction.USER_SESSIONS_REVOKED]:
      ProtoAuditAction.AUDIT_ACTION_USER_SESSIONS_REVOKED,
    [AuditAction.DEPARTMENT_CREATED]:
      ProtoAuditAction.AUDIT_ACTION_DEPARTMENT_CREATED,
    [AuditAction.DEPARTMENT_UPDATED]:
      ProtoAuditAction.AUDIT_ACTION_DEPARTMENT_UPDATED,
    [AuditAction.DEPARTMENT_DELETED]:
      ProtoAuditAction.AUDIT_ACTION_DEPARTMENT_DELETED,
    [AuditAction.DEPARTMENT_RESTORED]:
      ProtoAuditAction.AUDIT_ACTION_DEPARTMENT_RESTORED,
    [AuditAction.DEPARTMENT_MEMBERS_ADDED]:
      ProtoAuditAction.AUDIT_ACTION_DEPARTMENT_MEMBERS_ADDED,
    [AuditAction.DEPARTMENT_MEMBER_REMOVED]:
      ProtoAuditAction.AUDIT_ACTION_DEPARTMENT_MEMBER_REMOVED,
    [AuditAction.ROLE_CREATED]: ProtoAuditAction.AUDIT_ACTION_ROLE_CREATED,
    [AuditAction.ROLE_UPDATED]: ProtoAuditAction.AUDIT_ACTION_ROLE_UPDATED,
    [AuditAction.ROLE_DELETED]: ProtoAuditAction.AUDIT_ACTION_ROLE_DELETED,
    [AuditAction.ROLE_PERMISSIONS_UPDATED]:
      ProtoAuditAction.AUDIT_ACTION_ROLE_PERMISSIONS_UPDATED,
    [AuditAction.USER_CREATED]: ProtoAuditAction.AUDIT_ACTION_USER_CREATED,
    [AuditAction.USER_UPDATED]: ProtoAuditAction.AUDIT_ACTION_USER_UPDATED,
    [AuditAction.USER_DELETED]: ProtoAuditAction.AUDIT_ACTION_USER_DELETED,
    [AuditAction.USER_RESTORED]: ProtoAuditAction.AUDIT_ACTION_USER_RESTORED,
    [AuditAction.USER_LOCKED]: ProtoAuditAction.AUDIT_ACTION_USER_LOCKED,
    [AuditAction.USER_UNLOCKED]: ProtoAuditAction.AUDIT_ACTION_USER_UNLOCKED,
    [AuditAction.USER_TWO_FACTOR_RESET]:
      ProtoAuditAction.AUDIT_ACTION_USER_TWO_FACTOR_RESET,
    [AuditAction.USER_ROLES_UPDATED]:
      ProtoAuditAction.AUDIT_ACTION_USER_ROLES_UPDATED,
    [AuditAction.USER_DEPARTMENTS_UPDATED]:
      ProtoAuditAction.AUDIT_ACTION_USER_DEPARTMENTS_UPDATED,
    [AuditAction.USER_AVATAR_UPDATED]:
      ProtoAuditAction.AUDIT_ACTION_USER_AVATAR_UPDATED,
    [AuditAction.ORGANIZATION_UPDATED]:
      ProtoAuditAction.AUDIT_ACTION_ORGANIZATION_UPDATED,
    [AuditAction.ORGANIZATION_SETTINGS_UPDATED]:
      ProtoAuditAction.AUDIT_ACTION_ORGANIZATION_SETTINGS_UPDATED,
    [AuditAction.ORGANIZATION_ONBOARDING_COMPLETED]:
      ProtoAuditAction.AUDIT_ACTION_ORGANIZATION_ONBOARDING_COMPLETED,
    [AuditAction.ORGANIZATION_OFFBOARD_REQUESTED]:
      ProtoAuditAction.AUDIT_ACTION_ORGANIZATION_OFFBOARD_REQUESTED,
    [AuditAction.PLATFORM_ORGANIZATION_CREATED]:
      ProtoAuditAction.AUDIT_ACTION_PLATFORM_ORGANIZATION_CREATED,
    [AuditAction.PLATFORM_ORGANIZATION_UPDATED]:
      ProtoAuditAction.AUDIT_ACTION_PLATFORM_ORGANIZATION_UPDATED,
    [AuditAction.PLATFORM_ORGANIZATION_STATUS_CHANGED]:
      ProtoAuditAction.AUDIT_ACTION_PLATFORM_ORGANIZATION_STATUS_CHANGED,
    [AuditAction.PLATFORM_BILLING_CYCLE_RESET]:
      ProtoAuditAction.AUDIT_ACTION_PLATFORM_BILLING_CYCLE_RESET,
    [AuditAction.PLATFORM_ORGANIZATION_OFFBOARDED]:
      ProtoAuditAction.AUDIT_ACTION_PLATFORM_ORGANIZATION_OFFBOARDED,
    [AuditAction.PLATFORM_ORGANIZATION_RESTORED]:
      ProtoAuditAction.AUDIT_ACTION_PLATFORM_ORGANIZATION_RESTORED,
    [AuditAction.PLATFORM_GLOBAL_ROLE_CREATED]:
      ProtoAuditAction.AUDIT_ACTION_PLATFORM_GLOBAL_ROLE_CREATED,
    [AuditAction.PLATFORM_PLAN_CREATED]:
      ProtoAuditAction.AUDIT_ACTION_PLATFORM_PLAN_CREATED,
    [AuditAction.PLATFORM_PLAN_UPDATED]:
      ProtoAuditAction.AUDIT_ACTION_PLATFORM_PLAN_UPDATED,
    [AuditAction.PLATFORM_PLAN_DELETED]:
      ProtoAuditAction.AUDIT_ACTION_PLATFORM_PLAN_DELETED,
    [AuditAction.PLATFORM_PLAN_APPLIED]:
      ProtoAuditAction.AUDIT_ACTION_PLATFORM_PLAN_APPLIED,
    [AuditAction.DOCUMENT_FLAG_RESOLVED]:
      ProtoAuditAction.AUDIT_ACTION_DOCUMENT_FLAG_RESOLVED,
    [AuditAction.DOCUMENT_FLAG_DISMISSED]:
      ProtoAuditAction.AUDIT_ACTION_DOCUMENT_FLAG_DISMISSED,
    [AuditAction.DOCUMENT_FLAG_DELETED]:
      ProtoAuditAction.AUDIT_ACTION_DOCUMENT_FLAG_DELETED,
    [AuditAction.DATA_EXPORT_REQUESTED]:
      ProtoAuditAction.AUDIT_ACTION_DATA_EXPORT_REQUESTED,
  },
  ProtoAuditAction.AUDIT_ACTION_UNSPECIFIED,
);

export const toProtoAuditAction = auditAction.toProto;
export const fromProtoAuditAction = auditAction.fromProto;

const auditResourceType = enumBridge<AuditResourceType, ProtoAuditResourceType>(
  {
    [AuditResourceType.USER]: ProtoAuditResourceType.AUDIT_RESOURCE_TYPE_USER,
    [AuditResourceType.DEPARTMENT]:
      ProtoAuditResourceType.AUDIT_RESOURCE_TYPE_DEPARTMENT,
    [AuditResourceType.ROLE]: ProtoAuditResourceType.AUDIT_RESOURCE_TYPE_ROLE,
    [AuditResourceType.ORGANIZATION]:
      ProtoAuditResourceType.AUDIT_RESOURCE_TYPE_ORGANIZATION,
    [AuditResourceType.DOCUMENT_FLAG]:
      ProtoAuditResourceType.AUDIT_RESOURCE_TYPE_DOCUMENT_FLAG,
    [AuditResourceType.EXPORT]:
      ProtoAuditResourceType.AUDIT_RESOURCE_TYPE_EXPORT,
    [AuditResourceType.SUBSCRIPTION_PLAN]:
      ProtoAuditResourceType.AUDIT_RESOURCE_TYPE_SUBSCRIPTION_PLAN,
  },
  ProtoAuditResourceType.AUDIT_RESOURCE_TYPE_UNSPECIFIED,
);

export const toProtoAuditResourceType = auditResourceType.toProto;
export const fromProtoAuditResourceType = auditResourceType.fromProto;

const exportKind = enumBridge<ExportKind, ProtoExportKind>(
  {
    [ExportKind.TICKET_DAILY]: ProtoExportKind.EXPORT_KIND_TICKET_DAILY,
    [ExportKind.AGENT_DAILY]: ProtoExportKind.EXPORT_KIND_AGENT_DAILY,
    [ExportKind.TICKET]: ProtoExportKind.EXPORT_KIND_TICKET,
    [ExportKind.AUDIT_LOG]: ProtoExportKind.EXPORT_KIND_AUDIT_LOG,
  },
  ProtoExportKind.EXPORT_KIND_UNSPECIFIED,
);

export const toProtoExportKind = exportKind.toProto;
export const fromProtoExportKind = exportKind.fromProto;

const exportStatus = enumBridge<ExportStatus, ProtoExportStatus>(
  {
    [ExportStatus.PENDING]: ProtoExportStatus.EXPORT_STATUS_PENDING,
    [ExportStatus.READY]: ProtoExportStatus.EXPORT_STATUS_READY,
    [ExportStatus.FAILED]: ProtoExportStatus.EXPORT_STATUS_FAILED,
  },
  ProtoExportStatus.EXPORT_STATUS_UNSPECIFIED,
);

export const toProtoExportStatus = exportStatus.toProto;
export const fromProtoExportStatus = exportStatus.fromProto;

/** `PURPOSE_POLICY` keys — what an object is stored for. */
const storagePurpose = enumBridge<StoragePurpose, ProtoStoragePurpose>(
  {
    [StoragePurpose.AVATAR]: ProtoStoragePurpose.STORAGE_PURPOSE_AVATAR,
    [StoragePurpose.TICKET_ATTACHMENT]:
      ProtoStoragePurpose.STORAGE_PURPOSE_TICKET_ATTACHMENT,
    [StoragePurpose.DOCUMENT]: ProtoStoragePurpose.STORAGE_PURPOSE_DOCUMENT,
    [StoragePurpose.EXPORT]: ProtoStoragePurpose.STORAGE_PURPOSE_EXPORT,
  },
  ProtoStoragePurpose.STORAGE_PURPOSE_UNSPECIFIED,
);

export const toProtoStoragePurpose = storagePurpose.toProto;
export const fromProtoStoragePurpose = storagePurpose.fromProto;

/** `tickets.status`. */
const ticketStatus = enumBridge<TicketStatus, ProtoTicketStatus>(
  {
    [TicketStatus.NEW]: ProtoTicketStatus.TICKET_STATUS_NEW,
    [TicketStatus.OPEN]: ProtoTicketStatus.TICKET_STATUS_OPEN,
    [TicketStatus.PENDING_AGENT]: ProtoTicketStatus.TICKET_STATUS_PENDING_AGENT,
    [TicketStatus.ESCALATED]: ProtoTicketStatus.TICKET_STATUS_ESCALATED,
    [TicketStatus.RESOLVED]: ProtoTicketStatus.TICKET_STATUS_RESOLVED,
    [TicketStatus.CLOSED]: ProtoTicketStatus.TICKET_STATUS_CLOSED,
  },
  ProtoTicketStatus.TICKET_STATUS_UNSPECIFIED,
);

export const toProtoTicketStatus = ticketStatus.toProto;
export const fromProtoTicketStatus = ticketStatus.fromProto;

const ticketPriority = enumBridge<TicketPriority, ProtoTicketPriority>(
  {
    [TicketPriority.LOW]: ProtoTicketPriority.TICKET_PRIORITY_LOW,
    [TicketPriority.MEDIUM]: ProtoTicketPriority.TICKET_PRIORITY_MEDIUM,
    [TicketPriority.HIGH]: ProtoTicketPriority.TICKET_PRIORITY_HIGH,
    [TicketPriority.URGENT]: ProtoTicketPriority.TICKET_PRIORITY_URGENT,
  },
  ProtoTicketPriority.TICKET_PRIORITY_UNSPECIFIED,
);

export const toProtoTicketPriority = ticketPriority.toProto;
export const fromProtoTicketPriority = ticketPriority.fromProto;

/** `ticket_assignments.reason`. */
const reassignmentReason = enumBridge<
  ReassignmentReason,
  ProtoReassignmentReason
>(
  {
    [ReassignmentReason.INITIAL]:
      ProtoReassignmentReason.REASSIGNMENT_REASON_INITIAL,
    [ReassignmentReason.DEPARTMENT_CHANGE]:
      ProtoReassignmentReason.REASSIGNMENT_REASON_DEPARTMENT_CHANGE,
    [ReassignmentReason.ESCALATION]:
      ProtoReassignmentReason.REASSIGNMENT_REASON_ESCALATION,
    [ReassignmentReason.UNAVAILABLE]:
      ProtoReassignmentReason.REASSIGNMENT_REASON_UNAVAILABLE,
    [ReassignmentReason.LOAD_BALANCING]:
      ProtoReassignmentReason.REASSIGNMENT_REASON_LOAD_BALANCING,
    [ReassignmentReason.SELF_ASSIGNED]:
      ProtoReassignmentReason.REASSIGNMENT_REASON_SELF_ASSIGNED,
    [ReassignmentReason.MANUAL]:
      ProtoReassignmentReason.REASSIGNMENT_REASON_MANUAL,
  },
  ProtoReassignmentReason.REASSIGNMENT_REASON_UNSPECIFIED,
);

export const toProtoReassignmentReason = reassignmentReason.toProto;
export const fromProtoReassignmentReason = reassignmentReason.fromProto;

const ticketSource = enumBridge<TicketSource, ProtoTicketSource>(
  {
    [TicketSource.WEB]: ProtoTicketSource.TICKET_SOURCE_WEB,
    [TicketSource.CHAT]: ProtoTicketSource.TICKET_SOURCE_CHAT,
    [TicketSource.EMAIL]: ProtoTicketSource.TICKET_SOURCE_EMAIL,
    [TicketSource.API]: ProtoTicketSource.TICKET_SOURCE_API,
  },
  ProtoTicketSource.TICKET_SOURCE_UNSPECIFIED,
);

export const toProtoTicketSource = ticketSource.toProto;
export const fromProtoTicketSource = ticketSource.fromProto;

/**
 * `ticket_messages.answer_status`, against the `synapsedesk.ticket` enum.
 *
 * Use {@link toProtoRagAnswerStatus} for the `synapsedesk.rag` enum instead —
 * the two are numbered identically but are distinct TypeScript enums, so a
 * value from one is not assignable to the other.
 */
const messageAnswerStatus = enumBridge<AnswerStatus, ProtoMessageAnswerStatus>(
  {
    [AnswerStatus.DOC_ANSWER]:
      ProtoMessageAnswerStatus.MESSAGE_ANSWER_STATUS_DOC_ANSWER,
    [AnswerStatus.DOC_MISSING]:
      ProtoMessageAnswerStatus.MESSAGE_ANSWER_STATUS_DOC_MISSING,
    [AnswerStatus.GREETING]:
      ProtoMessageAnswerStatus.MESSAGE_ANSWER_STATUS_GREETING,
    [AnswerStatus.AT_CAP]:
      ProtoMessageAnswerStatus.MESSAGE_ANSWER_STATUS_AT_CAP,
    [AnswerStatus.REFUSED]:
      ProtoMessageAnswerStatus.MESSAGE_ANSWER_STATUS_REFUSED,
  },
  ProtoMessageAnswerStatus.MESSAGE_ANSWER_STATUS_UNSPECIFIED,
);

export const toProtoMessageAnswerStatus = messageAnswerStatus.toProto;
export const fromProtoMessageAnswerStatus = messageAnswerStatus.fromProto;

/** The same statuses against the `synapsedesk.rag` enum. */
const ragAnswerStatus = enumBridge<AnswerStatus, ProtoRagAnswerStatus>(
  {
    [AnswerStatus.DOC_ANSWER]: ProtoRagAnswerStatus.ANSWER_STATUS_DOC_ANSWER,
    [AnswerStatus.DOC_MISSING]: ProtoRagAnswerStatus.ANSWER_STATUS_DOC_MISSING,
    [AnswerStatus.GREETING]: ProtoRagAnswerStatus.ANSWER_STATUS_GREETING,
    [AnswerStatus.AT_CAP]: ProtoRagAnswerStatus.ANSWER_STATUS_AT_CAP,
    [AnswerStatus.REFUSED]: ProtoRagAnswerStatus.ANSWER_STATUS_REFUSED,
  },
  ProtoRagAnswerStatus.ANSWER_STATUS_UNSPECIFIED,
);

export const toProtoRagAnswerStatus = ragAnswerStatus.toProto;
export const fromProtoRagAnswerStatus = ragAnswerStatus.fromProto;
