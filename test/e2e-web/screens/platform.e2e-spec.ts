import type { Cookie, Route } from '@playwright/test';
import { expect, test, type Page } from '../coverage';
import { superAdmin, superAdminSession } from '../super-admin';
import { look } from './look';
import {
  APPLY,
  ASSIGN,
  RELEASE,
  AUDIT,
  detail,
  EVENTS,
  FINANCE,
  FINANCE_PARTIAL,
  GLOBAL_ROLES,
  JOBS,
  JOBS_PARTIAL,
  METRICS,
  NORTHWIND_ACTS,
  NOW,
  organizations,
  page as paged,
  PEOPLE,
  PLANS,
} from './platform-data';
import { failed, hang, ok, type Overrides } from './settings-data';
import { signInAs, tenant } from './tenant';

/**
 * The platform console (design 11): every state of the matrix, each checked
 * by what it says, axe and a baseline. The console's reads are answered here,
 * so the handoff's sample is on every run; the Super Admin is real, made for
 * this file and signed in once (a code is good once per 30 seconds).
 */

let cookies: Cookie[] = [];

test.beforeAll(async () => {
  const admin = await superAdmin('screens');
  const session = await superAdminSession(admin);
  cookies = (await session.storageState()).cookies;
  await session.dispose();
});

const ANSWERS: Overrides = {
  'GET /platform/metrics': ok(METRICS),
  'GET /platform/finance': ok(FINANCE),
  'GET /platform/finance/events': ok(EVENTS),
  'GET /platform/jobs': ok(JOBS),
  'GET /platform/organizations': (route: Route) =>
    route.fulfill(
      ok(
        organizations(
          new URL(route.request().url()).searchParams.get('includeDeleted') ===
            'true',
        ),
      ),
    ),
  'GET /platform/organizations/org-northwind': ok(detail('org-northwind')),
  'GET /platform/organizations/org-cedar': ok(detail('org-cedar')),
  'GET /platform/organizations/org-bluebird': ok(detail('org-bluebird')),
  'GET /platform/organizations/org-lumen': ok(detail('org-lumen')),
  'GET /platform/organizations/org-quarry': ok(detail('org-quarry')),
  'GET /platform/audit-logs': (route: Route) =>
    route.fulfill(
      ok(
        new URL(route.request().url()).searchParams.get('resourceId')
          ? paged(NORTHWIND_ACTS, NORTHWIND_ACTS.length, 5)
          : paged(AUDIT, 216, 20),
      ),
    ),
  'GET /platform/audit-logs/actions': ok({
    actions: [...new Set(AUDIT.map((entry) => entry.action))],
  }),
  'GET /platform/plans': (route: Route) =>
    route.fulfill(
      ok(
        paged(
          new URL(route.request().url()).searchParams.get('includeInactive') ===
            'true'
            ? PLANS
            : PLANS.filter((plan) => plan.isActive),
          undefined,
          20,
        ),
      ),
    ),
  'GET /platform/plans/plan-pro': ok(PLANS[2]),
  'GET /platform/users': (route: Route) => {
    const organizationId = new URL(route.request().url()).searchParams.get(
      'organizationId',
    );
    const rows = organizationId
      ? PEOPLE.filter((one) => one.organizationId === organizationId)
      : PEOPLE;
    return route.fulfill(ok(paged(rows, organizationId ? 18 : 1284, 20)));
  },
  'GET /platform/roles': ok(paged(GLOBAL_ROLES, GLOBAL_ROLES.length, 100)),
};

/** Answers the console's reads, then the overrides; anything else is real. */
async function answer(page: Page, overrides: Overrides) {
  const all = { ...ANSWERS, ...overrides };
  await page.route('**/api/v1/platform/**', async (route) => {
    const url = new URL(route.request().url());
    const key = `${route.request().method()} ${url.pathname.replace(/^\/api\/v1/, '')}`;
    const reply = all[key];
    if (reply === undefined) return route.fallback();
    if (reply === hang) return;
    if (typeof reply === 'function') return reply(route);
    return route.fulfill(reply);
  });
}

