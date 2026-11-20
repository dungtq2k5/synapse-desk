import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  request as newRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { hash } from 'bcrypt';
import { generateSecret } from 'otplib';
import { PrismaClient as AuthPrisma } from '../../services/auth-service/src/generated/prisma/client';
import { encryptSecret } from '../../services/auth-service/src/common/utils/secrets';
import { REPO_ROOT } from '../system/services';
import { WEB_URL } from './ingress';
import { databaseUrl } from './screens/tenant';
import { api, clearThrottles, DEMO_PASSWORD, totp } from './support';

/**
 * A Super Admin of a row's own, written to auth-service's database: there is
 * no API that makes one (the seeder makes the deployment's first). Each has
 * its own TOTP secret, so rows don't share one and collide on a 30-second
 * code. `twoStep: false` makes one who has never enrolled. Never a production
 * path: tests only.
 */
export type SuperAdmin = {
  id: string;
  email: string;
  fullName: string;
  /** Null for one without two-step. */
  secret: string | null;
};

const run = Date.now();

/** A value from auth-service's own `.env`, never printed. */
function authEnv(name: string): string {
  const env = readFileSync(
    join(REPO_ROOT, 'services/auth-service/.env'),
    'utf8',
  );
  const value = new RegExp(`^${name}\\s*=\\s*(.*)$`, 'm')
    .exec(env)?.[1]
    ?.trim();
  if (!value) throw new Error(`No ${name} in auth-service/.env`);
  return value;
}

export async function superAdmin(
  name: string,
  { fullName = 'Ravi Patel', twoStep = true } = {},
): Promise<SuperAdmin> {
  const secret = twoStep ? generateSecret() : null;
  const prisma = new AuthPrisma({
    adapter: new PrismaPg({ connectionString: databaseUrl('auth-service') }),
  });
  try {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${name}-${run}@platform.example.test`,
        fullName,
        organizationId: null,
        isSuperAdmin: true,
        isEmailVerified: true,
        passwordHash: await hash(DEMO_PASSWORD, 10),
        isTwoFactorEnabled: twoStep,
        twoFactorSecret: secret
          ? encryptSecret(secret, authEnv('TWO_FACTOR_MASTER_KEY'))
          : null,
      },
      select: { id: true, email: true, fullName: true },
    });
    return { ...user, secret };
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * An API session signed in as this Super Admin: the password, then the
 * code. A code is accepted once per 30-second step, so a second sign-in
 * within the step waits for the next one.
 */
export async function superAdminSession(
  admin: SuperAdmin,
): Promise<APIRequestContext> {
  if (!admin.secret) throw new Error('This Super Admin has no two-step');
  await clearThrottles();
  const session = await newRequest.newContext({ baseURL: WEB_URL });
  await api(session, 'POST', '/auth/login', {
    email: admin.email,
    password: DEMO_PASSWORD,
  });
  for (let attempt = 0; ; attempt += 1) {
    const response = await session.fetch('/api/v1/auth/2fa/authenticate', {
      method: 'POST',
      data: { code: totp(admin.secret) },
    });
    if (response.ok()) return session;
    if (attempt > 0) {
      throw new Error(`Two-step refused: ${await response.text()}`);
    }
    // The code for this step was spent: the next step's is new.
    await new Promise((resolve) =>
      setTimeout(resolve, 30_000 - (Date.now() % 30_000) + 500),
    );
  }
}

/** Signs the page's context in as this Super Admin, through the same cookies. */
export async function signInAsSuperAdmin(
  page: Page,
  admin: SuperAdmin,
): Promise<void> {
  const session = await superAdminSession(admin);
  await page.context().addCookies((await session.storageState()).cookies);
  await session.dispose();
}
