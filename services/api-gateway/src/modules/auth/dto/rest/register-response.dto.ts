/**
 * @file What the register route returns: the same for an address that already
 * has an account as for a new one, so it carries no ids.
 */

export class RegisterResponseDto {
  readonly email!: string;
  readonly requiresEmailVerification!: boolean;
}
