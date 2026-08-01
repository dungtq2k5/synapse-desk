import { IsIn, IsNumberString, IsPhoneNumber, Length } from 'class-validator';
import { OTP_PURPOSES, OtpPurpose } from '@synapsedesk/common';

export class RequestPhoneVerificationDto {
  /**
   * Becomes `otps.target`. `users.phone_number` is not touched until a code for
   * this exact number verifies, which is what lets one endpoint serve both
   * first-time verification and change-of-number.
   */
  @IsPhoneNumber()
  readonly phoneNumber!: string;
}

export class VerifyOtpDto {
  /** `@IsNumberString` rather than `@IsString`: the code is digits only, and a
   * non-numeric value should be a 400 rather than a wasted attempt. */
  @IsNumberString()
  @Length(4, 10)
  readonly code!: string;
}

export class OtpStatusQueryDto {
  /**
   * The REST surface stays a readable string (`?purpose=email_verification`)
   * rather than the proto's integer — a query param is a public contract and
   * `?purpose=1` is nobody's idea of one. `@IsIn` over the shared domain enum is
   * what makes the two agree; the gRPC client maps it to the proto enum.
   */
  @IsIn(OTP_PURPOSES)
  readonly purpose!: OtpPurpose;
}

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
