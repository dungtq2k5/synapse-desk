import { RequestMethod, VersioningType } from '@nestjs/common';
import type { RouteInfo, VersioningOptions } from '@nestjs/common/interfaces';

/**
 * Routes served OUTSIDE the versioned API prefix
 *
 * `/api/v1` is a contract offered to API clients, and an orchestrator is not
 * one: it has no credentials, no version negotiation and no ability to follow a
 * migration. Versioning a probe means a future `/api/v2` silently moves it, and
 * the symptom is every instance failing its readiness check immediately after a
 * deploy that changed nothing about health.
 *
 * **Excluded from the prefix AND version-neutral.** The two are separate
 * mechanisms and a probe must escape both: this list removes the prefix, while
 * `VERSION_NEUTRAL` on `HealthController` and `VersionController` removes the
 * version. With only this list, the probes answer at `/v1/health`.
 *
 * Declared once and shared by `main.ts` and both test bootstraps, because the
 * failure of getting it wrong in only one of them is a suite that passes against
 * paths production does not serve.
 */
export const OPS_ROUTES: RouteInfo[] = [
  { path: 'health', method: RequestMethod.GET },
  { path: 'health/ready', method: RequestMethod.GET },
  { path: 'version', method: RequestMethod.GET },
];

/** The URI version every route without its own `@Version` is served under. */
export const API_VERSION = '1';

/**
 * Nest's versioning options, applied after the global prefix.
 *
 * Shared by `main.ts` and both test bootstraps for the same reason as
 * {@link OPS_ROUTES}. `versioning-contract.e2e-spec.ts` pins all three.
 *
 * @example
 * app.setGlobalPrefix(resolveGlobalPrefix(raw), { exclude: OPS_ROUTES });
 * app.enableVersioning(API_VERSIONING); // routes render /api/v1/…
 */
export const API_VERSIONING = {
  type: VersioningType.URI,
  defaultVersion: API_VERSION,
} satisfies VersioningOptions;

/**
 * `GLOBAL_PREFIX` reduced to the prefix alone, with no version and no slashes.
 *
 * Accepts both the legacy form, which carries the version, and the bare form.
 * The legacy form reports itself through `onDeprecated`, because applying it
 * unchanged beside {@link API_VERSIONING} would serve every route at
 * `/api/v1/v1/…`.
 *
 * @example
 * resolveGlobalPrefix('/api/v1'); // 'api' — and calls onDeprecated
 * resolveGlobalPrefix('api');     // 'api'
 */
export function resolveGlobalPrefix(
  configured: string,
  onDeprecated?: (message: string) => void,
): string {
  // FIXME Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking.
  const trimmed = configured.trim().replace(/^\/+|\/+$/g, '');
  const versionSuffix = new RegExp(`(?:^|/)v${API_VERSION}$`);

  if (!versionSuffix.test(trimmed)) return trimmed;

  onDeprecated?.(
    `GLOBAL_PREFIX = ${configured} carries the API version, which URI ` +
      `versioning now adds on its own. Set GLOBAL_PREFIX = api — the ` +
      `versioned form will be refused at boot.`,
  );

  return trimmed.replace(versionSuffix, '');
}

/**
 * The path every versioned REST route sits under, with a leading slash.
 *
 * For building URLs from the prefix — a banner, a mount, a test helper — where
 * plain concatenation would lose the slash or the version.
 *
 * @example
 * apiBasePath('api'); // '/api/v1'
 */
export function apiBasePath(prefix: string): string {
  return `/${prefix}/v${API_VERSION}`;
}
