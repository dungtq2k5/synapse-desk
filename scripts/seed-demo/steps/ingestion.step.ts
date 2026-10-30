/**
 * @file Documents, their chunks, and the AI ledger behind AI usage.
 *
 * Third in the order, and the reason is not only `organization_id`:
 * `ai_generations.ticket_id` points at `postgres_ticket` (a chat answer names
 * its ticket), so ingestion sits after it in the DAG.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { faker } from '@faker-js/faker';
import {
  AiGenerationOutcome,
  AiGenerationPurpose,
  AiGenerationStatus,
  CHEAP_MODEL,
  DocumentStatus,
  EMBEDDING_MODEL,
  GENERATION_MODEL_BY_TIER,
} from '@synapsedesk/contracts';
import {
  buildTenant,
  createChunks,
  createDocument,
} from '../../../services/ingestion-service/test/factories';
import type { Prisma } from '../../../services/ingestion-service/src/generated/prisma/client';
import type { PrismaService } from '../../../services/ingestion-service/src/modules/prisma/prisma.service';
import type { ManifestTenant } from '../manifest';
import type { Profile } from '../profiles';
import { REPO_ROOT } from '../paths';
import { tenantsOf, type SeedStep } from '../registry';

const TRANSACTION_TIMEOUT_MS = 30_000;
const TRANSACTION_MAX_WAIT_MS = 15_000;

/** Chunks per document. Fixed: a chunk count is a property of a file's length. */
const CHUNKS_PER_DOCUMENT = 4;

/**
 * The files behind the demo documents: one each of PDF, Word and Markdown,
 * committed beside this step, so download, reindex and replace all have a
 * real object to read.
 */
