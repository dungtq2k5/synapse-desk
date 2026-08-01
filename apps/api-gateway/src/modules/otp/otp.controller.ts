import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OtpGrpcClient } from './otp-grpc.client';
import {
  OtpStatusQueryDto,
  OtpStatusResponseDto,
  RequestOtpResponseDto,
  RequestPhoneVerificationDto,
  VerifyOtpDto,
  VerifyOtpResponseDto,
} from '../auth/dto/rest/otp.dto';

/**
 * Email and phone ownership challenges (api-endpoints-plan §1.1).
 *
 * Every route is SELF-scoped: the user id comes from the JWT, never from the
 * path or body, so one user cannot trigger or consume another's codes.
 *
 * **No `GuestGuard` anywhere here, and no `EmailVerifiedGuard` either** — both
 * would be wrong, for opposite reasons:
 *
 * - `GuestGuard` REJECTS callers who hold a live session. Every route below
 *   needs one (`JwtAuthGuard` at the class level), so adding it would reject
 *   100% of traffic. Its purpose is to stop an already-logged-in user from
 *   hitting `/login` and silently replacing their session; that has nothing to
 *   do with verification.
 *
 * - `EmailVerifiedGuard` would deadlock the account: these are the endpoints by
 *   which an unverified user BECOMES verified, so requiring verification to
 *   reach them means it can never happen.
 *
 * Your instinct about "an unverified user is still a guest" is the thing to
 * separate out: unverified is not un-authenticated. Such a user has a real
 * session and a real identity — they are simply LIMITED, and that limit is
 * enforced on business routes by `EmailVerifiedGuard`, not here.
 */
@Controller('auth')
@UseGuards(JwtAuthGuard)
export class OtpController {
  constructor(private readonly otpGrpcClient: OtpGrpcClient) {}

  /**
   * Issues (or re-issues) an email verification code. Registration already sends
   * the first one; this is the resend path.
   */
  @Post('email/verify/request')
  @HttpCode(HttpStatus.ACCEPTED)
  requestEmailVerification(
    @CurrentUser() context: RequestContext,
  ): Promise<RequestOtpResponseDto> {
    return this.otpGrpcClient.requestEmailVerification(context.sub, context);
  }

  /**
   * On success the caller should follow with `POST /auth/refresh`: the
   * `isEmailVerified` claim is baked into the access token, so it stays `false`
   * until the token rotates.
   */
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  verifyEmail(
    @CurrentUser() context: RequestContext,
    @Body() verifyOtpDto: VerifyOtpDto,
  ): Promise<VerifyOtpResponseDto> {
    return this.otpGrpcClient.verifyEmail(
      context.sub,
      verifyOtpDto.code,
      context,
    );
  }

  @Post('phone/verify/request')
  @HttpCode(HttpStatus.ACCEPTED)
  requestPhoneVerification(
    @CurrentUser() context: RequestContext,
    @Body() dto: RequestPhoneVerificationDto,
  ): Promise<RequestOtpResponseDto> {
    return this.otpGrpcClient.requestPhoneVerification(
      context.sub,
      dto.phoneNumber,
      context,
    );
  }

  @Post('phone/verify')
  @HttpCode(HttpStatus.OK)
  verifyPhone(
    @CurrentUser() context: RequestContext,
    @Body() verifyOtpDto: VerifyOtpDto,
  ): Promise<VerifyOtpResponseDto> {
    return this.otpGrpcClient.verifyPhone(
      context.sub,
      verifyOtpDto.code,
      context,
    );
  }

  /** Drives the resend UI. Never exposes the code or its hash. */
  @Get('otp/status')
  getOtpStatus(
    @CurrentUser() context: RequestContext,
    @Query() query: OtpStatusQueryDto,
  ): Promise<OtpStatusResponseDto> {
    return this.otpGrpcClient.getOtpStatus(context.sub, query.purpose, context);
  }
}
