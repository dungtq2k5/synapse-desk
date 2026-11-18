/**
 * @file **Every query on a tenant-owned table goes through the scoped client**,
 * or through the bare one on purpose, in a file this registry names.
 *
 * Scans each Prisma service's `src/` from the code toward the registry, so a
 * new file that reaches the bare client, a new raw query or a new nested write
 * fails here naming the file:
 *
 * - **direct use**: `prisma.<anything>` other than `scoped(…)` and
 *   `unscoped(…)`, in a service that has moved to the scoped client
 *   (`MIGRATED`). `PrismaService` itself is the one file that may;
 * - **`unscoped(…)`** outside the files listed for that service;
 * - **raw SQL** (`$queryRaw`, `$executeRaw`, their `Unsafe` forms) outside the
 *   files listed for that service: the tenant extension can't see it, so each
 *   one is a reviewed decision;
 * - **a nested `connect` / `connectOrCreate` / `set`** on a relation whose
 *   target is tenant-owned (read from the schema), outside the functions
 *   listed: the extension scopes the top-level query only, so these functions
 *   check the ids they attach.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@synapsedesk/testing/strip-comments';
import {
  readListed,
  repoFiles,
  REPO_ROOT,
} from '@synapsedesk/testing/repo-files';

type Service = 'auth' | 'ticket' | 'ingestion' | 'notification';

/** Services whose code has moved to `scoped(context)`: no direct use left. */
const MIGRATED = new Set<Service>([
  'notification',
  'ingestion',
  'ticket',
  'auth',
]);

/** Per service: the files that may call `unscoped(…)`. */
const UNSCOPED: Record<Service, readonly string[]> = {
  auth: [
    'auth/auth.service.ts',
    'auth/two-factor-auth.service.ts',
    'billing/dunning.service.ts',
    'billing/entitlement-writer.service.ts',
    'billing/plan-admin.service.ts',
    'billing/plan-catalog.service.ts',
    'billing/plan-change.service.ts',
    'finance/finance.service.ts',
    'invitations/invitations.service.ts',
    'job-runs/job-runs.module.ts',
    'ops/ops.module.ts',
    'organizations/organizations.service.ts',
    'otp/otp.service.ts',
    'platform/platform.service.ts',
    'prisma/database.seeder.ts',
    'roles/roles.service.ts',
    'sessions/expired-records.job.ts',
    'sessions/sessions.service.ts',
    'users/expired-lock.sweep.ts',
    'users/users.service.ts',
  ],
  ticket: [
    'analytics/export.processor.ts',
    'analytics/export.service.ts',
    'analytics/ticket-rollup.job.ts',
    'audit/audit.consumer.ts',
    'job-runs/job-runs.module.ts',
    'ops/ops.module.ts',
    'prisma/database.seeder.ts',
    'scheduler/outage-retries.ts',
  ],
  ingestion: [
    'services/ingestion-service/src/ai-reembed.ts',
    'analytics/ai-generation-rollup.job.ts',
    'ingestion/conflict-check.service.ts',
    'ingestion/ingestion-reconcile.sweep.ts',
    'ingestion/ingestion.processor.ts',
    'ingestion/scope-reconcile.sweep.ts',
    'ingestion/scope-writer.service.ts',
    'job-runs/job-runs.module.ts',
    'ops/ops.module.ts',
    'platform/platform.service.ts',
    'prisma/database.seeder.ts',
    'qdrant/qdrant.service.ts',
    'scheduled/chunk-usage.projection.ts',
    'scheduled/discarded-draft.sweep.ts',
    'scheduled/document-flag-writer.ts',
    'scheduled/quota-reconciliation.job.ts',
    'scheduler/ledger-daily.sequence.ts',
  ],
  notification: [
    'prisma/database.seeder.ts',
    'job-runs/job-runs.module.ts',
    'ops/ops.module.ts',
    'push/device-token.service.ts',
    'webhooks/webhook-delivery.processor.ts',
    'webhooks/webhook-retention.job.ts',
    'inbound-email/inbound-rejection.consumer.ts',
  ],
};

/** Per service: the files that may hold raw SQL. */
const RAW_SQL: Record<Service, readonly string[]> = {
  auth: ['prisma/database.seeder.ts', 'finance/finance.service.ts'],
  ticket: [
    'prisma/database.seeder.ts',
    'feedback/feedback.service.ts',
    'tickets/tickets.service.ts',
    'analytics/analytics.service.ts',
    'analytics/ticket-rollup.job.ts',
  ],
  ingestion: [
    'prisma/database.seeder.ts',
    'scheduled/chunk-usage.projection.ts',
    'analytics/ai-generation-rollup.job.ts',
    'analytics/ai-analytics.service.ts',
    'scheduler/ledger-daily.sequence.ts',
    'ingestion/scope-reconcile.sweep.ts',
  ],
  notification: [
    'prisma/database.seeder.ts',
    'in-app/in-app-notification.service.ts',
    'feed/feed.service.ts',
  ],
};

/**
 * Per service: `file#function` allowed a nested write on a tenant relation.
 * Each checks the ids it attaches against the tenant (or attaches only system
 * roles, which every tenant shares).
 */
