/** What the role routes return. */

import { PermissionCode } from '@synapsedesk/common';

export class RoleResponseDto {
  readonly id!: string;
  readonly name!: string;
  readonly description!: string | null;
  /** Readable by every tenant, mutable by none. */
  readonly isSystemRole!: boolean;
  readonly userAssigned!: number;
  readonly permissionCodes!: PermissionCode[];
  readonly createdAt!: Date;
  readonly updatedAt!: Date;
}

export class PermissionResponseDto {
  readonly id!: string;
  readonly code!: PermissionCode;
  readonly name!: string;
  /** The `target` prefix of the code, for grouping in the role editor. */
  readonly group!: string;
  /**
   * True when the code is in the table and no longer in `PERMISSION_CODES`.
   *
   * Retired rather than deleted, because roles may still hold it (ADR 0038).
   * An editor should show it as ungrantable rather than as an option — the API
   * refuses it either way, and offering it makes the refusal read as a bug.
   */
  readonly isRetired!: boolean;
}
