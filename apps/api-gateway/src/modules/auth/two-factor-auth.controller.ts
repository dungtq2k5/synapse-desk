import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Logger,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  RequestContext,
  RequestOrigin,
  TwoFactorJwtPayload,
  OrgAccess,
} from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TwoFactorEnrolmentGuard } from '../../common/guards/two-factor-enrolment.guard';
import {
  CurrentEnrollee,
  type EnrolleeContext,
} from '../../common/decorators/current-enrollee.decorator';
import { Jwt2faGuard } from '../../common/guards/jwt-2fa.guard';
import { Current2faUser } from '../../common/decorators/current-2fa-user.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TwoFactorAuthService } from './two-factor-auth.service';
import { JwtCookieService } from './jwt-cookie.service';
import {
  ActivateTwoFactorDto,
  AuthenticateTwoFactorDto,
  BackupCodesResponseDto,
  BackupCodesStatusResponseDto,
  DisableTwoFactorDto,
  GenerateTwoFactorResponseDto,
  RegenerateBackupCodesDto,
  TwoFactorAuthenticatedResponseDto,
} from './dto/rest/two-factor.dto';
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
 * `/auth/2fa` — enrolment and recovery (api-endpoints-plan).
 *
 * Every route here except `authenticate` requires a full session: you must
 * already be logged in to change your own second factor. `authenticate` is the
 * exception because it is the second half of a login that has not completed
 * yet, and is authorized by the short-lived 2FA cookie instead.
 */
@ApiTags('Two Factor Auth')
@ApiCookieAuth(AUTH_SCHEMES.access)
@AuthThrottle()
@OrgAccessKind(OrgAccess.AUTH)
@Controller('auth/2fa')
export class TwoFactorAuthController {
  private readonly logger = new Logger(TwoFactorAuthController.name);

  constructor(
    private readonly twoFactorAuthService: TwoFactorAuthService,
    private readonly jwtCookieService: JwtCookieService,
  ) {}

