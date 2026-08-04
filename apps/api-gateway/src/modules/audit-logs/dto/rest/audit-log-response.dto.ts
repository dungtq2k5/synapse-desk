export class AuditLogResponseDto {
  id!: string;
  /** null for a PLATFORM act — the event belongs to the platform, not a tenant. */
  organizationId!: string | null;
  /** null for system and cron actors, which have no user acting for them. */
  userId!: string | null;
  action!: string;
  resourceType!: string | null;
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
