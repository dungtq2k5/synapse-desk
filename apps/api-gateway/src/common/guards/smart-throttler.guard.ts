import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import {
  ThrottlerException,
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerRequest,
} from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { verify } from 'jsonwebtoken';
import { AUTH_THROTTLER_TIER } from '../config/throttler.config';
import { IS_AUTH_ROUTE_KEY } from '../decorators/auth-throttle.decorator';

/**
 * Routes requests to ONE tier set instead of all of them.
 *
 * Four tiers are registered globally, and without this guard every route would
 * be evaluated against all four. That is wrong in both directions:
 *
 *   - a login would also be governed by the loose `short` tier, so 100
 *     attempts/second would pass whichever general limit is most permissive
 *     before the strict one ever bit;
 *   - every ordinary read would be counted against the strict auth budget, and
 *     a busy dashboard would 429 itself out of the product.
 *
 * So: routes marked `@AuthThrottle()` see `authTier` ONLY; everything else sees
 * the general tiers only. The split is driven by metadata rather than a
 * hardcoded list of paths, which is what stops it going stale the moment
 * someone adds a route.
 */
@Injectable()
export class SmartThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(SmartThrottlerGuard.name);

  /**
   * Read from `process.env` rather than injected, and lazily.
   *
   * `ThrottlerGuard`'s constructor signature is the library's — adding a
   * `ConfigService` parameter means re-declaring all three of its arguments and
   * keeping them in step across upgrades, for two values that
   * `envValidationSchema` has already made a boot-time failure if absent. The
   * same reasoning `SecureGateway` uses for its CORS list.
   *
   * Lazy so that importing this class in a unit test does not require a key
   * file on disk.
   */
  private cachedAccessPublicKey?: Buffer;

  private get accessCookieName(): string {
    return process.env.JWT_ACCESS_NAME ?? 'access_token';
  }

  private get accessPublicKey(): Buffer {
    this.cachedAccessPublicKey ??= readFileSync(
      process.env.JWT_ACCESS_PUBLIC_KEY_PATH as string,
    );

    return this.cachedAccessPublicKey;
  }

  /**
   * The counter key: per USER, else per IP **and submitted account**.
   *
   * Three cases, in order:
   *
   *   1. **Authenticated** -> `user:<id>`. Keying an authenticated route by IP
   *      would put a whole corporate NAT in one bucket, so one heavy user
   *      throttles their colleagues.
   *
   *   2. **Unauthenticated but carrying an identifier** (login, register,
   *      forgot-password) -> `ip:<ip>|acct:<email>`. Keying these by IP ALONE
   *      is the same NAT problem in its worst form: five bad passwords from one
   *      office would lock every other employee out of signing in. Including
   *      the submitted address gives each ACCOUNT its own small budget, which
   *      is what actually stops password guessing — the attacker is guessing
   *      one account at a time.
   *
   *   3. **Neither** -> `ip:<ip>`.
   *
   * `req.body` is populated here because body-parser is middleware and
   * middleware runs before guards.
   *
   * **What this does NOT cover:** spraying one password across thousands of
   * DIFFERENT accounts from one IP. Each address gets its own budget, so the
   * per-account limit never trips. That needs a per-IP ceiling counted across
   * accounts, which the general tiers cannot express here because they share
   * this tracker — it is a genuinely separate control and belongs with a WAF or
   * fail2ban rather than being half-built in application code.
   *
   * The prefixes keep the key spaces disjoint: without them a user whose id
   * happened to equal an IP string would share a counter with that address.
   */
  protected override getTracker(req: Request): Promise<string> {
    // `req.user` is populated by `JwtAuthGuard`, which is a ROUTE-level guard —
    // and Nest runs GLOBAL guards first, so it is always undefined here.
    //
    // That was a silent bug for as long as this guard existed: the branch below
    // read as "authenticated callers are keyed per user" and never once
    // executed, so every authenticated route was quietly rate-limited per IP.
    // Harmless for the auth routes this guard was written for (they are
    // unauthenticated by definition) and exactly wrong for the AI routes added
    // in 16-doc §2, where ten agents behind one office NAT would share one
    // budget.
    //
    // It is kept as the first check because a future refactor that made this
    // guard route-level would populate it, and reading it is free.
    const userId = req.user?.sub ?? this.subjectFromToken(req);
    if (userId) return Promise.resolve(`user:${userId}`);

    const ip = req.ip ?? 'unknown';
    const account = extractAccountIdentifier(req);

    return Promise.resolve(account ? `ip:${ip}|acct:${account}` : `ip:${ip}`);
  }

  /**
   * The caller's id, VERIFIED here rather than trusted.
   *
   * Decoding without verifying would be worse than the IP fallback it replaces:
   * an attacker could mint an unsigned token with a random `sub` per request
   * and get a fresh bucket every time, which is a rate limiter that raises the
   * cost of evading it to zero. So the signature is checked with the same
   * public key `JwtStrategy` uses.
   *
   * The cost is one asymmetric verify per request that `JwtAuthGuard` will then
   * repeat — real, and the right trade: the alternative is a per-user limit
   * that is not per user.
   *
   * Returns null for anything that does not verify, and the caller falls back
   * to the IP-based keys. A request with a bad token is refused by the auth
   * guard moments later anyway; what matters here is that it cannot choose its
   * own bucket.
   */
  private subjectFromToken(req: Request): string | null {
    const token = extractAccessToken(req, this.accessCookieName);
    if (!token) return null;

    try {
      const payload = verify(token, this.accessPublicKey, {
        algorithms: ['RS256'],
      });

      return typeof payload === 'object' && typeof payload.sub === 'string'
        ? payload.sub
        : null;
    } catch {
      return null;
    }
  }

  protected override async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const { context, throttler } = requestProps;

    const isAuthRoute = this.reflector.getAllAndOverride<boolean>(
      IS_AUTH_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isAuthRoute) {
      // Auth routes ignore the general tiers entirely — the strict one is
      // always tighter, so evaluating both would only ever let something
      // through that `authTier` meant to stop.
      if (throttler.name !== AUTH_THROTTLER_TIER) return true;
    } else if (throttler.name === AUTH_THROTTLER_TIER) {
      // And everything else ignores the strict tier, or normal use would
      // exhaust a budget sized for credential stuffing.
      return true;
    }

    try {
      return await super.handleRequest(requestProps);
    } catch (error) {
      // A ThrottlerException is the guard working — let it through to the
      // filter. Anything else is the STORAGE failing.
      if (isThrottlerException(error)) throw error;

      // Fail OPEN, loudly. A Redis outage would otherwise turn a rate limiter
      // into a total outage: every request on every route would 500, including
      // the ones with no limit worth enforcing. The trade is explicit — while
      // Redis is down the strict tiers are not enforced, so this log line is
      // the signal that the protection is off, and it must be alerted on.
      this.logger.error(
        `Rate-limit storage unavailable; allowing request unthrottled: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return true;
    }
  }

  /**
   * Replaces the library's default 429 message and adds `Retry-After`.
   *
   * The default is the literal string `ThrottlerException: Too Many Requests`,
   * which leaks a class name into a user-facing body and says nothing a caller
   * can act on. `Retry-After` is the actionable part: without it a client has
   * no way to know whether to retry in a second or a quarter of an hour, so it
   * either hammers or gives up.
   */
  protected override throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfterSeconds = Math.ceil(throttlerLimitDetail.timeToBlockExpire);

    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', String(retryAfterSeconds));

    // Rejected rather than thrown: the base signature returns Promise<void>,
    // and there is nothing to await here.
    return Promise.reject(
      new ThrottlerException(
        `Too many requests. Try again in ${describeWait(retryAfterSeconds)}.`,
      ),
    );
  }

  /**
   * The request the tracker sees.
   *
   * Overridden only to type it — this gateway is HTTP-only, so unlike the
   * reference implementation there is no GraphQL or WebSocket context to
   * unwrap. Adding those branches now would be dead code referencing packages
   * this app does not depend on.
   */
  protected override getRequestResponse(context: ExecutionContext): {
    req: Request;
    res: Response;
  } {
    const http = context.switchToHttp();

    return {
      req: http.getRequest<Request>(),
      res: http.getResponse<Response>(),
    };
  }
}

/**
 * The account a request is ABOUT, when it names one.
 *
 * Lower-cased so `Alice@x.com` and `alice@x.com` share a budget — otherwise
 * changing the capitalisation is a free reset of the guessing limit.
 */
function extractAccountIdentifier(req: Request): string | null {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null) return null;

  const email = (body as { email?: unknown }).email;

  return typeof email === 'string' && email.length > 0
    ? email.trim().toLowerCase()
    : null;
}

/** "45 seconds" / "15 minutes" — a duration a human can act on. */
function describeWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;

  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Identified by NAME rather than `instanceof`.
 *
 * `ThrottlerException` can be constructed by a different copy of the package
 * than the one this file imported (a hoisting quirk in a monorepo), and an
 * `instanceof` miss here would swallow a real 429 into the fail-open branch —
 * silently disabling every limit.
 */
function isThrottlerException(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'ThrottlerException' ||
      error.constructor?.name === 'ThrottlerException')
  );
}

/**
 * The access token, cookie first and `Authorization` second.
 *
 * The SAME order `JwtStrategy` uses, and for the same reason: a request
 * carrying both resolves to the browser's own session rather than an injected
 * header. Duplicated rather than shared because the strategy expresses it as
 * passport extractors, which are not callable outside a passport strategy.
 */
function extractAccessToken(req: Request, cookieName: string): string | null {
  const cookie = req.cookies?.[cookieName] as string | undefined;
  if (cookie) return cookie;

  const [scheme, token] = req.headers.authorization?.split(' ') ?? [];

  return scheme === 'Bearer' && token ? token : null;
}
