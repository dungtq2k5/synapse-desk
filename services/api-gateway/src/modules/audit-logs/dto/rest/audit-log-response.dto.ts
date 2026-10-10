import { AuditAction, AuditResourceType } from '@synapsedesk/common';

export class AuditLogResponseDto {
  id!: string;
  /** null for a PLATFORM act — the event belongs to the platform, not a tenant. */
  organizationId!: string | null;
  /** null for system and cron actors, which have no user acting for them. */
  userId!: string | null;
  /**
   * What happened, as an `AuditAction`.
   *
   * `null` for a row whose action THIS build cannot name — only reachable
   * mid-rolling-deploy, and a client is better told "unknown" than handed a
   * value its union does not contain.
   */
  action!: AuditAction | null;
  resourceType!: AuditResourceType | null;
  resourceId!: string | null;
  ipAddress!: string | null;
  userAgent!: string | null;
  /**
   * Parsed back into an object for the client.
   *
   * It crosses gRPC as a JSON string because the shape differs per action; a
   * typed proto message could only be a `map<string, string>`, which would
   * flatten every nested value in the before/after diff.
   */
  metadata!: Record<string, unknown>;
  createdAt!: Date;
}

/** The distinct actions present in the log, for a filter dropdown. */
export class AuditActionsResponseDto {
  readonly actions!: AuditAction[];
}
