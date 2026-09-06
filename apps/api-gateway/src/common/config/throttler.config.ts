/**
 * @file Tier names and per-route policy
 *
 * Here rather than in `dto.config` because they ARE the throttler's configuration:
 * `getThrottlerConfig` below registers `AUTH_THROTTLER_TIER` as a tier name, and `SmartThrottlerGuard` routes by comparing against these exact strings.
 * Keeping them beside the registration is what makes a rename a single edit instead of
 * a silent mismatch between the tier a route overrides and the tier the guard evaluates.
 */

import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

/**
 * The strict tier, applied ONLY to routes marked `@AuthThrottle()`.
 *
 * Its name is load-bearing: `SmartThrottlerGuard` routes tiers by comparing
 * against it, so a typo would silently apply the loose general limits to the
 * login endpoint.
 */
export const AUTH_THROTTLER_TIER = 'authTier';

/**
 * The tier AI routes override.
 *
 * **A general tier, deliberately NOT `authTier`.** The guard skips `authTier`
 * on any route not marked `@AuthThrottle()`, so overriding it here would have
 * been a decoration: the decorator present, the policy readable, and the limit
 * never evaluated. The tier a route actually sees is the one it must override.
 *
 * `medium` rather than `short` because an AI limit is a per-minute budget and
 * `short` is a burst window measured in seconds — overriding it would replace
 * the burst protection rather than add a rate limit on top of it.
 */
export const AI_THROTTLER_TIER = 'medium';

/** The blunt backstop every authenticated route gets. */
export const GENERAL_THROTTLER_TIERS = ['short', 'medium', 'long'] as const;

/**
 * Per-route limits the endpoint plan promises (see the remaining-work doc).
 *
 * Declared here rather than inline at each `@Throttle()` so the whole policy is
 * readable in one place — a limit is a product decision, and hunting six
 * controllers to answer "how many login attempts do we allow?" is how the
 * answer drifts.
 *
 * Every one of these is an OVERRIDE of `authTier`, keyed by that exact name:
 * `@Throttle()` merges by tier name, so overriding under any other key would
 * add a fourth tier instead of replacing the strict one.
 */
export const ROUTE_THROTTLE = {
  /** Credential stuffing. */
  login: { ttl: 15 * 60_000, limit: 5 },
  register: { ttl: 15 * 60_000, limit: 5 },
  /** Mail bomb, and an account-enumeration probe if unlimited. */
  forgotPassword: { ttl: 60 * 60_000, limit: 3 },
  /**
   * An online password oracle for an attacker who already holds a session —
   * the current-password check is what makes it one, and this is what stops it
   * being cheap.
   */
  changePassword: { ttl: 15 * 60_000, limit: 5 },
  /** SMS pumping. This one costs real money per request. */
  otpRequest: { ttl: 10 * 60_000, limit: 3 },
  /** Second line behind `otps.max_attempts`. */
  otpVerify: { ttl: 10 * 60_000, limit: 10 },
  /** Token guessing here discloses the customer list. */
  invitationPreview: { ttl: 60 * 60_000, limit: 20 },
  /** Mail bomb aimed at one invitee. */
  invitationResend: { ttl: 60 * 60_000, limit: 3 },
  /** Brute-forcing the second factor. */
  twoFactorAuthenticate: { ttl: 15 * 60_000, limit: 10 },

  // ---------------------------------------------------------------------
  // AI surfaces.
  //
  // **The monthly quota does not cover this, and the reasoning was already
  // written down one entry up.** `otpRequest` is throttled specifically
  // because "this one costs real money per request"; every AI route is that
  // route. The quota is a MONTH budget checked per request, and nothing in it
  // stops one user spending the whole month in ten minutes — a script looping
  // on `/knowledge/ask`, or a broken client retrying `/ai/draft`. The tenant's
  // month ends at lunchtime and every symptom points at a cap working exactly
  // as designed.
  //
  // The limits below are per USER, because `SmartThrottlerGuard.getTracker()`
  // keys authenticated callers on `user:{sub}`. A per-IP limit here would put
  // ten agents behind one office NAT in the same bucket, and would not really
  // be a limit on an authenticated route anyway.
  // ---------------------------------------------------------------------

  /** Interactive — a human clicks a few times, not two hundred. */
  aiDraft: { ttl: 60_000, limit: 10 },
  aiSuggestions: { ttl: 60_000, limit: 10 },
  /** Re-summarising a ticket is rare; a loop doing it is a bug. */
  aiSummary: { ttl: 60_000, limit: 5 },
  aiClassify: { ttl: 60_000, limit: 10 },
  /** The most human-paced surface in the product — and still not 200/min. */
  chatMessage: { ttl: 60_000, limit: 20 },
  /** Search is cheap: one embedding, no generation. */
  knowledgeSearch: { ttl: 60_000, limit: 30 },
  /** Ask GENERATES, so it costs an order of magnitude more than search. */
  knowledgeAsk: { ttl: 60_000, limit: 10 },
  /**
   * An export writes a FILE, and nothing sweeps them.
   *
   * The tightest entry here, and the only one whose cost is storage rather than
   * model spend: a ticket export can be tens of megabytes, `EXPORT_URL_TTL`
   * expires the link and not the object, and there is no retention job. A
   * held-down button is a bucket filling up. The PENDING dedupe in
   * `ExportService.request` is the other half — this bounds distinct
   * requests, that one collapses identical ones.
   */
  export: { ttl: 60_000, limit: 5 },
} as const;

