import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { readFileSync } from 'node:fs';
import { JwtPayload, MaybeJwtPayload } from '@synapsedesk/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    // Resolved before super() — the previous version read it inside the
    // extractor via `this.configService`, which is not available until after
    // super() returns.
    const cookieName = configService.getOrThrow<string>('JWT_ACCESS_NAME');

    super({
      /**
       * Cookie first, Authorization header second.
       *
       * The cookie stays the default because it is HttpOnly, so XSS cannot read
       * it. The Bearer header exists for callers with no cookie jar — mobile
       * clients, server-to-server integrations, curl in a test — where it is
       * the only option.
       *
       * Order matters: cookie-first means a request that somehow carries both
       * resolves to the browser's own session rather than an injected header.
       */
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request): string | null => {
          return (request?.cookies?.[cookieName] as string | undefined) || null;
        },
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: readFileSync(
        configService.getOrThrow<string>('JWT_ACCESS_PUBLIC_KEY_PATH'),
      ),
      algorithms: ['RS256'],
    });
  }

  validate(payload: MaybeJwtPayload): JwtPayload {
    /**
     * Rejects a 2FA CHALLENGE token presented as an access token.
     *
     * Strictly speaking: no, this is no longer required. The two token types are
     * signed by separate key pairs, so a challenge token fails signature
     * verification above and never reaches `validate`.
     *
     * It stays anyway, for two reasons. The failure it guards against is severe
     * and silent — a caller who merely STARTED a login satisfying every
     * protected route — and the check is a single property read on an object
     * already in hand. And it keeps working if the keys are ever consolidated,
     * or if some future token is minted from the 2FA key for another purpose.
     * Defence that costs nothing is worth keeping even once it is redundant.
     */
    if (payload.is2faPending) {
      throw new UnauthorizedException(
        'Two-factor challenge is not complete; finish it before using this token',
      );
    }

    // Passport attaches this to req.user
    return payload as JwtPayload;
  }
}
