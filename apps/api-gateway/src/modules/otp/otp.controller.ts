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
import { RequestContext, OrgAccess } from '@synapsedesk/common';
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
import { AuthThrottle } from '../../common/decorators/auth-throttle.decorator';
import { Throttle } from '@nestjs/throttler';
import {
  AUTH_THROTTLER_TIER,
  ROUTE_THROTTLE,
} from '../../common/config/throttler.config';
import { OrgAccessKind } from '../../common/decorators/org-access.decorator';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';

/**
 * Email and phone ownership challenges (api-endpoints-plan).
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
@ApiTags('Otp')
@ApiCookieAuth(AUTH_SCHEMES.access)
@AuthThrottle()
@OrgAccessKind(OrgAccess.AUTH)
@Controller('auth')
@UseGuards(JwtAuthGuard)
export class OtpController {
  constructor(private readonly otpGrpcClient: OtpGrpcClient) {}

  /**
   * Issues (or re-issues) an email verification code. Registration already sends
   * the first one; this is the resend path.
   */
  @ApiOperation({
    summary:
      'Issue an otps row (purpose = email_verification, target = users.email) and mail the 6-digit code',
  })
  @ApiWrappedResponse(RequestOtpResponseDto, { status: HttpStatus.ACCEPTED })
  @ApiFilterErrors(['401'])
  @ApiOperation({
    summary:
      'Issue an otps row (purpose = email_verification, target = users.email) and mail the 6-digit code',
  })
  @ApiWrappedResponse(RequestOtpResponseDto, { status: HttpStatus.ACCEPTED })
  @ApiFilterErrors(['401'])
  @Post('email/verify/request')
  @Throttle({ [AUTH_THROTTLER_TIER]: ROUTE_THROTTLE.otpRequest })
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
  @ApiOperation({ summary: 'Submit { code }' })
  @ApiWrappedResponse(VerifyOtpResponseDto)
  @ApiFilterErrors(['400', '401'])
  @ApiOperation({ summary: 'Submit { code }' })
  @ApiWrappedResponse(VerifyOtpResponseDto)
  @ApiFilterErrors(['400', '401'])
  @Post('email/verify')
  @Throttle({ [AUTH_THROTTLER_TIER]: ROUTE_THROTTLE.otpVerify })
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

  @ApiOperation({
    summary:
      'Issue an otps row (purpose = phone_verification) and SMS the code',
  })
  @ApiWrappedResponse(RequestOtpResponseDto, { status: HttpStatus.ACCEPTED })
  @ApiFilterErrors(['400', '401'])
  @ApiOperation({
    summary:
      'Issue an otps row (purpose = phone_verification) and SMS the code',
  })
  @ApiWrappedResponse(RequestOtpResponseDto, { status: HttpStatus.ACCEPTED })
  @ApiFilterErrors(['400', '401'])
  @Post('phone/verify/request')
  @Throttle({ [AUTH_THROTTLER_TIER]: ROUTE_THROTTLE.otpRequest })
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

  @ApiOperation({ summary: 'Submit { code }' })
  @ApiWrappedResponse(VerifyOtpResponseDto)
  @ApiFilterErrors(['400', '401'])
  @ApiOperation({ summary: 'Submit { code }' })
  @ApiWrappedResponse(VerifyOtpResponseDto)
  @ApiFilterErrors(['400', '401'])
  @Post('phone/verify')
  @Throttle({ [AUTH_THROTTLER_TIER]: ROUTE_THROTTLE.otpVerify })
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
  @ApiOperation({
    summary:
      '?purpose= — outstanding-challenge state for the resend UI: { pending, target (masked), expiresAt, attemptsRemaining }',
  })
  @ApiWrappedResponse(OtpStatusResponseDto)
  @ApiFilterErrors(['401'])
  @ApiOperation({
    summary:
      '?purpose= — outstanding-challenge state for the resend UI: { pending, target (masked), expiresAt, attemptsRemaining }',
  })
  @ApiWrappedResponse(OtpStatusResponseDto)
  @ApiFilterErrors(['401'])
  @Get('otp/status')
  getOtpStatus(
    @CurrentUser() context: RequestContext,
    @Query() query: OtpStatusQueryDto,
  ): Promise<OtpStatusResponseDto> {
    return this.otpGrpcClient.getOtpStatus(context.sub, query.purpose, context);
  }
}
