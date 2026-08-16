import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto, RegisterResponseDto } from './dto/rest/register.dto';
import { JwtCookieService } from './jwt-cookie.service';
import { RequestContext, RequestOrigin, OrgAccess } from '@synapsedesk/common';
import { CurrentOrigin } from '../../common/decorators/current-origin.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ForgotPasswordDto } from './dto/rest/forgot-password.dto';
import {
  ChangePasswordDto,
  ChangePasswordResponseDto,
  ResetPasswordDto,
  ResetPasswordResponseDto,
  ValidatePasswordResetTokenResponseDto,
} from './dto/rest/reset-password.dto';
import { GuestGuard } from '../../common/guards/guest.guard';
import {
  LoginDto,
  LoginOutcomeDto,
  LoginResponseDto,
  LoginWithTenantDto,
  // The three members of `LoginOutcomeDto` The union itself is a
  // type alias with no runtime identity, so `oneOf` over its members is the only
  // way to describe it; documenting only the happy one would tell a client that
  // the 2FA challenge is a malformed response.
  TenantSelectionResponseDto,
} from './dto/rest/login.dto';
// The third member of `LoginOutcomeDto`, which lives with the 2FA DTOs.
import { TwoFactorRequiredResponseDto } from './dto/rest/two-factor.dto';
import type { LoginResult } from './auth-service-grpc.client';
import { GoogleSignInDto } from './dto/rest/google-sign-in.dto';
import {
  LogoutAllResponseDto,
  LogoutDto,
  LogoutResponseDto,
} from './dto/rest/logout.dto';
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