/**
 * Multi-tier throttler configuration.
 *
 * FOUR named tiers, and the names matter because `SmartThrottlerGuard` routes
 * by them: `short`/`medium`/`long` are the general backstop, `authTier` is the
 * strict one that only `@AuthThrottle()` routes see. A route never evaluates
 * both sets — see the guard for why that is the whole point.
 *
 * **Storage is Redis, not the default in-memory map.** With the default, each
 * replica keeps its own counters, so a 5-per-15-minutes login limit becomes
 * 5 × N and the protection quietly scales away with the deployment. Redis makes
 * the limit a property of the SYSTEM rather than of one process.
 *
 * There is deliberately no `skipIf` for development. Disabling the guard
 * outside production would mean its tier-routing logic — the part most likely
 * to be wrong — is first exercised in production. Development instead runs the
 * SAME code path with looser numbers, which come from env so a test can tighten
 * them.
 */
export const getThrottlerConfig = (
  configService: ConfigService,
): ThrottlerModuleOptions => ({
  throttlers: [
    {
      name: 'short',
      ttl: configService.getOrThrow<number>('THROTTLER_SHORT_TTL'),
      limit: configService.getOrThrow<number>('THROTTLER_SHORT_LIMIT'),
    },
    {
      name: 'medium',
      ttl: configService.getOrThrow<number>('THROTTLER_MEDIUM_TTL'),
      limit: configService.getOrThrow<number>('THROTTLER_MEDIUM_LIMIT'),
    },
    {
      name: 'long',
      ttl: configService.getOrThrow<number>('THROTTLER_LONG_TTL'),
      limit: configService.getOrThrow<number>('THROTTLER_LONG_LIMIT'),
    },
    {
      name: AUTH_THROTTLER_TIER,
      ttl: configService.getOrThrow<number>('THROTTLER_AUTH_TTL'),
      limit: configService.getOrThrow<number>('THROTTLER_AUTH_LIMIT'),
    },
  ],
  /**
   * The URL is handed over rather than a pre-built `new Redis(...)`.
   *
   * That is not a style choice. `ThrottlerStorageRedisService` closes the
   * connection in `onModuleDestroy` ONLY when it constructed the client itself
   * — it sets `disconnectRequired` in the url/options branches and not in the
   * "caller supplied an instance" one. Passing an instance therefore leaks the
   * connection past shutdown: harmless in a long-lived pod, but it is exactly
   * what makes a test process hang after `app.close()` with no visible cause.
   */
  storage: new ThrottlerStorageRedisService(
    configService.getOrThrow<string>('REDIS_URL'),
    {
      // Bounded rather than infinite: a hung Redis must surface as an error the
      // guard can decide about, not as a request that never returns.
      maxRetriesPerRequest: 3,
    },
  ),
});
