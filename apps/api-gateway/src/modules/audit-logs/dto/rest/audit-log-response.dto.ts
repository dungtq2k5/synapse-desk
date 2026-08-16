import { AuditAction, AuditResourceType } from '@synapsedesk/common';

export class AuditLogResponseDto {
  id!: string;
  /** null for a PLATFORM act — the event belongs to the platform, not a tenant. */
  organizationId!: string | null;
  /** null for system and cron actors, which have no user acting for them. */
  userId!: string | null;
  // ASK this `docblock` seem to be invalid
  /**
   * The enum, not a `string`, and `| null` is what the narrowing costs.
   *
   * A response DTO is never validated — `@IsIn` runs on REQUESTS — so this type
   * used to be a claim about ticket-service's output that nothing checked. It is
   * a proto enum on the wire now, so the claim is true, and null is the honest
   * answer for the one case that remains: a row whose action THIS build cannot
   * name, which is only reachable mid-rolling-deploy.
   *
   * **Null rather than the raw string.** A client whose union does not contain
   * the value is better told "unknown" than handed a member it cannot switch on
   * — and the alternative, keeping `string`, means the OpenAPI spec advertises
   * "any text" for a field with thirty-four possible values.
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
