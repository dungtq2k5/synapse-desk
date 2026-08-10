import {
  fromProtoGender,
  fromProtoTimestamp,
  requireProtoTimestamp,
  UserResponse,
  UserSummary,
  UserSummaryResponse,
} from '@synapsedesk/grpc-proto';
import { UserResponseDto } from './dto/rest/user-response.dto';
import { UserSummaryResponseDto } from './dto/rest/user-admin.dto';
import { UserSummaryGqlDto } from './dto/graphql/user-summary.gql-dto';
import { UserResponseGqlDto } from './dto/graphql/user-response.gql-dto';

/**
 * Wire -> REST boundary, the mirror of auth-service's `toUserResponse`.
 *
 * protobuf has no null, so an unset field arrives as `undefined`. The REST
 * contract commits to `null` instead — that is what `@IsNullable()` on
 * `UserResponseDto` already assumes, and it means a client (or an OpenAPI
 * schema) sees a stable key set rather than fields that vanish. So every
 * optional field is converted deliberately here.
 */
export function toUserResponseDto(user: UserResponse): UserResponseDto {
  return {
    id: user.id,
    organizationId: user.organizationId ?? null,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl ?? null,
    email: user.email,
    isEmailVerified: user.isEmailVerified,
    phoneNumber: user.phoneNumber ?? null,
    isPhoneVerified: user.isPhoneVerified,
    dob: user.dob ?? null,
    gender: fromProtoGender(user.gender),
    lastLoginAt: fromProtoTimestamp(user.lastLoginAt) ?? null,
    isLocked: user.isLocked,
    lockedUntil: fromProtoTimestamp(user.lockedUntil) ?? null,
    isTwoFactorEnabled: user.isTwoFactorEnabled,
    // Non-optional in the proto, so a missing value is a contract violation
    // rather than something to paper over with a fallback date.
    createdAt: requireProtoTimestamp(user.createdAt, 'createdAt'),
    updatedAt: requireProtoTimestamp(user.updatedAt, 'updatedAt'),
  };
}

/** Wire -> REST for an admin list row. */
export function toUserSummaryResponseDto(
  summary: UserSummaryResponse,
): UserSummaryResponseDto {
  return {
    user: toUserResponseDto(summary.user!),
    roleIds: summary.roleIds,
    roleNames: summary.roleNames,
    departmentIds: summary.departmentIds,
    deletedAt: fromProtoTimestamp(summary.deletedAt) ?? null,
    deletedByName: summary.deletedByName ?? null,
  };
}

/**
 * Wire -> GraphQL edge type, for `Ticket.assignee`, `Document.createdBy` and
 * the other resolved-user fields.
 *
 * **Here rather than beside the type it produces.** Every other wire→DTO
 * mapping in this gateway lives in a `<feature>.mapper.ts` — ten of them — and
 * a mapper in a DTO file is the kind of local consistency that reads fine in
 * one file and wrong across the module.
 *
 * Being next to {@link toUserSummaryResponseDto} is the other half of the reason. That
 * one returns the ADMIN summary — a user plus roles and departments — and the
 * two names are close enough to swap by accident. Side by side, the difference
 * is visible; a folder apart, it is a guess.
 *
 * **`null` in, `null` out.** A loader returns `null` for an id the batch RPC
 * omitted — a deleted row, or one in another tenant — and every edge is nullable
 * precisely so that answer can be given (27-doc §4). Mapping it to an empty
 * object instead would render a card with a blank name and no way for the client
 * to tell that anything was missing.
 */
export function toUserSummaryGqlDto(
  user: UserSummary | null,
): UserSummaryGqlDto | null {
  if (!user) return null;

  return {
    id: user.userId,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl ?? null,
    isLocked: user.isLocked,
    deletedAt: fromProtoTimestamp(user.deletedAt) ?? null,
  };
}

/**
 * The user envelope -> the FLAT shape the GraphQL `User` type declares.
 *
 * **This exists because a cast was standing in for it, and the cast was wrong.**
 * `UserServiceGrpcClient.get()` returns `UserSummaryResponseDto`, whose user
 * fields are NESTED under `.user` alongside `roleIds` and `departmentIds`. The
 * resolver handed that envelope straight back as
 * `as unknown as UserResponseGqlDto` — so `id`, `email` and every other field
 * resolved to `undefined`, and `Query.user` answered
 * `Cannot return null for non-nullable field User.id` for every caller. The same
 * cast on `Query.users` broke every row of the list.
 *
 * A double cast is the only thing TypeScript accepts between two unrelated
 * shapes, which is exactly why it silences the one error that would have caught
 * this. The fix is a real translation, and the reason it belongs in a mapper
 * rather than inline is that all three call sites need it.
 *
 * **`departmentIds` is carried through deliberately.** It is a sibling of `user`
 * on the envelope, not a property of it, so unwrapping alone loses it — and
 * `User.departments` reads it off the parent. `Query.me` had that bug in its
 * quieter form: it correctly returned `current.user`, so it rendered, and the
 * `departments` edge silently returned `[]` for every caller because the ids
 * had been left behind on the envelope.
 *
 * **The return type is exactly `UserResponseGqlDto`**, with nothing riding
 * along. It was briefly an intersection — the schema type PLUS a `departmentIds`
 * the schema did not declare — which worked, because GraphQL serialises only
 * declared fields, and was the wrong shape of solution: a function named for a
 * DTO that does not return that DTO, feeding a resolver whose parameter had to
 * be widened to see the extra property. Declaring the field on the type instead
 * made the carrier the contract.
 *
 * Typed by structure rather than by naming the two DTOs: `UserSummaryResponseDto`
 * and `CurrentUserResponseDto` share this shape and nothing else, and the two
 * fields below are all this needs.
 */
export function toUserResponseGqlDto(source: {
  user: UserResponseDto;
  departmentIds: string[];
}): UserResponseGqlDto {
  return { ...source.user, departmentIds: source.departmentIds };
}
