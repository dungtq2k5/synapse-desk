import {
  ForbiddenException,
  Injectable,
  type NestMiddleware,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { corsOrigins } from '../config/cors.config';

/** The methods that change something, and so the ones a forged request wants. */
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Refuses a state-changing request whose `Origin` is present and foreign: not
 * this gateway's own origin and not one `CORS` allows. 403, before any route.
 *
 * Defense in depth beside `SameSite=Lax` cookies. Lax counts a sibling
 * subdomain as same-site, and a bodiless cross-site `POST` (a form with no
 * fields) passes the JSON-only rule. A request with no `Origin` (a server, a
 * webhook sender, `curl`) is not a browser acting for someone and passes.
 * `CORS = *` allows every origin, so it allows every `Origin` here too.
 *
 * @example
 *   POST /api/v1/auth/logout   Origin: https://evil.example.com  → 403
 *   POST /api/v1/auth/logout   Origin: <this gateway's origin>   → passes
 */
@Injectable()
export class OriginMiddleware implements NestMiddleware {
  private readonly allowed: '*' | string[];

  constructor(config: ConfigService) {
    this.allowed = corsOrigins(config.getOrThrow<string>('CORS'));
  }

  use(request: Request, _response: Response, next: NextFunction): void {
    const origin = request.headers.origin;

    if (
      !UNSAFE.has(request.method) ||
      origin === undefined ||
      this.allowed === '*' ||
      this.allowed.includes(origin) ||
      origin === `${request.protocol}://${request.get('host')}`
    ) {
      next();

      return;
    }

    throw new ForbiddenException('Cross-origin request refused');
  }
}
