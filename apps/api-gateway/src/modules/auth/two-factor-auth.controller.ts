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
} from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
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

/**
 * `/auth/2fa` — enrolment and recovery (api-endpoints-plan §1.2).
 *
 * Every route here except `authenticate` requires a full session: you must
 * already be logged in to change your own second factor. `authenticate` is the
 * exception because it is the second half of a login that has not completed
 * yet, and is authorized by the short-lived 2FA cookie instead.
 */
@Controller('auth/2fa')
export class TwoFactorAuthController {
  private readonly logger = new Logger(TwoFactorAuthController.name);

  constructor(
    private readonly twoFactorAuthService: TwoFactorAuthService,
    private readonly jwtCookieService: JwtCookieService,
  ) {}

  /** Returns a QR code to scan. Does NOT enable 2FA — `activate` does. */
  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  generate(
    @CurrentUser() context: RequestContext,
  ): Promise<GenerateTwoFactorResponseDto> {
    return this.twoFactorAuthService.generate(context.sub, context);
  }

  /** Confirms the authenticator works, enables 2FA, returns the backup codes. */
  @Post('enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async activate(
    @CurrentUser() context: RequestContext,
    @Body() activateTwoFactorDto: ActivateTwoFactorDto,
  ): Promise<BackupCodesResponseDto> {
    const backupCodes = await this.twoFactorAuthService.activate(
      context.sub,
      activateTwoFactorDto.code,
      context,
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
  @Post('authenticate')
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
