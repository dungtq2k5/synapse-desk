import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeEnv } from '@synapsedesk/common';
import type { Response } from 'express';

@Injectable()
export class JwtCookieService {
  private readonly JWT_ACCESS_NAME: string;
  private readonly JWT_REFRESH_NAME: string;
  private readonly JWT_2FA_NAME: string;

  private readonly COOKIE_MAX_AGE: number;
  private readonly COOKIE_2FA_MAX_AGE: number;
  private readonly COOKIE_SAMESITE: CookieSameSite;

  private readonly IS_PRODUCTION: boolean;

  constructor(private readonly configService: ConfigService) {
    this.JWT_ACCESS_NAME =
      this.configService.getOrThrow<string>('JWT_ACCESS_NAME');
    this.JWT_REFRESH_NAME =
      this.configService.getOrThrow<string>('JWT_REFRESH_NAME');
    this.JWT_2FA_NAME = this.configService.getOrThrow<string>('JWT_2FA_NAME');

    this.COOKIE_MAX_AGE =
      this.configService.getOrThrow<number>('COOKIE_MAX_AGE');
    this.COOKIE_2FA_MAX_AGE =
      this.configService.getOrThrow<number>('COOKIE_2FA_MAX_AGE');
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
      this.COOKIE_MAX_AGE,
    );
  }

  setRefreshTokenCookie(response: Response, refreshToken: string): void {
    this.setTokenCookie(
      response,
      this.JWT_REFRESH_NAME,
      refreshToken,
      this.COOKIE_MAX_AGE,
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
  ) {
    response.cookie(tokenName, token, {
      httpOnly: true, // Prevent XSS attacks
      secure: this.IS_PRODUCTION, // Only send cookie over HTTPS in production
      sameSite: this.COOKIE_SAMESITE, // Guards against CSRF attacks
      maxAge,
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
