/** @file What the logout routes return. */

export class LogoutResponseDto {
  readonly revokedSessionCount!: number;
}
export class LogoutAllResponseDto {
  readonly revokedSessionCount!: number;
}