@ApiTags('Auth')
@ApiCookieAuth(AUTH_SCHEMES.access)
@AuthThrottle()
@OrgAccessKind(OrgAccess.AUTH)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtCookieService: JwtCookieService,
  ) {}

  @ApiOperation({
    summary: 'Sign up',
    security: [],
  })
  @ApiWrappedResponse(RegisterResponseDto, { status: HttpStatus.CREATED })
  @ApiFilterErrors(['400', '401'])
  @Post('register')
  @Throttle({ [AUTH_THROTTLER_TIER]: ROUTE_THROTTLE.register })
  @UseGuards(GuestGuard)
  register(
    @Body() registerDto: RegisterDto,
    @CurrentOrigin() origin: RequestOrigin,
  ): Promise<RegisterResponseDto> {
    return this.authService.register(registerDto, origin);
  }

  /**
   * `@Res({ passthrough: true })` — a bare `@Res()` takes over the response and
   * disables Nest's serialization along with the global ValidationPipe's
   * transform.
   */
  @ApiOperation({
    summary: 'Email + password',
    security: [],
  })
  @ApiWrappedResponse([
    LoginResponseDto,
    TwoFactorRequiredResponseDto,
    TenantSelectionResponseDto,
  ])
  @ApiFilterErrors(['400', '401'])
  @Post('login')
  @Throttle({ [AUTH_THROTTLER_TIER]: ROUTE_THROTTLE.login })
  @HttpCode(HttpStatus.OK)
  @UseGuards(GuestGuard)
  async login(
    @Body() loginDto: LoginDto,
    @CurrentOrigin() origin: RequestOrigin,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginOutcomeDto> {
    const result = await this.authService.login(
      loginDto,
      origin,
      this.jwtCookieService.readDeviceToken(request),
    );

    return this.settleLogin(result, response);
  }

  /**
   * Second leg of a multi-tenant login: the caller picks a workspace.
   *
   * `GuestGuard` because this is still pre-authentication — nothing has been
   * issued yet. Authority comes from the tenant-selection cookie, which is
   * cleared on success exactly as the 2FA challenge is.
   */
  @ApiOperation({
    summary: 'Exchange tenantSelectionToken + { organizationId } for tokens',
    security: [],
  })
  @ApiWrappedResponse([
    LoginResponseDto,
    TwoFactorRequiredResponseDto,
    TenantSelectionResponseDto,
  ])
  @ApiFilterErrors(['400', '401'])
  @Post('login/tenant')
  @HttpCode(HttpStatus.OK)
  @UseGuards(GuestGuard)
  async loginWithTenant(
    @Body() loginWithTenantDto: LoginWithTenantDto,
    @CurrentOrigin() origin: RequestOrigin,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginOutcomeDto> {
    const tenantSelectionToken =
      this.jwtCookieService.readTenantSelectionToken(request);
    if (!tenantSelectionToken) {
      throw new UnauthorizedException(
        'No tenant selection is in progress. Start again from login.',
      );
    }

    const result = await this.authService.loginWithTenant(
      loginWithTenantDto,
      tenantSelectionToken,
      origin,
      this.jwtCookieService.readDeviceToken(request),
    );

    // Spent either way — the token named a set of accounts, and one has now
    // been chosen.
    this.jwtCookieService.clearTenantSelectionCookie(response);

    return this.settleLogin(result, response);
  }

  /**
   * Turns the three-way login result into cookies + a body.
   *
   * Shared by `/login`, `/login/tenant` and `/google` so the branch ORDER is
   * written once: tenant selection is checked before 2FA, because 2FA policy is
   * a per-tenant setting and is unanswerable until the tenant is known.
   */
  private settleLogin(
    result: LoginResult,
    response: Response,
  ): LoginOutcomeDto {
    if (result.requiresTenantSelection) {
      this.jwtCookieService.setTenantSelectionCookie(
        response,
        result.tenantSelectionToken,
      );
      return { requiresTenantSelection: true, tenants: result.tenants };
    }

    if (result.requiresTwoFactor) {
      this.jwtCookieService.set2faTokenCookie(response, result.twoFactorToken);
      // The setup flag has to reach the client: the same cookie means "enter
      // your code" in one case and "enrol now" in the other, and only the
      // server knows which.
      return {
        requiresTwoFactor: true,
        requiresTwoFactorSetup: result.requiresTwoFactorSetup,
      };
    }

    this.jwtCookieService.setAccessTokenCookie(response, result.accessToken);
    this.jwtCookieService.setRefreshTokenCookie(response, result.refreshToken);

    // The body carries no tokens. HttpOnly cookies are unreadable by JS, which
    // is the entire point — echoing the tokens back here would hand them to any
    // XSS on the page.
    return { user: result.user, requiresTwoFactor: false };
  }

  /**
   * Google sign-in, which doubles as sign-up.
   *
   * `GuestGuard` like `/login` — same "you already hold a live session" rule.
   * Can return the 2FA challenge, because signing in with Google proves only the
   * FIRST factor and the account may still carry a second.
   */
  @ApiOperation({
    summary:
      'Verify a Firebase-issued Google ID token, upsert the user with password_hash = NULL, resolve the tenant, issue tokens',
    security: [],
  })
  @ApiWrappedResponse([
    LoginResponseDto,
    TwoFactorRequiredResponseDto,
    TenantSelectionResponseDto,
  ])
  @ApiFilterErrors(['400', '401'])
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @UseGuards(GuestGuard)
  async googleSignIn(
    @Body() googleSignInDto: GoogleSignInDto,
    @CurrentOrigin() origin: RequestOrigin,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginOutcomeDto> {
    const result = await this.authService.googleSignIn(
      googleSignInDto,
      origin,
      this.jwtCookieService.readDeviceToken(request),
    );

    return this.settleLogin(result, response);
  }

  /**
   * Ends the current session.
   *
   * NO guard, deliberately — not even `JwtAuthGuard`. The access token is
   * short-lived and may already have expired when the user clicks "log out";
   * refusing to log them out for that reason is exactly backwards. Authority
   * comes from possession of the refresh cookie, which auth-service looks up.
   */
  @ApiOperation({
    summary:
      'Revoke the current session — expires every row in its family_id, not just the current token',
  })
  @ApiWrappedResponse(LogoutResponseDto)
  @ApiFilterErrors(['400', '401'])
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body() logoutDto: LogoutDto,
    @CurrentOrigin() origin: RequestOrigin,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LogoutResponseDto> {
    const refreshToken = this.jwtCookieService.readRefreshToken(request);

    const revokedSessionCount = refreshToken
      ? await this.authService.logout(
          refreshToken,
          logoutDto.allDevices ?? false,
          origin,
        )
      : 0;

    // Cleared unconditionally. Even with no server-side session left to revoke,
    // the caller asked to be logged out and must not keep holding cookies.
    this.jwtCookieService.clearSessionCookies(response);
    if (logoutDto.allDevices) {
      this.jwtCookieService.clearDeviceTokenCookie(response);
    }

    return { revokedSessionCount };
  }

  /**
   * "Sign out everywhere" — the stolen-device button.
   *
   * Behind `JwtAuthGuard` rather than keyed off the refresh cookie, unlike
   * `/auth/logout`. Someone reaching for this has often lost the device holding
   * that cookie, so requiring one would fail exactly when it is needed.
   *
   * Takes device TRUST with it, so the thief cannot skip 2FA on the next login.
   */
  @ApiOperation({
    summary:
      'Revoke every session for the user across all families ("log out of all devices", RDM §1.5)',
  })
  @ApiWrappedResponse(LogoutAllResponseDto)
  @ApiFilterErrors(['401'])
  @Post('logout/all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Signed out of all devices')
  async logoutAll(
    @CurrentUser() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LogoutAllResponseDto> {
    const revokedSessionCount = await this.authService.logoutAll(context);

    this.jwtCookieService.clearSessionCookies(response);
    this.jwtCookieService.clearDeviceTokenCookie(response);

    return { revokedSessionCount };
  }

  /**
   * Change a password you know. Distinct from `/auth/password/reset`, whose
   * caller is unauthenticated by definition — which is why that one revokes
   * every session and this one deliberately spares the caller's own.
   *
   * KNOWN GAP: this needs a rate limit. Without the current-password check it
   * would be a session-hijack escalation; with the check but no limit it is an
   * online password oracle for an attacker who already holds a session.
   * `@nestjs/throttler` is not installed yet (see the remaining-work plan).
   */
  @ApiOperation({ summary: 'Change password (requires current password)' })
  @ApiWrappedResponse(ChangePasswordResponseDto)
  @ApiFilterErrors(['400', '401'])
  @Patch('password')
  @Throttle({ [AUTH_THROTTLER_TIER]: ROUTE_THROTTLE.changePassword })
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Password changed')
  async changePassword(
    @CurrentUser() context: RequestContext,
    @Body() changePasswordDto: ChangePasswordDto,
    @Req() request: Request,
  ): Promise<ChangePasswordResponseDto> {
    const revokedSessionCount = await this.authService.changePassword(
      changePasswordDto,
      // Identifies the session to SPARE. Read from the cookie, never the body.
      this.jwtCookieService.readRefreshToken(request),
      context,
    );

    return { revokedSessionCount };
  }

  /**
   * Rotates the refresh token and re-issues the access token.
   *
   * NO guard — an expired access token is the entire reason to be here, so
   * `JwtAuthGuard` would make refresh impossible, and `GuestGuard` would reject
   * exactly the callers who still have a valid one. The refresh cookie is the
   * credential; auth-service validates and rotates it.
   */
  @ApiOperation({
    summary: 'Rotate the refresh token',
    description:
      'Authenticated by the REFRESH cookie, not the access one — 24-doc §3. It ' +
      'is the only route that accepts it, which is what limits the blast radius ' +
      'of a stolen refresh token to this single endpoint.',
    // Set here rather than with `@ApiCookieAuth`, which would APPEND to the
    // controller's access-cookie requirement — and two entries mean OR, i.e.
    // "an access token also works here", which is exactly what must not be true.
    security: [{ [AUTH_SCHEMES.refresh]: [] }],
  })
  @ApiWrappedResponse(LoginResponseDto)
  @ApiFilterErrors(['401'])
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @CurrentOrigin() origin: RequestOrigin,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponseDto> {
    const refreshToken = this.jwtCookieService.readRefreshToken(request);
    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const result = await this.authService.refreshToken(refreshToken, origin);

    this.jwtCookieService.setAccessTokenCookie(response, result.accessToken);
    this.jwtCookieService.setRefreshTokenCookie(response, result.refreshToken);

    return { user: result.user, requiresTwoFactor: false };
  }

  /**
   * Always 202, whether or not the address exists. Anything else turns this
   * into the account-enumeration oracle avoided everywhere else.
   */
  @ApiOperation({
    summary:
      'Create a password_reset_tokens row (hashed token, ip_address, user_agent, 1h expires_at) and email the reset link',
    security: [],
  })
  @ApiWrappedResponse(undefined, { status: HttpStatus.ACCEPTED })
  @ApiFilterErrors(['400', '401'])
  @Post('password/forgot')
  @Throttle({ [AUTH_THROTTLER_TIER]: ROUTE_THROTTLE.forgotPassword })
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body() forgotPasswordDto: ForgotPasswordDto,
    @CurrentOrigin() origin: RequestOrigin,
  ): Promise<void> {
    await this.authService.forgotPassword(forgotPasswordDto.email, origin);
  }

  /** Pre-flight, so the UI can refuse a dead link before rendering the form. */
  @ApiOperation({
    summary:
      'Validate a reset token before rendering the form (is_used = false AND expires_at > NOW())',
    security: [],
  })
  @ApiWrappedResponse(ValidatePasswordResetTokenResponseDto)
  @ApiFilterErrors(['401', '404'])
  @Get('password/reset/:token')
  validatePasswordResetToken(
    @Param('token') token: string,
    @CurrentOrigin() origin: RequestOrigin,
  ): Promise<ValidatePasswordResetTokenResponseDto> {
    return this.authService.validatePasswordResetToken(token, origin);
  }

  @ApiOperation({
    summary:
      "Consume the token: set is_used = true, write the new password_hash, invalidate the user's other outstanding tokens, and revoke every device_sessions row",
    security: [],
  })
  @ApiWrappedResponse(ResetPasswordResponseDto)
  @ApiFilterErrors(['400', '401'])
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() resetPasswordDto: ResetPasswordDto,
    @CurrentOrigin() origin: RequestOrigin,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ResetPasswordResponseDto> {
    const result = await this.authService.resetPassword(
      resetPasswordDto.token,
      resetPasswordDto.newPassword,
      origin,
    );

    // auth-service just deleted every session for this user, trusted devices
    // included. Clear the caller's cookies so the browser matches that reality
    // rather than holding tokens the server no longer honours.
    this.jwtCookieService.clearAccessTokenCookie(response);
    this.jwtCookieService.clearRefreshTokenCookie(response);
    this.jwtCookieService.clearDeviceTokenCookie(response);

    return result;
  }
}
