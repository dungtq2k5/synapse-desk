/**
 * @file Documents and their chunks.
 *
 * Third in the order, and the reason is not only `organization_id`:
 * `ai_generations.ticket_id` points at `postgres_ticket`, so ingestion sits
 * after it in the DAG. That edge carries no rows today — seeding the AI ledger
 * is out of scope — which is exactly why the order test asserts the edge rather
 * than the current data.
 */

import { faker } from '@faker-js/faker';
import { DocumentStatus } from '@synapsedesk/common';
import {
  buildTenant,
  createChunks,
  createDocument,
} from '../../../apps/ingestion-service/test/factories';
import type { PrismaService } from '../../../apps/ingestion-service/src/modules/prisma/prisma.service';
import type { ManifestTenant } from '../manifest';
import type { Profile } from '../profiles';
import { tenantsOf, type SeedStep } from '../registry';

const TRANSACTION_TIMEOUT_MS = 30_000;
const TRANSACTION_MAX_WAIT_MS = 15_000;

/** Chunks per document. Fixed: a chunk count is a property of a file's length. */
const CHUNKS_PER_DOCUMENT = 4;

/**
 * What to write, taken from what the auth step already decided.
 *
 * **Not re-derived.** The auth step chose this tenant's document count and byte
 * total from its plan grants; deriving a second answer here would be two
 * definitions of one quantity, and they would disagree the moment either fill
 * changed — the tenant would then hold more documents than the demo believes it
 * planned, which is the class of drift §5 exists to prevent.
 */
export function documentPlanFor(tenant: ManifestTenant): {
  documents: number;
  bytesEach: bigint;
} {
  const documents = tenant.planned.documents;
  const total = BigInt(tenant.planned.storageBytes);

  // Split the total across the documents rather than choosing a file size and
  // multiplying: the second form is how a tenant ends up over `maxStorageBytes`
  // with every individual file looking reasonable.
  return {
    documents,
    bytesEach: documents > 0 ? total / BigInt(documents) : 0n,
  };
}

export const ingestionStep: SeedStep = {
  service: 'ingestion',
  run: (context) =>
    seedDocuments(
      context.clients.ingestion,
      tenantsOf(context),
      context.profile,
      context.apply,
    ),
};

export async function seedDocuments(
  prisma: PrismaService,
  tenants: ManifestTenant[],
  _profile: Profile,
  apply: boolean,
): Promise<string[]> {
  const lines: string[] = [];

  for (const tenant of tenants) {
    const plan = documentPlanFor(tenant);
    lines.push(
      `${tenant.slug.padEnd(24)} ${String(plan.documents).padStart(4)} documents  ` +
        `${(Number(plan.bytesEach * BigInt(plan.documents)) / 1024 ** 3).toFixed(2)} GiB`,
    );

    if (!apply) continue;

    await prisma.$transaction(
      async (tx) => writeDocuments(tx as PrismaService, tenant, plan),
      { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
    );
  }

  return lines;
}

async function writeDocuments(
  tx: PrismaService,
  tenant: ManifestTenant,
  plan: { documents: number; bytesEach: bigint },
): Promise<void> {
  const fixture = buildTenant({
    organizationId: tenant.organizationId,
    userId: tenant.adminUserId,
    departmentId: tenant.departmentIds[0],
  });

  for (let index = 0; index < plan.documents; index++) {
    const document = await createDocument(tx, fixture, {
      // INDEXED, because a demo corpus that is all PENDING shows a pipeline
      // mid-flight rather than a knowledge base. The chunks below carry no
      // `vectorPointId`, so "indexed" here means the rows a search would join
      // against exist — see the comment there.
      status: DocumentStatus.INDEXED,
      fileSizeBytes: plan.bytesEach,
      createdAt: faker.date.recent({ days: 120 }),
    });

    // `vectorPointId` stays NULL — chunks exist, vectors do not. That is the
    // state the pipeline genuinely holds between writing rows and upserting to
    // Qdrant, and it is why knowledge search returns nothing for seeded data:
    // an honest empty result rather than nonsense rankings from fake vectors.
    await createChunks(tx, document, CHUNKS_PER_DOCUMENT, tenant.departmentIds);
  }
}