const NESTED_WRITES: Record<Service, readonly string[]> = {
  auth: [
    'roles/roles.service.ts#setUserRoles',
    'roles/roles.service.ts#grantRoles',
    'roles/roles.service.ts#releaseUserRoles',
    'auth/auth.service.ts#createUserInResolvedTenant',
    'auth/auth.service.ts#createUserFromGoogle',
    'users/users.service.ts#resolveInboundSender',
  ],
  ticket: [],
  ingestion: [],
  notification: [],
};

const SERVICES = Object.keys(RAW_SQL) as Service[];

/** `src/modules/` relative paths, the registry's spelling. */
const MODULES = (service: Service) =>
  `services/${service}-service/src/modules/`;

function sources(service: Service) {
  return readListed(
    repoFiles(`services/${service}-service/src`).filter(
      (path) =>
        path.endsWith('.ts') &&
        !path.endsWith('.spec.ts') &&
        !path.includes('/generated/'),
    ),
  ).map((file) => ({
    path: file.path,
    short: file.path.replace(MODULES(service), ''),
    code: stripComments(file.text),
  }));
}

/** The relation fields whose target model has an `organizationId`. */
function tenantRelations(service: Service): Set<string> {
  const schema = readFileSync(
    join(REPO_ROOT, `services/${service}-service/prisma/schema.prisma`),
    'utf8',
  );
  const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gmu)].map(
    ([, name, body]) => ({ name, body }),
  );
  const owned = new Set(
    models
      .filter((model) => /^\s+organizationId\s/mu.test(model.body))
      .map((model) => model.name),
  );
  const fields = new Set<string>();
  for (const model of models) {
    for (const [, field, type] of model.body.matchAll(
      /^\s+(\w+)\s+(\w+)(?:\[\])?\??\s/gmu,
    )) {
      if (owned.has(type)) fields.add(field);
    }
  }

  return fields;
}

/** The method or function a position in `code` sits in. */
function enclosing(code: string, index: number): string {
  const before = code.slice(0, index);
  const heads = [
    ...before.matchAll(
      /^(?: {2}(?:(?:public|private|protected|static|async|readonly)\s+)*([a-zA-Z_]\w*)\s*(?:<[^>\n]*>)?\(|(?:export\s+)?(?:async\s+)?function\s+(\w+))/gmu,
    ),
  ];
  const last = heads.at(-1);

  return last ? (last[1] ?? last[2]) : '(top level)';
}

describe.each(SERVICES)(
  '%s-service and the tenant-scoped client',
  (service) => {
    const files = sources(service);

    it('**no direct use of the bare client** once the service has moved', () => {
      if (!MIGRATED.has(service)) return;

      const found = files
        .filter((file) => !file.short.endsWith('prisma/prisma.service.ts'))
        .flatMap((file) =>
          [
            // `this.prisma` used any way but `.scoped(…)` / `.unscoped(…)`:
            // a call, or the bare client passed along as a value.
            ...file.code.matchAll(
              /\bthis\.prisma\b(?!\s*\.\s*(?:scoped|unscoped)\()(?:\s*\.\s*[$\w]+)?/gu,
            ),
            // Any other client named `prisma` (a factory's parameter).
            ...file.code.matchAll(
              /(?<![\w/$.])prisma\s*\.\s*(?!scoped\(|unscoped\()[$A-Za-z]\w*/gu,
            ),
          ].map((match) => `${file.short}: ${match[0].replace(/\s+/gu, '')}`),
        );

      expect(found).toEqual([]);
    });

    it('**`unscoped(…)`** appears only in the files listed for it', () => {
      const found = files
        .filter((file) => /\.unscoped\(/u.test(file.code))
        .map((file) => file.short)
        .filter((short) => !UNSCOPED[service].includes(short));

      expect(found).toEqual([]);
    });

    it('**raw SQL** appears only in the files listed for it', () => {
      const found = files
        .filter((file) => /\$(?:queryRaw|executeRaw)/u.test(file.code))
        .map((file) => file.short)
        .filter((short) => !RAW_SQL[service].includes(short));

      expect(found).toEqual([]);
    });

    it('**a nested connect / set on a tenant relation** happens only in the functions listed', () => {
      const relations = tenantRelations(service);
      const found = files.flatMap((file) =>
        [
          ...file.code.matchAll(
            /\b(\w+)\s*:\s*\{\s*(connect|connectOrCreate|set)\s*:/gu,
          ),
        ]
          .filter((match) => relations.has(match[1]))
          .map((match) => `${file.short}#${enclosing(file.code, match.index)}`)
          .filter((site) => !NESTED_WRITES[service].includes(site)),
      );

      expect(found).toEqual([]);
    });

    it('**every registry entry still points at something**, so the lists can only shrink honestly', () => {
      const shorts = new Set(files.map((file) => file.short));
      const stale = [
        ...UNSCOPED[service].filter(
          (short) =>
            !files.some(
              (f) => f.short === short && /\.unscoped\(/u.test(f.code),
            ),
        ),
        ...RAW_SQL[service].filter(
          (short) =>
            !files.some(
              (f) =>
                f.short === short && /\$(?:queryRaw|executeRaw)/u.test(f.code),
            ),
        ),
        ...NESTED_WRITES[service].filter(
          (site) => !shorts.has(site.split('#')[0]),
        ),
      ];

      expect(stale).toEqual([]);
    });
  },
);
