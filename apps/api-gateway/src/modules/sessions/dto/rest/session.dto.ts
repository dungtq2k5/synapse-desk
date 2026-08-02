export class SessionResponseDto {
  readonly id!: string;
  readonly deviceName!: string | null;
  readonly ipAddress!: string;
  readonly userAgent!: string;

  /** The session this request arrived on, matched by family — not by IP. */
  readonly current!: boolean;

  readonly isTrusted!: boolean;
  readonly trustedUntil!: Date | null;
  readonly expiresAt!: Date;
  readonly createdAt!: Date;
}

export class RevokeTrustResponseDto {
  readonly untrustedCount!: number;
}

export class RevokeCountResponseDto {
  readonly revokedCount!: number;
}
