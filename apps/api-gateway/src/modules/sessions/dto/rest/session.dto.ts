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

/**
 * Whether the revoked family was the caller's own, so the controller knows
 * whether to clear cookies.
 *
 * Here rather than in `sessions-grpc.client.ts`, where it was declared and
 * exported next to the method returning it. It is a shape, not a transport
 * detail — and `session.mapper.ts` is not its home either: that file holds
 * mapping FUNCTIONS, and a type declared among them is the same category error
 * one folder over.
 *
 * Not a `…ResponseDto`, deliberately: it is never serialised. The controller
 * reads `wasCurrent` to decide about cookies and returns its own body, so
 * naming it for a response would promise a client something it never receives.
 */
export type RevokeSessionResult = {
  wasCurrent: boolean;
  revokedCount: number;
};