async function open(
  page: Page,
  path: string,
  heading: string | RegExp,
  overrides: Overrides = {},
) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.context().addCookies(cookies);
  await answer(page, overrides);
  await page.goto(path);
  await expect(
    page.getByRole('heading', { name: heading, level: 1 }),
  ).toBeVisible();
}

test.describe('Overview', () => {
  test('the platform at a glance', async ({ page }) => {
    await open(page, '/platform', 'Overview');
    await expect(page.getByText('$8,412.00')).toBeVisible();
    await expect(
      page.getByText('31 active · 4 setting up · 3 past due · 2 frozen'),
    ).toBeVisible();
    await expect(page.getByText('Past due since 14 Oct 2026')).toBeVisible();
    await expect(
      page.getByText(
        /^In the last 30 days: 14 new subscriptions, 27 changes, 3 cancellations and 5 failed payments\. 2 organizations offboarded in this range are currently offboarded\.$/,
      ),
    ).toBeVisible();
    await look(page, 'platform-overview');
  });

  test('partial: revenue unavailable, a job service unreachable', async ({
    page,
  }) => {
    await open(page, '/platform', 'Overview', {
      'GET /platform/finance': ok(FINANCE_PARTIAL),
      'GET /platform/jobs': ok(JOBS_PARTIAL),
    });
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Some numbers couldn’t be read' }),
    ).toContainText(
      'Estimated MRR: the revenue snapshot couldn’t be read. Jobs: the notification service didn’t answer, so its jobs aren’t listed. Everything else is up to date.',
    );
    await expect(
      page.getByText('Not available: the revenue snapshot couldn’t be read.'),
    ).toBeVisible();
    await expect(
      page.getByText('Didn’t answer; its jobs aren’t listed'),
    ).toBeVisible();
    await look(page, 'platform-overview-partial');
  });

  test('loading', async ({ page }) => {
    await page.clock.setFixedTime(new Date(NOW));
    await page.context().addCookies(cookies);
    await answer(page, {
      'GET /platform/metrics': hang,
      'GET /platform/finance': hang,
      'GET /platform/jobs': hang,
      'GET /platform/finance/events': hang,
    });
    await page.goto('/platform');
    await expect(page.getByRole('status', { name: '' }).first()).toBeAttached();
    await expect(page.getByText('Loading the overview')).toBeAttached();
    await look(page, 'platform-overview-loading');
  });

  test('error', async ({ page }) => {
    await open(page, '/platform', 'Overview', {
      'GET /platform/metrics': failed(500),
      'GET /platform/finance': failed(500),
      'GET /platform/jobs': failed(500),
    });
    await expect(
      page.getByRole('alert').filter({ hasText: 'Couldn’t load the overview' }),
    ).toBeVisible();
    await look(page, 'platform-overview-error');
  });
});

