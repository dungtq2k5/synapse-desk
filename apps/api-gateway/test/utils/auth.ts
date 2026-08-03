import { INestApplication } from '@nestjs/common';
import { faker } from '@faker-js/faker';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import type {
  JwtPayload,
  PermissionCode,
  TwoFactorJwtPayload,
} from '@synapsedesk/common';
import { signAccessToken, signTwoFactorToken } from './tokens';
import { Server } from 'node:http';

/** Cookie names, read from the same env the gateway reads them from. */
export const ACCESS_COOKIE = process.env.JWT_ACCESS_NAME ?? 'access_token';
export const REFRESH_COOKIE = process.env.JWT_REFRESH_NAME ?? 'refresh_token';
export const TWO_FA_COOKIE = process.env.JWT_2FA_NAME ?? 'mfa_token';
export const TENANT_SELECTION_COOKIE =
  process.env.TENANT_SELECTION_NAME ?? 'sd_tenant_selection';
export const DEVICE_COOKIE = process.env.DEVICE_TOKEN_NAME ?? 'sd_device_token';

export const API = process.env.GLOBAL_PREFIX ?? '/api/v1';

/** Every field of a caller, defaulted, so a test only states what it cares about. */
export function buildJwtPayload(
  overrides: Partial<JwtPayload> = {},
): JwtPayload {
  return {
    sub: faker.string.uuid(),
    organizationId: faker.string.uuid(),
    isSuperAdmin: false,
    departmentIds: [],
    permissionCodes: [],
    isEmailVerified: true,
    ...overrides,
  };
}

/**
 * A supertest agent carrying a valid access cookie.
 *
 * Most e2e tests are for authenticated, non-auth routes, where re-running the
 * whole login flow is setup noise wrapped around the actual assertion — and
 * worse, it buries the test's real precondition. `authenticatedAgent(app, {
 * permissionCodes: ['department.create'] })` states in the test body exactly
 * what the caller must hold; a login fixture states it three files away.
 *
 * Reserve the real `POST /auth/login` flow for tests OF the auth module —
 * cookies, the three-way outcome, tenant selection, 2FA.
 */
export function authenticatedAgent(
  app: INestApplication<Server>,
  overrides: Partial<JwtPayload> = {},
): TestAgent {
  const token = signAccessToken(buildJwtPayload(overrides));
  return request
    .agent(app.getHttpServer())
    .set('Cookie', `${ACCESS_COOKIE}=${token}`);
}

/** Shorthand for the common "caller holds exactly these permissions" case. */
export function agentWithPermissions(
  app: INestApplication<Server>,
  permissionCodes: PermissionCode[],
  overrides: Partial<JwtPayload> = {},
): TestAgent {
  return authenticatedAgent(app, { permissionCodes, ...overrides });
}

/**
 * A platform Super Admin: `isSuperAdmin` AND `organizationId: null`.
 *
 * Both, because `SuperAdminGuard` checks both — a caller with the flag but a
 * tenant id is a data-corruption case, not an operator, and the fixture must
 * not be able to produce a shape the guard would refuse in production.
 */
export function superAdminAgent(app: INestApplication<Server>): TestAgent {
  return authenticatedAgent(app, { isSuperAdmin: true, organizationId: null });
}

/**
 * A caller mid-2FA-challenge: password accepted, second factor outstanding.
 *
 * Carries ONLY the 2FA cookie. Adding an access cookie as well would make every
 * assertion about the challenge state meaningless.
 */
export function twoFactorChallengeAgent(
  app: INestApplication<Server>,
  overrides: Partial<TwoFactorJwtPayload> = {},
): TestAgent {
  const token = signTwoFactorToken({
    sub: faker.string.uuid(),
    is2faPending: true,
    ...overrides,
  });
  return request
    .agent(app.getHttpServer())
    .set('Cookie', `${TWO_FA_COOKIE}=${token}`);
}

/** An unauthenticated caller. */
export function anonymousAgent(app: INestApplication<Server>): TestAgent {
  return request.agent(app.getHttpServer());
}

/**
 * Parses a `Set-Cookie` header into a name -> attributes map.
 *
 * Written once because the cookie sweep asserts on flags — HttpOnly,
 * SameSite, Max-Age — on every cookie the gateway sets, and reading those off a
 * raw header string in each test is where the assertion quietly stops matching
 * what it claims to.
 */
export type ParsedCookie = {
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
  maxAge?: number;
  path?: string;
};

export function parseSetCookie(
  header: string | string[] | undefined,
): Record<string, ParsedCookie> {
  const raw = Array.isArray(header) ? header : header ? [header] : [];
  const out: Record<string, ParsedCookie> = {};

  for (const line of raw) {
    const [pair, ...attrs] = line.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq);
    const parsed: ParsedCookie = {
      value: decodeURIComponent(pair.slice(eq + 1)),
      httpOnly: false,
      secure: false,
    };

    for (const attr of attrs) {
      const [key, val] = attr.split('=').map((s) => s.trim());
      switch (key.toLowerCase()) {
        case 'httponly':
          parsed.httpOnly = true;
          break;
        case 'secure':
          parsed.secure = true;
          break;
        case 'samesite':
          parsed.sameSite = val?.toLowerCase();
          break;
        case 'max-age':
          parsed.maxAge = Number(val);
          break;
        case 'path':
          parsed.path = val;
          break;
      }
    }

    out[name] = parsed;
  }

  return out;
}
