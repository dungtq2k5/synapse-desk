/** What the department routes return. */

export class DepartmentResponseDto {
  readonly id!: string;
  readonly name!: string;
  readonly description!: string | null;
  readonly memberCount!: number;
  /** Non-null only on a soft-deleted row. */
  readonly deletedAt!: Date | null;
  readonly deletedByName!: string | null;
  readonly createdAt!: Date;
  readonly updatedAt!: Date;
}

export class DepartmentMemberResponseDto {
  readonly user!: unknown;
  readonly isPrimary!: boolean;
  readonly assignedByName!: string | null;
  readonly assignedAt!: Date;
}

export class AddDepartmentMembersResponseDto {
  /** New memberships. */
  readonly addedCount!: number;
  /** Existing memberships whose `isPrimary`/assigner were refreshed instead. */
  readonly updatedCount!: number;
}
