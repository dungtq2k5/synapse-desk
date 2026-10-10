import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieSameSite, NodeEnv } from '@synapsedesk/common';
import type { Response } from 'express';

/** Anything cookie-parser has run over. */
type CookieCarrier = { cookies?: Record<string, string> };

@Injectable()
export class JwtCookieService {
  private readonly JWT_ACCESS_NAME: string;
  private readonly JWT_REFRESH_NAME: string;
  private readonly JWT_2FA_NAME: string;
  private readonly DEVICE_TOKEN_NAME: string;
  private readonly TENANT_SELECTION_NAME: string;

  private readonly COOKIE_ACCESS_MAX_AGE: number;
  private readonly COOKIE_REFRESH_MAX_AGE: number;
  private readonly COOKIE_2FA_MAX_AGE: number;
  private readonly COOKIE_DEVICE_MAX_AGE: number;
  private readonly COOKIE_TENANT_SELECTION_MAX_AGE: number;

  private readonly COOKIE_SAMESITE: CookieSameSite;

  private readonly IS_PRODUCTION: boolean;

  constructor(private readonly configService: ConfigService) {
    this.JWT_ACCESS_NAME =
      this.configService.getOrThrow<string>('JWT_ACCESS_NAME');
    this.JWT_REFRESH_NAME =
      this.configService.getOrThrow<string>('JWT_REFRESH_NAME');
    this.JWT_2FA_NAME = this.configService.getOrThrow<string>('JWT_2FA_NAME');
    this.DEVICE_TOKEN_NAME =
      this.configService.getOrThrow<string>('DEVICE_TOKEN_NAME');
    this.TENANT_SELECTION_NAME = this.configService.getOrThrow<string>(
      'TENANT_SELECTION_NAME',
    );

    this.COOKIE_ACCESS_MAX_AGE = this.configService.getOrThrow<number>(
      'COOKIE_ACCESS_MAX_AGE',
    );
    this.COOKIE_REFRESH_MAX_AGE = this.configService.getOrThrow<number>(
      'COOKIE_REFRESH_MAX_AGE',
    );
    this.COOKIE_2FA_MAX_AGE =
      this.configService.getOrThrow<number>('COOKIE_2FA_MAX_AGE');
    this.COOKIE_DEVICE_MAX_AGE = this.configService.getOrThrow<number>(
      'COOKIE_DEVICE_MAX_AGE',
    );
    this.COOKIE_TENANT_SELECTION_MAX_AGE =
      this.configService.getOrThrow<number>('COOKIE_TENANT_SELECTION_MAX_AGE');

    this.COOKIE_SAMESITE =
      this.configService.getOrThrow<CookieSameSite>('COOKIE_SAMESITE');

    this.IS_PRODUCTION =
      this.configService.getOrThrow<NodeEnv>('NODE_ENV') === 'production';
  }

  setAccessTokenCookie(response: Response, token: string): void {
    this.setTokenCookie(
      response,
      this.JWT_ACCESS_NAME,
      token,
      this.COOKIE_ACCESS_MAX_AGE,
    );
  }

  setRefreshTokenCookie(response: Response, refreshToken: string): void {
    this.setTokenCookie(
      response,
      this.JWT_REFRESH_NAME,
      refreshToken,
      this.COOKIE_REFRESH_MAX_AGE,
    );
  }

  set2faTokenCookie(response: Response, mfaToken: string): void {
    this.setTokenCookie(
      response,
      this.JWT_2FA_NAME,
      mfaToken,
      this.COOKIE_2FA_MAX_AGE,
    );
  }

  /**
   * The "remember this device" secret. Not a JWT and not a session token — an
   * opaque value whose only job is to prove, on a later login, that this
   * browser already passed a 2FA challenge.
   *
   * It must be a server-issued secret rather than anything the client can
   * describe about itself: trusting `deviceName` or the user-agent would mean
   * anyone who guesses the victim uses "Chrome on macOS" skips 2FA entirely.
   */
  setDeviceTokenCookie(response: Response, deviceToken: string): void {
    this.setTokenCookie(
      response,
      this.DEVICE_TOKEN_NAME,
      deviceToken,
      this.COOKIE_DEVICE_MAX_AGE,
    );
  }

  readDeviceToken(request: CookieCarrier): string | undefined {
    return request.cookies?.[this.DEVICE_TOKEN_NAME];
  }

  readRefreshToken(request: CookieCarrier): string | undefined {
    return request.cookies?.[this.JWT_REFRESH_NAME];
  }

  read2faToken(request: CookieCarrier): string | undefined {
    return request.cookies?.[this.JWT_2FA_NAME];
  }

  /** Ends a session on the client: everything the server just revoked. */
  clearSessionCookies(response: Response): void {
    this.clearAccessTokenCookie(response);
    this.clearRefreshTokenCookie(response);
    this.clear2faTokenCookie(response);
    this.clearTenantSelectionCookie(response);
  }

  /**
   * Carries the tenant-selection token between the two legs of a multi-tenant
   * login.
   *
   * A cookie rather than a response-body field for the same reason the 2FA
   * challenge is: it is a bearer credential, and putting it in the body hands it
   * to any XSS on the page. Short-lived to match its JWT.
   */
  setTenantSelectionCookie(response: Response, token: string): void {
    this.setTokenCookie(
      response,
      this.TENANT_SELECTION_NAME,
      token,
      this.COOKIE_TENANT_SELECTION_MAX_AGE,
    );
  }

  readTenantSelectionToken(request: CookieCarrier): string | undefined {
    return request.cookies?.[this.TENANT_SELECTION_NAME];
  }

  clearTenantSelectionCookie(response: Response): void {
    this.clearTokenCookie(response, this.TENANT_SELECTION_NAME);
  }

  clearDeviceTokenCookie(response: Response): void {
    this.clearTokenCookie(response, this.DEVICE_TOKEN_NAME);
  }

  clearAccessTokenCookie(response: Response): void {
    this.clearTokenCookie(response, this.JWT_ACCESS_NAME);
  }

  clear2faTokenCookie(response: Response): void {
    this.clearTokenCookie(response, this.JWT_2FA_NAME);
  }

  clearRefreshTokenCookie(response: Response): void {
    this.clearTokenCookie(response, this.JWT_REFRESH_NAME);
  }

  private setTokenCookie(
    response: Response,
    tokenName: string,
    token: string,
    maxAge: number,
    path: string = '/',
  ) {
    response.cookie(tokenName, token, {
      httpOnly: true, // Prevent XSS attacks
      secure: this.IS_PRODUCTION, // Only send cookie over HTTPS in production
      sameSite: this.COOKIE_SAMESITE, // Guards against CSRF attacks
      maxAge,
      path,
    });
  }

  private clearTokenCookie(
    response: Response,
    tokenName: string,
    path: string = '/',
  ) {
    response.clearCookie(tokenName, {
      httpOnly: true,
      secure: this.IS_PRODUCTION,
      sameSite: this.COOKIE_SAMESITE,
      path, // Ensure this matches the path where the cookie was originally set (default '/')
    });
  }
}
