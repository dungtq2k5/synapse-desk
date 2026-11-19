/** A person a response refers to by id, named: who raised, holds or wrote it. */
export class UserReferenceResponseDto {
  id!: string;

  fullName!: string;

  avatarUrl!: string | null;
}

/** A department a response refers to by id, named. */
export class DepartmentReferenceResponseDto {
  id!: string;

  name!: string;
}
