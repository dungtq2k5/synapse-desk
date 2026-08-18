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
import { OtpService } from './otp.service';
import {
  OtpStatusQueryDto,
  RequestPhoneVerificationDto,
  VerifyOtpDto,
} from '../auth/dto/rest/otp.dto';
import {
  OtpStatusResponseDto,
  RequestOtpResponseDto,
  VerifyOtpResponseDto,
} from '../auth/dto/rest/otp-response.dto';
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
 * Email and phone ownership challenges.
 *
 * Every route is SELF-scoped: the user id comes from the JWT, never from the
 * path or body, so one user cannot trigger or consume another's codes.
 *
 * **No `GuestGuard` and no `EmailVerifiedGuard` here** — both would be wrong,
 * for opposite reasons:
 *
 *   - `GuestGuard` REJECTS callers holding a live session, and every route
 *     below needs one, so it would reject 100% of traffic.
 *   - `EmailVerifiedGuard` would deadlock the account: these are the endpoints
 *     by which an unverified user BECOMES verified.
 *
 * **Unverified is not un-authenticated.** Such a user has a real session and a
 * real identity and is simply LIMITED — a limit enforced on business routes,
 * not here.
 */
@ApiTags('Otp')
@ApiCookieAuth(AUTH_SCHEMES.access)
@AuthThrottle()
@OrgAccessKind(OrgAccess.AUTH)
@Controller('auth')
@UseGuards(JwtAuthGuard)
export class OtpController {
  constructor(private readonly otp: OtpService) {}

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
  @Post('email/verify/request')
  @Throttle({ [AUTH_THROTTLER_TIER]: ROUTE_THROTTLE.otpRequest })
  @HttpCode(HttpStatus.ACCEPTED)
  requestEmailVerification(
    @CurrentUser() context: RequestContext,
  ): Promise<RequestOtpResponseDto> {
    return this.otp.requestEmailVerification(context.sub, context);
  }

  /**
   * On success the caller should follow with `POST /auth/refresh`: the
   * `isEmailVerified` claim is baked into the access token, so it stays `false`
   * until the token rotates.
   */
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
    return this.otp.verifyEmail(context.sub, verifyOtpDto.code, context);
  }

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
    return this.otp.requestPhoneVerification(
      context.sub,
      dto.phoneNumber,
      context,
    );
  }

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
    return this.otp.verifyPhone(context.sub, verifyOtpDto.code, context);
  }

  /** Drives the resend UI. Never exposes the code or its hash. */
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
    return this.otp.getOtpStatus(context.sub, query.purpose, context);
  }
}