export const DOCUMENT_FIXTURES = [
  {
    file: 'remote-work-policy.pdf',
    title: 'Remote Work Policy',
    fileType: 'pdf',
    contentType: 'application/pdf',
  },
  {
    file: 'new-starter-guide.docx',
    title: 'New Starter Guide',
    fileType: 'docx',
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  {
    file: 'expenses-faq.md',
    title: 'Expenses FAQ',
    fileType: 'md',
    contentType: 'text/markdown',
  },
] as const;

/**
 * The fixture behind the `index`th document, and its title: the three in
 * turn, numbered from their second round.
 *
 * @example fixtureFor(4).title // 'New Starter Guide 2.docx'
 */
export function fixtureFor(index: number) {
  const fixture = DOCUMENT_FIXTURES[index % DOCUMENT_FIXTURES.length];
  const round = Math.floor(index / DOCUMENT_FIXTURES.length);
  return {
    ...fixture,
    title: `${fixture.title}${round ? ` ${round + 1}` : ''}.${fixture.fileType}`,
  };
}

/** The Storage emulator, from storage-service's own `.env`, or `null`. */
function storageEmulator(): { host: string; bucket: string } | null {
  let text: string;
  try {
    text = readFileSync(
      join(REPO_ROOT, 'services/storage-service/.env'),
      'utf8',
    );
  } catch {
    return null;
  }
  const read = (key: string) =>
    new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm').exec(text)?.[1]?.trim();
  const host = read('FIREBASE_STORAGE_EMULATOR_HOST');
  const bucket = read('FIREBASE_STORAGE_BUCKET');
  return host && bucket ? { host, bucket } : null;
}

/** Writes one object to the emulator, unsigned, as presign tells a browser to. */
async function upload(
  emulator: { host: string; bucket: string },
  objectPath: string,
  file: string,
  contentType: string,
): Promise<void> {
  const response = await fetch(
    `http://${emulator.host}/upload/storage/v1/b/${encodeURIComponent(emulator.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: readFileSync(join(__dirname, '../fixtures', file)),
    },
  );
  if (!response.ok) {
    throw new Error(
      `The Storage emulator answered ${response.status} for ${objectPath}`,
    );
  }
}

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
  const emulator = apply ? storageEmulator() : null;
  if (apply && !emulator) {
    lines.push(
      'No Storage emulator in services/storage-service/.env: documents get no files, so download, reindex and replace will fail.',
    );
  }

  for (const tenant of tenants) {
    const plan = documentPlanFor(tenant);
    lines.push(
      `${tenant.slug.padEnd(24)} ${String(plan.documents).padStart(4)} documents  ` +
        `${(Number(plan.bytesEach * BigInt(plan.documents)) / 1024 ** 3).toFixed(2)} GiB`,
    );

    if (!apply) continue;

    const files = await prisma.$transaction(
      async (tx) => {
        const written = await writeDocuments(tx as PrismaService, tenant, plan);
        await writeGenerations(tx as PrismaService, tenant);
        return written;
      },
      { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
    );
    // After the rows commit: a network write has no place in a transaction.
    if (emulator) {
      for (const { objectPath, file, contentType } of files) {
        await upload(emulator, objectPath, file, contentType);
      }
    }
  }

  return lines;
}

async function writeDocuments(
  tx: PrismaService,
  tenant: ManifestTenant,
  plan: { documents: number; bytesEach: bigint },
): Promise<{ objectPath: string; file: string; contentType: string }[]> {
  const fixture = buildTenant({
    organizationId: tenant.organizationId,
    userId: tenant.adminUserId,
    departmentId: tenant.departmentIds[0],
  });

  const files: { objectPath: string; file: string; contentType: string }[] = [];
  for (let index = 0; index < plan.documents; index++) {
    const file = fixtureFor(index);
    // The path presign would choose: under the tenant, a nonce, a fresh name.
    const objectPath = `organizations/${tenant.organizationId}/documents/${randomUUID()}/${randomUUID()}.${file.fileType}`;
    files.push({ objectPath, file: file.file, contentType: file.contentType });
    const document = await createDocument(tx, fixture, {
      title: file.title,
      fileUrl: objectPath,
      fileType: file.fileType,
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
  return files;
}

/** The model the Quality tier answers with. */
const QUALITY_MODEL = GENERATION_MODEL_BY_TIER.QUALITY;

/** Days of AI history, ending today. */
const LEDGER_DAYS = 60;

/**
 * A day's calls by purpose, `[min, max]`, and the model each runs on. Costs
 * are micro-dollars per call, kept small: a month stays well under the
 * smallest plan's allowance, so seeding never turns a tenant's AI off.
 */
const CALLS: Record<
  AiGenerationPurpose,
  { per: [number, number]; model: string; cost: [number, number] }
> = {
  [AiGenerationPurpose.CHAT_ANSWER]: {
    per: [2, 6],
    model: QUALITY_MODEL,
    cost: [400, 900],
  },
  [AiGenerationPurpose.DRAFT]: {
    per: [2, 5],
    model: QUALITY_MODEL,
    cost: [300, 700],
  },
  [AiGenerationPurpose.REVIEW]: {
    per: [2, 5],
    model: QUALITY_MODEL,
    cost: [150, 350],
  },
  [AiGenerationPurpose.SUMMARY]: {
    per: [1, 3],
    model: QUALITY_MODEL,
    cost: [150, 300],
  },
  [AiGenerationPurpose.SUGGESTIONS]: {
    per: [1, 3],
    model: CHEAP_MODEL,
    cost: [40, 120],
  },
  [AiGenerationPurpose.CLASSIFY]: {
    per: [2, 5],
    model: CHEAP_MODEL,
    cost: [20, 60],
  },
  [AiGenerationPurpose.INJECTION_CLASSIFY]: {
    per: [2, 6],
    model: CHEAP_MODEL,
    cost: [10, 40],
  },
  [AiGenerationPurpose.GREETING_CLASSIFY]: {
    per: [1, 4],
    model: CHEAP_MODEL,
    cost: [10, 30],
  },
  [AiGenerationPurpose.REFORMULATION]: {
    per: [1, 3],
    model: CHEAP_MODEL,
    cost: [10, 30],
  },
  // A few judge calls a night, from the conflict check's sweep.
  [AiGenerationPurpose.CONFLICT_CHECK]: {
    per: [0, 2],
    model: CHEAP_MODEL,
    cost: [10, 30],
  },
  [AiGenerationPurpose.EMBEDDING]: {
    per: [1, 3],
    model: EMBEDDING_MODEL,
    cost: [5, 20],
  },
};

const ANSWERING = new Set<string>([
  AiGenerationPurpose.CHAT_ANSWER,
  AiGenerationPurpose.DRAFT,
]);

/**
 * The AI ledger: calls across every purpose for the last {@link LEDGER_DAYS}
 * days. Answers retrieve from the first two thirds of the documents and cite
 * from the first third, so the Knowledge lists have documents most cited,
 * retrieved but never cited, and never retrieved; some find nothing (gaps).
 * Drafts carry the outcome an agent gave them.
 */
async function writeGenerations(
  tx: PrismaService,
  tenant: ManifestTenant,
): Promise<void> {
  const chunks = await tx.documentChunk.findMany({
    where: { organizationId: tenant.organizationId },
    select: { id: true, documentId: true },
    orderBy: [{ documentId: 'asc' }, { chunkIndex: 'asc' }],
  });
  const documents = [...new Set(chunks.map((chunk) => chunk.documentId))];
  const third = Math.max(1, Math.floor(documents.length / 3));
  const cited = new Set(documents.slice(0, third));
  const found = chunks.filter(
    (chunk) => documents.indexOf(chunk.documentId) < third * 2,
  );
  const agents = tenant.agentIds ?? [tenant.adminUserId];
  const chats = tenant.chatTicketIds ?? [];

  const rows: Prisma.AiGenerationCreateManyInput[] = [];
  for (let back = LEDGER_DAYS - 1; back >= 0; back--) {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - back);
    for (const [name, call] of Object.entries(CALLS)) {
      const purpose = name as AiGenerationPurpose;
      const count = faker.number.int({ min: call.per[0], max: call.per[1] });
      for (let index = 0; index < count; index++) {
        const at = new Date(
          Math.min(
            Date.UTC(
              day.getUTCFullYear(),
              day.getUTCMonth(),
              day.getUTCDate(),
              faker.number.int({ min: 7, max: 19 }),
              faker.number.int({ min: 0, max: 59 }),
            ),
            Date.now(),
          ),
        );
        const answering = ANSWERING.has(purpose);
        const retrieved =
          answering && found.length && faker.number.float() > 0.15
            ? faker.helpers.arrayElements(found, { min: 1, max: 3 })
            : [];
        rows.push({
          organizationId: tenant.organizationId,
          userId:
            purpose === AiGenerationPurpose.DRAFT
              ? faker.helpers.arrayElement(agents)
              : null,
          ticketId:
            purpose === AiGenerationPurpose.CHAT_ANSWER && chats.length
              ? faker.helpers.arrayElement(chats)
              : null,
          purpose,
          modelName: call.model,
          promptTokens: faker.number.int({ min: 200, max: 2400 }),
          completionTokens:
            purpose === AiGenerationPurpose.EMBEDDING
              ? 0
              : faker.number.int({ min: 20, max: 600 }),
          estimatedCostMicros: BigInt(
            faker.number.int({ min: call.cost[0], max: call.cost[1] }),
          ),
          latencyMs: faker.number.int({
            min: 150,
            max: answering ? 5200 : 1400,
          }),
          status:
            faker.number.float() < 0.02
              ? AiGenerationStatus.FAILED
              : AiGenerationStatus.SUCCESS,
          retrievedChunkIds: retrieved.map((chunk) => chunk.id),
          citedChunkIds: retrieved
            .filter((chunk) => cited.has(chunk.documentId))
            .map((chunk) => chunk.id),
          outcome:
            purpose === AiGenerationPurpose.DRAFT
              ? faker.helpers.weightedArrayElement([
                  { value: AiGenerationOutcome.ACCEPTED, weight: 6 },
                  { value: AiGenerationOutcome.EDITED, weight: 3 },
                  { value: AiGenerationOutcome.DISCARDED, weight: 2 },
                ])
              : null,
          createdAt: at,
        });
      }
    }
  }
  await tx.aiGeneration.createMany({ data: rows });
}
