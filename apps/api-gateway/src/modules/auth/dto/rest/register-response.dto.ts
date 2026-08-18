/** @file What the register route returns. */

export class RegisterResponseDto {
  readonly userId!: string;
  readonly organizationId!: string;
  readonly email!: string;
  readonly requiresEmailVerification!: boolean;
}
