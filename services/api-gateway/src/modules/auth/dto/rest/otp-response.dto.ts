/** What the OTP routes return. */

export class RequestOtpResponseDto {
  /** Masked: `a***e@acme.com` or `+44******1234`. */
  readonly target!: string;
  readonly expiresInMinutes!: number;
}

export class VerifyOtpResponseDto {
  readonly verified!: boolean;
  readonly attemptsRemaining!: number;
  readonly mustRequestNewCode!: boolean;
}

export class OtpStatusResponseDto {
  readonly pending!: boolean;
  readonly target!: string | null;
  readonly expiresAt!: Date | null;
  readonly attemptsRemaining!: number;
}