  /**
   * Returns a QR code to scan. Does NOT enable 2FA — `activate` does.
   *
   * `TwoFactorEnrolmentGuard`, not `JwtAuthGuard`: a user whose TENANT has just
   * turned on `enforce_two_factor` holds only a challenge token, and this is
   * the door they have to come through. auth-service still refuses an account
   * whose 2FA is already enabled, so the challenge token cannot be used to
   * replace a live secret.
   */
  @ApiOperation({
    summary:
      'Generate + encrypt two_factor_secret, return otpauth:// URI and QR data URL',
  })
  @ApiWrappedResponse(GenerateTwoFactorResponseDto)
  @ApiFilterErrors(['401'])
  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TwoFactorEnrolmentGuard)
  generate(
    @CurrentEnrollee() enrollee: EnrolleeContext,
  ): Promise<GenerateTwoFactorResponseDto> {
    return this.twoFactorAuthService.generate(enrollee.sub, enrollee);
  }

  /**
   * Confirms the authenticator works, enables 2FA, returns the backup codes.
   *
   * A caller who arrived on a challenge token is still NOT signed in
   * afterwards: they finish by calling `POST /auth/2fa/authenticate` with the
   * same challenge cookie and their first code, which is the one path that
   * mints a session. Issuing tokens here instead would give enrolment a second
   * session-minting door to keep correct.
   */
  @ApiOperation({
    summary:
      'Confirm a TOTP code → is_two_factor_enabled = true; returns the one-time plaintext backup codes',
  })
  @ApiWrappedResponse(BackupCodesResponseDto)
  @ApiFilterErrors(['400', '401'])
  @Post('enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TwoFactorEnrolmentGuard)
  async activate(
    @CurrentEnrollee() enrollee: EnrolleeContext,
    @Body() activateTwoFactorDto: ActivateTwoFactorDto,
  ): Promise<BackupCodesResponseDto> {
    const backupCodes = await this.twoFactorAuthService.activate(
      enrollee.sub,
      activateTwoFactorDto.code,
      enrollee,
    );

    // The only time these are ever readable. Only hashes are stored.
    return { backupCodes };
  }

  /**
   * Second leg of login: swap the 2FA cookie for real session cookies.
   *
   * Guarded by `Jwt2faGuard`, NOT `JwtAuthGuard` — the caller holds no access
   * token yet, which is the entire point. The guard verifies the challenge
   * cookie's signature and expiry before the handler runs, so a missing,
   * forged or expired token is a 401 at the edge instead of a round trip to
   * auth-service.
   *
   * `@Current2faUser` is what proves the guard ran. The raw token is still
   * forwarded because auth-service re-verifies it — it is the authority on
   * whether the challenge is live, and the gateway only pre-screens.
   */
  @ApiOperation({
    summary: 'Second leg of login',
    description:
      'Authenticated by the 2FA CHALLENGE cookie, not the access one — 24-doc ' +
      '§3. That token proves a password and nothing else; it is signed by a ' +
      'different keypair so it cannot verify where an access token is expected.',
    // **Set here rather than with `@ApiCookieAuth`**: that decorator APPENDS to
    // the controller-level requirement, and two entries in `security` mean OR —
    // documenting this route as accepting an access token, which it does not.
    security: [{ [AUTH_SCHEMES.mfa]: [] }],
  })
  @ApiWrappedResponse(TwoFactorAuthenticatedResponseDto)
  @ApiFilterErrors(['400', '401'])
  @Post('authenticate')
  @Throttle({ [AUTH_THROTTLER_TIER]: ROUTE_THROTTLE.twoFactorAuthenticate })
  @HttpCode(HttpStatus.OK)
  @UseGuards(Jwt2faGuard)
  async authenticate(
    @Current2faUser() challenge: TwoFactorJwtPayload,
    @Body() authenticateTwoFactorDto: AuthenticateTwoFactorDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TwoFactorAuthenticatedResponseDto> {
    // Non-null is safe here and nowhere else: Jwt2faGuard read this very cookie
    // to authorize the request, so the handler cannot run without it.
    const twoFactorToken = this.jwtCookieService.read2faToken(request)!;

    this.logger.debug(
      `Completing two-factor challenge for user ${challenge.sub}`,
    );
    // The TOKEN is forwarded, not `challenge.sub`, and auth-service verifies it
    // again on purpose.
    //
    // A user id is a CLAIM; the signed token is PROOF. If auth-service trusted a
    // caller-supplied id, then anything able to reach its gRPC port — another
    // service, a pod on a flat network, a port-forward during debugging — could
    // complete a two-factor challenge for any account by sending
    // `{ userId: '<victim>' }` with no token at all. The gateway would no longer
    // be a checkpoint, it would be the only checkpoint, and services behind a
    // gateway are exactly the things that get reached directly by accident.
    //
    // The saving would be one HMAC verify (microseconds) against losing the
    // property that possession of the token is what authorizes the exchange. So
    // the guard here is a fast 401 at the edge, and auth-service remains the
    // authority — `challenge.sub` is used only for the log line above.
    const result = await this.twoFactorAuthService.authenticate(
      twoFactorToken,
      authenticateTwoFactorDto,
      this.requestOrigin(request),
    );

    // The challenge is spent — clear it before setting the real session, so a
    // failure between the two cannot leave a reusable challenge behind.
    this.jwtCookieService.clear2faTokenCookie(response);
    this.jwtCookieService.setAccessTokenCookie(response, result.accessToken);
    this.jwtCookieService.setRefreshTokenCookie(response, result.refreshToken);

    if (result.deviceToken) {
      this.jwtCookieService.setDeviceTokenCookie(response, result.deviceToken);
    }

    return { user: result.user, warning: result.warning };
  }

  @ApiOperation({ summary: 'Disable 2FA (requires TOTP + password)' })
  @ApiWrappedResponse()
  @ApiFilterErrors(['400', '401'])
  @Delete()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async disable(
    @CurrentUser() context: RequestContext,
    @Body() disableTwoFactorDto: DisableTwoFactorDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.twoFactorAuthService.disable(
      context.sub,
      disableTwoFactorDto,
      context,
    );

    // auth-service just un-trusted every device; drop the now-meaningless
    // cookie rather than leaving the browser to present a dead token.
    this.jwtCookieService.clearDeviceTokenCookie(response);
  }

  @ApiOperation({ summary: 'Regenerate two_factor_backup_codes (30d expiry)' })
  @ApiWrappedResponse(BackupCodesResponseDto)
  @ApiFilterErrors(['400', '401'])
  @Post('backup-codes')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async regenerateBackupCodes(
    @CurrentUser() context: RequestContext,
    @Body() regenerateBackupCodesDto: RegenerateBackupCodesDto,
  ): Promise<BackupCodesResponseDto> {
    const backupCodes = await this.twoFactorAuthService.regenerateBackupCodes(
      context.sub,
      regenerateBackupCodesDto.password,
      context,
    );

    return { backupCodes };
  }

  /** Counts only — never hashes, never plaintext. */
  @ApiOperation({
    summary: 'Metadata only — count remaining, is_used, expires_at',
  })
  @ApiWrappedResponse(BackupCodesStatusResponseDto)
  @ApiFilterErrors(['401'])
  @Get('backup-codes')
  @UseGuards(JwtAuthGuard)
  getBackupCodesStatus(
    @CurrentUser() context: RequestContext,
  ): Promise<BackupCodesStatusResponseDto> {
    return this.twoFactorAuthService.getBackupCodesStatus(context.sub, context);
  }

  private requestOrigin(request: Request): RequestOrigin {
    return {
      ip: request.ip ?? '',
      userAgent: request.get('user-agent') ?? '',
    };
  }
}
