import { SetMetadata } from '@nestjs/common';

export const IS_AUTH_ROUTE_KEY = 'isAuthRoute';

/**
 * Marks a controller or handler as security-sensitive, so
 * `SmartThrottlerGuard` evaluates the strict `authTier` for it and skips the
 * loose general tiers.
 *
 * Class-level covers every handler in the controller; method-level marks just
 * that one. Prefer class-level on auth controllers — a route added later is
 * then protected by default, whereas a per-method list is one forgotten
 * decorator away from an unlimited login endpoint.
 *
 * The decorator alone enforces nothing: it sets metadata that the guard reads,
 * and the guard is registered globally in AppModule.
 */
export const AuthThrottle = () => SetMetadata(IS_AUTH_ROUTE_KEY, true);
