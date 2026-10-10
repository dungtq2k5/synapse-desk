import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { readFileSync } from 'node:fs';
import { TwoFactorJwtPayload } from '@synapsedesk/common';

/**
 * Validates the short-lived challenge token issued by `POST /auth/login` when a
 * second factor is required.
 *
 * A SEPARATE passport strategy from `jwt`, registered under its own name, and
 * that separation is the point: the 2FA token is signed with a different secret
 * and grants exactly one capability — completing the challenge. If both tokens
 * were validated by one strategy, a half-authenticated caller would satisfy
 * `JwtAuthGuard` and reach every `@UseGuards(JwtAuthGuard)` route in the
 * gateway without ever entering a code.
 */
@Injectable()
export class Jwt2faStrategy extends PassportStrategy(Strategy, 'jwt-2fa') {
  constructor(configService: ConfigService) {
    const cookieName = configService.getOrThrow<string>('JWT_2FA_NAME');

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) =>
          (request.cookies?.[cookieName] as string | undefined) ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: readFileSync(
        configService.getOrThrow<string>('JWT_2FA_PUBLIC_KEY_PATH'),
      ),
      algorithms: ['RS256'],
    });
  }

  validate(payload: TwoFactorJwtPayload): TwoFactorJwtPayload {
    // Defence in depth now that the keys are separate: an access token cannot
    // reach this point, because it is signed by a different key. Kept anyway —
    // it costs one comparison and it is what catches a future token minted from
    // the 2FA key for some other purpose.
    if (!payload.is2faPending) {
      throw new UnauthorizedException('Not a two-factor challenge token');
    }

    return payload;
  }
}
