import {
  MAX_OTP_CODE_LENGTH,
  MIN_OTP_CODE_LENGTH,
} from '../../../../common/config/dto.config';
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
  // `@IsNumberString`, not `@IsString`: the code is digits only, so a
  // non-numeric value should be a 400 rather than a wasted attempt.
  //
  // A RANGE, not a fixed length: auth-service generates `OTP_LENGTH` digits and
  // that is an env var, so the gateway cannot know the exact length here.
  @IsNumberString()
  @Length(MIN_OTP_CODE_LENGTH, MAX_OTP_CODE_LENGTH)
  readonly code!: string;
}

export class OtpStatusQueryDto {
  // A readable string (`?purpose=email_verification`), never the proto's
  // integer: a query param is a public contract. The gRPC client maps it.
  @IsIn(OTP_PURPOSES)
  readonly purpose!: OtpPurpose;
}
