import { Injectable } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * `JwtAuthGuard` that lets a caller without a valid session through, as
 * anonymous: `request.user` is set when the session is good and left unset
 * otherwise. For a route that serves both, like `POST /client-errors`.
 */
@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  override handleRequest<T>(error: unknown, user: T | false): T {
    return (error || !user ? undefined : user) as T;
  }
}
