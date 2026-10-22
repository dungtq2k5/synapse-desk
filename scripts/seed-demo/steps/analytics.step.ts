/**
 * @file The rollups over what the earlier steps wrote, so Analytics shows it.
 *
 * Last in the order: it reads every other step's rows. The dashboards read
 * daily rollups, not the rows, so the seed backfills both jobs for its own
 * organizations, then runs `ledger-daily` once for the document usage and
 * quality flags. Through the gateway as the Super Admin, the one surface that
 * runs a job by hand; with nothing listening the seed still succeeds and says
 * what to run.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSync } from 'otplib';
import { REPO_ROOT } from '../paths';
import { tenantsOf, type SeedStep } from '../registry';

/** Days back the backfill covers: past the 90 the ticket history spans. */
const BACKFILL_DAYS = 92;

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';

/** `key` from auth-service's own `.env`, where the Super Admin is set. */
function authEnv(key: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(join(REPO_ROOT, 'services/auth-service/.env'), 'utf8');
  } catch {
    return undefined;
  }
  return new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm').exec(text)?.[1]?.trim();
}

type Call = (path: string, body?: unknown) => Promise<unknown>;

/**
 * A caller of the gateway, its cookies kept between calls (a later
 * `Set-Cookie` replaces an earlier one of the same name).
 */
function caller(): Call {
  const cookies = new Map<string, string>();
  return async (path, body) => {
    const response = await fetch(`${GATEWAY}/api/v1${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        ...(cookies.size
          ? {
              cookie: [...cookies]
                .map(([name, value]) => `${name}=${value}`)
                .join('; '),
            }
          : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const at = pair.indexOf('=');
      const value = pair.slice(at + 1);
      // An emptied cookie is one the gateway cleared.
      if (value) cookies.set(pair.slice(0, at), value);
      else cookies.delete(pair.slice(0, at));
    }
    if (!response.ok) {
      throw new GatewayError(response.status, path, await response.text());
    }
    return ((await response.json()) as { data?: unknown }).data;
  };
}

class GatewayError extends Error {
  constructor(
    readonly status: number,
    path: string,
    body: string,
  ) {
    super(`The gateway answered ${status} for POST ${path}: ${body}`);
  }
}

/**
 * Signed in as the Super Admin, who must use two-step: the code comes from
 * `SUPER_ADMIN_TOTP_SECRET`. A code is accepted once per 30-second step, so a
 * refused one is retried with the next step's.
 */
async function signIn(): Promise<Call> {
  const call = caller();
  const login = (await call('/auth/login', {
    email: authEnv('SUPER_ADMIN_EMAIL'),
    password: authEnv('SUPER_ADMIN_PASSWORD'),
  })) as { requiresTwoFactor?: boolean };
  if (!login.requiresTwoFactor) return call;

  const secret = authEnv('SUPER_ADMIN_TOTP_SECRET');
  if (!secret) {
    throw new Error(
      'The Super Admin must use two-step: set SUPER_ADMIN_TOTP_SECRET in services/auth-service/.env and restart auth-service, which enrolls them with it.',
    );
  }
  try {
    await call('/auth/2fa/authenticate', { code: generateSync({ secret }) });
  } catch (error) {
    if (!(error instanceof GatewayError) || error.status !== 401) throw error;
    await new Promise((resolve) =>
      setTimeout(resolve, 30_000 - (Date.now() % 30_000) + 500),
    );
    await call('/auth/2fa/authenticate', { code: generateSync({ secret }) });
  }
  return call;
}

const day = (offset: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

export const analyticsStep: SeedStep = {
  service: 'analytics',
  run: async (context) => {
    const tenants = tenantsOf(context);
    const lines = [
      `backfill analytics-daily and ledger-daily, ${day(-BACKFILL_DAYS)}..${day(0)}, for ${tenants.length} organizations; then run ledger-daily`,
    ];
    if (!context.apply) return lines;

    let call: Call;
    try {
      call = await signIn();
    } catch (error) {
      // Nothing listening is a seed run without the stack, and still a seed.
      if (error instanceof TypeError) {
        lines.push(
          `No gateway at ${GATEWAY}: the dashboards stay empty until the nightly jobs, or re-run with the stack up: npm run seed:demo -- --apply --only=analytics`,
        );
        return lines;
      }
      throw error;
    }
    for (const tenant of tenants) {
      for (const job of ['analytics-daily', 'ledger-daily']) {
        await call(`/platform/jobs/${job}/backfill`, {
          from: day(-BACKFILL_DAYS),
          to: day(0),
          reason: 'Demo seed history',
          organizationId: tenant.organizationId,
        });
      }
    }
    await call('/platform/jobs/ledger-daily/run');
    lines.push('done');
    return lines;
  },
};
