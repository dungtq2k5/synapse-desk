import { RequestMethod, VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
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
 * Declared once and applied through {@link applyApiRouting} by every composition
 * root, because the failure of getting it wrong in only one of them is a suite
 * that passes against paths production does not serve.
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
 * Applied by {@link applyApiRouting} for the same reason as {@link OPS_ROUTES}.
 */
export const API_VERSIONING = {
  type: VersioningType.URI,
  defaultVersion: API_VERSION,
} satisfies VersioningOptions;

/**
 * `GLOBAL_PREFIX` without its optional leading slash.
 *
 * The env schema accepts only `api` or `/api`, so this has one job: give
 * {@link apiBasePath} a bare segment either way.
 *
 * @example
 * resolveGlobalPrefix('/api'); // 'api'
 * resolveGlobalPrefix('api');  // 'api'
 */
export function resolveGlobalPrefix(configured: string): string {
  return configured.startsWith('/') ? configured.slice(1) : configured;
}

/**
 * The **prefix**, then the **version** — the two mechanisms that render `/api/v1/…` —
 * applied the one way every composition root applies them.
 *
 * **One function, four callers**: `main.ts`, both test bootstraps and
 * `scripts/export-openapi.mjs`. The paths in the exported OpenAPI file and the
 * paths every e2e suite requests depend on this exactly, and a root that forgot
 * the prefix would serve `/auth/register` while the others served
 * `/api/v1/auth/register`. `versioning-contract.e2e-spec.ts` pins that every
 * root calls it and that this body carries both calls.
 *
 * Takes the prefix as a string, not a `ConfigService`, so this file stays free
 * of configuration; it is resolved again here because resolving is idempotent
 * and a caller passing the raw `GLOBAL_PREFIX` must still get `/api/v1/…`.
 *
 * @example applyApiRouting(app, resolveGlobalPrefix(config.getOrThrow('GLOBAL_PREFIX'))); // routes render /api/v1/…
 */
export function applyApiRouting(app: INestApplication, prefix: string): void {
  app.setGlobalPrefix(resolveGlobalPrefix(prefix), { exclude: OPS_ROUTES });
  app.enableVersioning(API_VERSIONING);
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