test.describe('Organizations', () => {
  test('every organization, by name', async ({ page }) => {
    await open(page, '/platform/organizations', 'Organizations');
    await expect(
      page.getByRole('link', { name: 'Lumen Schools' }).first(),
    ).toBeVisible();
    await expect(page.getByText('Showing 1–8 of 42')).toBeVisible();
    await look(page, 'platform-organizations');
  });

  test('Show offboarded adds them, each dated', async ({ page }) => {
    await open(page, '/platform/organizations', 'Organizations');
    await page.getByLabel('Show offboarded').click();
    await expect(page.getByText('Left 2 Oct 2026').first()).toBeVisible();
    await look(page, 'platform-organizations-offboarded');
  });

  test('no results', async ({ page }) => {
    await open(page, '/platform/organizations', 'Organizations', {
      'GET /platform/organizations': ok(paged([], 0)),
    });
    await page.getByLabel('Search by name, address or domain').fill('zzz');
    await expect(page.getByText('No organizations match')).toBeVisible();
    await look(page, 'platform-organizations-no-results');
  });

  test('create: the form', async ({ page }) => {
    await open(page, '/platform/organizations/new', 'New organization');
    await expect(
      page.getByText('They’ll get an email to set a password'),
    ).toBeVisible();
    await look(page, 'platform-organization-create');
  });

  test('create: a taken address, marked under its field', async ({ page }) => {
    await open(page, '/platform/organizations/new', 'New organization', {
      'POST /platform/organizations': failed(
        409,
        'That address is already taken by another organization!',
      ),
    });
    await fillCreate(page);
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page.getByLabel('Address')).toHaveAccessibleDescription(
      /That address is already taken by another organization\./,
    );
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await look(page, 'platform-organization-create-taken');
  });

  test('create: created, the admin is emailed', async ({ page }) => {
    await open(page, '/platform/organizations/new', 'New organization', {
      'POST /platform/organizations': ok(
        {
          organization: detail('org-cedar'),
          admin: { ...PEOPLE[2].user, fullName: 'Dana Ortiz' },
        },
        201,
      ),
    });
    await fillCreate(page);
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(
      page.getByRole('heading', { name: 'Cedar Clinic is created', level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText('We emailed Dana Ortiz a link to set a password.'),
    ).toBeVisible();
    await look(page, 'platform-organization-created');
  });
});

async function fillCreate(page: Page) {
  await page.getByLabel('Name', { exact: true }).fill('Cedar Clinic');
  await page.getByLabel('Address').fill('cedar-clinic');
  await page.getByLabel('Domain (optional)').fill('cedarclinic.com');
  await page.getByLabel('Full name').fill('Dana Ortiz');
  await page.getByLabel('Email', { exact: true }).fill('dana@cedarclinic.com');
}

test.describe('An organization', () => {
  for (const [id, name, status, file] of [
    [
      'org-northwind',
      'Northwind Health',
      'Everything works for its people.',
      'active',
    ],
    ['org-cedar', 'Cedar Clinic', 'its admin is finishing setup', 'setting-up'],
    [
      'org-bluebird',
      'Bluebird Logistics',
      'Past due since 14 Oct 2026.',
      'past-due',
    ],
    ['org-lumen', 'Lumen Schools', 'Frozen since 20 Oct 2026.', 'frozen'],
  ] as const) {
    test(`${file}: ${name}`, async ({ page }) => {
      await open(page, `/platform/organizations/${id}`, name, {
        'GET /platform/audit-logs': ok(
          paged(id === 'org-northwind' ? NORTHWIND_ACTS : [], 4, 5),
        ),
      });
      await expect(
        page.getByRole('region', { name: 'Status' }).getByText(status, {
          exact: false,
        }),
      ).toBeVisible();
      await look(page, `platform-organization-${file}`);
    });
  }

  test('change status: freeze, with what it does and a reason', async ({
    page,
  }) => {
    await open(
      page,
      '/platform/organizations/org-northwind',
      'Northwind Health',
      {
        'GET /platform/audit-logs': ok(paged(NORTHWIND_ACTS, 4, 5)),
      },
    );
    await page.getByRole('button', { name: 'Change status' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByLabel('Frozen').check();
    await dialog
      .getByLabel('Reason')
      .fill(
        'Chargeback dispute opened with the bank; freezing until it’s resolved.',
      );
    await expect(
      dialog.getByRole('button', { name: 'Freeze Northwind Health' }),
    ).toBeVisible();
    await look(page, 'platform-organization-status-dialog');
  });

  test('edit: profile, and limits as a break-glass override', async ({
    page,
  }) => {
    await open(
      page,
      '/platform/organizations/org-northwind/edit',
      'Edit Northwind Health',
    );
    await expect(page.getByText('Pro grants 25.')).toBeVisible();
    await look(page, 'platform-organization-edit');
  });

  test('assigned: a negotiated plan, with Release', async ({ page }) => {
    await open(page, '/platform/organizations/org-quarry', 'Quarry Labs', {
      'GET /platform/audit-logs': ok(paged([], 0, 5)),
    });
    await expect(page.getByText('Quarry agreement (assigned)')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Release to self-service' }),
    ).toBeVisible();
    await look(page, 'platform-organization-assigned');
  });

  test('assign a plan: what it changes, and a reason', async ({ page }) => {
    await open(page, '/platform/organizations/org-cedar', 'Cedar Clinic', {
      'GET /platform/audit-logs': ok(paged([], 0, 5)),
      'POST /platform/organizations/org-cedar/plan': ok(ASSIGN),
    });
    await page.getByRole('button', { name: 'Assign a plan' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('combobox', { name: 'Plan' }).click();
    await page.getByRole('option', { name: 'Quarry agreement' }).click();
    await expect(dialog.getByText('Seats 10 → 60')).toBeVisible();
    await dialog.getByLabel('Reason').fill('Signed a three-year agreement.');
    await look(page, 'platform-organization-assign-dialog');
  });

  test('release: back to the free tier, over a limit', async ({ page }) => {
    await open(page, '/platform/organizations/org-quarry', 'Quarry Labs', {
      'GET /platform/audit-logs': ok(paged([], 0, 5)),
      'DELETE /platform/organizations/org-quarry/plan': ok(RELEASE),
    });
    await page.getByRole('button', { name: 'Release to self-service' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(
      dialog.getByText('Quarry Labs will be over a limit after this'),
    ).toBeVisible();
    await dialog.getByLabel('Reason').fill('The agreement ended.');
    await look(page, 'platform-organization-release-dialog');
  });

  test('reset the billing cycle: break glass, with a reason', async ({
    page,
  }) => {
    await open(
      page,
      '/platform/organizations/org-northwind',
      'Northwind Health',
      {
        'GET /platform/audit-logs': ok(paged(NORTHWIND_ACTS, 4, 5)),
      },
    );
    await page.getByRole('button', { name: 'Reset the cycle' }).click();
    await expect(
      page.getByRole('alertdialog', {
        name: 'Reset Northwind Health’s billing cycle?',
      }),
    ).toBeVisible();
    await look(page, 'platform-organization-reset-dialog');
  });

  test('offboard: what it does, a reason, the name typed', async ({ page }) => {
    await open(
      page,
      '/platform/organizations/org-northwind',
      'Northwind Health',
      {
        'GET /platform/audit-logs': ok(paged(NORTHWIND_ACTS, 4, 5)),
      },
    );
    await page.getByRole('button', { name: 'Offboard', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog
      .getByLabel('Reason')
      .fill('Contract ended; the customer asked to close the account.');
    await dialog
      .getByLabel('Type Northwind Health to confirm')
      .fill('Northwind Health');
    await look(page, 'platform-organization-offboard-dialog');
  });

  test('offboarded: just now, with Restore', async ({ page }) => {
    await open(
      page,
      '/platform/organizations/org-northwind',
      'Northwind Health',
      {
        'GET /platform/organizations/org-northwind': ok(
          detail('org-northwind', { left: '2026-10-22T10:40:00' }),
        ),
        'GET /platform/audit-logs': ok(
          paged(
            [
              {
                ...NORTHWIND_ACTS[0],
                id: 'off',
                action: 'PLATFORM_ORGANIZATION_OFFBOARDED',
                metadata: {
                  reason:
                    'Contract ended; the customer asked to close the account.',
                  revokedSessionCount: 23,
                },
              },
              ...NORTHWIND_ACTS,
            ],
            5,
            5,
          ),
        ),
      },
    );
    await expect(
      page.getByText('Northwind Health was offboarded on 22 Oct 2026'),
    ).toBeVisible();
    await look(page, 'platform-organization-offboarded');
  });

  test('restore: confirm', async ({ page }) => {
    await open(
      page,
      '/platform/organizations/org-northwind',
      'Northwind Health',
      {
        'GET /platform/organizations/org-northwind': ok(
          detail('org-northwind', { left: '2026-10-22T10:40:00' }),
        ),
      },
    );
    await page.getByRole('button', { name: 'Restore' }).first().click();
    await expect(
      page.getByRole('alertdialog', { name: 'Restore Northwind Health?' }),
    ).toBeVisible();
    await look(page, 'platform-organization-restore-dialog');
  });
});

test.describe('Plans', () => {
  test('the catalog, every grant side by side', async ({ page }) => {
    await open(page, '/platform/plans', 'Plans');
    await page.getByLabel('Show retired and not offered').click();
    await expect(page.getByText('Not offered').first()).toBeVisible();
    await expect(page.getByText('$99.00 a month').first()).toBeVisible();
    await look(page, 'platform-plans');
  });

  test('retire: refused while anyone is on it, deactivate instead', async ({
    page,
  }) => {
    await open(page, '/platform/plans/plan-pro', 'Pro');
    await page.getByRole('button', { name: 'Retire' }).click();
    await expect(
      page.getByRole('alertdialog', { name: 'Pro can’t be retired' }),
    ).toContainText('17 organizations are on it.');
    await look(page, 'platform-plan-retire-refused');
  });

  test('a plan: edit, every grant with its ceiling and prices', async ({
    page,
  }) => {
    await open(page, '/platform/plans/plan-pro', 'Pro');
    await expect(
      page.getByText('Saving changes the catalog only'),
    ).toBeVisible();
    await look(page, 'platform-plan-edit');
  });

  test('a plan: create, every grant required', async ({ page }) => {
    await open(page, '/platform/plans/new', 'New plan');
    await page.getByLabel('Name').fill('Team');
    await page.getByRole('button', { name: 'Create plan' }).click();
    await expect(page.getByText('Fill in every grant')).toBeVisible();
    await look(page, 'platform-plan-create');
  });

  test('apply: the preview first', async ({ page }) => {
    await open(
      page,
      '/platform/plans/plan-pro/apply',
      'Apply Pro to its subscribers',
      {
        'POST /platform/plans/plan-pro/apply': ok(APPLY(true)),
      },
    );
    await expect(page.getByText('Nothing has changed yet')).toBeVisible();
    await expect(
      page.getByText('2 organizations will be over a limit after this'),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Lumen Schools (seats) and Gale Insurance (documents) use more than Pro grants.',
        { exact: false },
      ),
    ).toBeVisible();
    await look(page, 'platform-plan-apply-preview');
  });

  test('apply: applied, with the result', async ({ page }) => {
    await open(
      page,
      '/platform/plans/plan-pro/apply',
      'Apply Pro to its subscribers',
      {
        'POST /platform/plans/plan-pro/apply': (route: Route) =>
          route.fulfill(
            ok(
              APPLY(
                new URL(route.request().url()).searchParams.get('dryRun') !==
                  'false',
              ),
            ),
          ),
      },
    );
    await page
      .getByRole('button', { name: 'Apply Pro to 16 organizations' })
      .click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Apply Pro to 16 organizations' })
      .click();
    await expect(page.getByText('Pro is applied')).toBeVisible();
    await look(page, 'platform-plan-applied');
  });
});

test.describe('People, roles, jobs and audit', () => {
  test('people across every organization', async ({ page }) => {
    await open(page, '/platform/people', 'People');
    await expect(page.getByText('Email not verified').first()).toBeVisible();
    await look(page, 'platform-people');
  });

  test('people filtered to one organization', async ({ page }) => {
    await open(page, '/platform/people?organizationId=org-northwind', 'People');
    await expect(page.getByLabel('Organization')).toHaveText(
      'Northwind Health',
    );
    await look(page, 'platform-people-organization');
  });

  test('global roles', async ({ page }) => {
    await open(page, '/platform/roles', 'Global roles');
    await expect(page.getByText('Auditor').first()).toBeVisible();
    await look(page, 'platform-roles');
  });

  test('global roles: create one', async ({ page }) => {
    await open(page, '/platform/roles', 'Global roles');
    await page.getByRole('button', { name: 'New global role' }).click();
    await expect(page.getByText('Every organization gets it')).toBeVisible();
    await expect(page.getByText(/^All 42 organizations see it/)).toBeVisible();
    await look(page, 'platform-roles-create');
  });

  test('jobs: health, failures and the last error', async ({ page }) => {
    await open(page, '/platform/jobs', 'Jobs');
    await expect(
      page.getByText('document-flags: deadline exceeded').first(),
    ).toBeVisible();
    await look(page, 'platform-jobs');
  });

  test('jobs: a service didn’t answer', async ({ page }) => {
    await open(page, '/platform/jobs', 'Jobs', {
      'GET /platform/jobs': ok(JOBS_PARTIAL),
    });
    await expect(
      page.getByText('The Notifications service didn’t answer'),
    ).toBeVisible();
    await expect(page.getByText('Not reached').first()).toBeVisible();
    await look(page, 'platform-jobs-unreachable');
  });

  test('jobs: run now, with a reason, and its result', async ({ page }) => {
    await open(page, '/platform/jobs', 'Jobs', {
      'POST /platform/jobs/analytics-daily/run': ok({
        service: 'ticket-service',
        jobName: 'analytics-daily',
        tenants: 42,
        rows: 1268,
      }),
    });
    await page
      .getByRole('button', { name: 'Run now: Analytics rollup, daily' })
      .click();
    const dialog = page.getByRole('alertdialog');
    await dialog
      .getByLabel('Reason')
      .fill('Checking the rollup after the import.');
    await dialog.getByRole('button', { name: 'Run now' }).click();
    await expect(page.getByText('42 organizations, 1,268 rows.')).toBeVisible();
    await look(page, 'platform-jobs-ran', { viewportOnly: true });
  });

  test('jobs: backfill a range, with a reason', async ({ page }) => {
    await open(page, '/platform/jobs', 'Jobs');
    await page
      .getByRole('button', { name: 'Backfill: Analytics rollup, daily' })
      .click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByLabel('From').fill('2026-10-01');
    await dialog.getByLabel('To').fill('2026-10-21');
    await dialog
      .getByLabel('Reason')
      .fill('Ticket import on 30 Sept arrived after the daily run.');
    await expect(
      dialog.getByText('Backfill the analytics rollup'),
    ).toBeVisible();
    await look(page, 'platform-jobs-backfill-dialog');
  });

  test('audit log: the platform’s own actions', async ({ page }) => {
    await open(page, '/platform/audit-log', 'Audit log');
    await expect(
      page.getByText('Recomputed a job’s range').first(),
    ).toBeVisible();
    await expect(
      page.getByText('Job · 42 organizations, 1,268 rows').first(),
    ).toBeVisible();
    await look(page, 'platform-audit');
  });

  test('audit log: filtered to one organization', async ({ page }) => {
    await open(
      page,
      '/platform/audit-log?resourceType=ORGANIZATION&resourceId=org-northwind',
      'Audit log',
    );
    await expect(
      page.getByRole('button', { name: /Northwind Health/ }).first(),
    ).toBeVisible();
    await look(page, 'platform-audit-organization');
  });
});

test.describe('Sign-in and access', () => {
  test('Security: a Super Admin can’t turn two-step off', async ({ page }) => {
    // Where this run's session signed in from varies: one, as the frame draws.
    await page.route('**/api/v1/auth/sessions', (route) =>
      route.fulfill(
        ok([
          {
            id: '00000000-0000-4000-8000-0000000000a1',
            deviceName: null,
            ipAddress: '203.0.113.24',
            userAgent:
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
            current: true,
            isTrusted: false,
            trustedUntil: null,
            expiresAt: '2026-11-12T12:00:00Z',
            createdAt: '2026-10-22T09:12:00Z',
          },
        ]),
      ),
    );
    await page.route('**/api/v1/auth/2fa/backup-codes', (route) =>
      route.fulfill(
        ok({ remaining: 7, used: 3, expiresAt: '2027-10-12T12:00:00Z' }),
      ),
    );
    await open(page, '/security', 'Security');
    await expect(
      page.getByText(
        'Super Admins must use two-step verification, so you can’t turn it off.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn off' })).toBeDisabled();
    await expect(
      page.getByRole('region', { name: 'Platform console' }),
    ).toBeVisible();
    await look(page, 'platform-security');
  });

  test('someone who isn’t a Super Admin opens /platform', async ({ page }) => {
    const found = await tenant('platform-access');
    await signInAs(page, found.maya);
    await page.goto('/platform');
    await expect(
      page.getByRole('heading', { name: 'This page isn’t available' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Back to Tickets' }),
    ).toBeVisible();
    await look(page, 'platform-not-available');
  });
});
