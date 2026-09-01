/**
 * @file The steps that need a third party — indexing, retrieval, and the quota
 * threshold.
 *
 * **Separated from the journey, and §9's check 1 is why.** That check stops a
 * service and requires the journey to go red. If these steps were in the same
 * file, a red could equally mean an expired key, a rate limit or a dropped
 * connection — and **a check whose signal is ambiguous is not a check**.
 *
 * **Step 8 is here too, which corrects the plan.** The doc grouped the quota
 * threshold with the third-party-free steps, but the counter is driven by
 * `RecordGeneration`, and the only honest producer of one is an actual AI
 * generation. The harness could call that RPC directly — and calling it
 * directly is precisely the hand-rolled-publisher shape §1 rejects for step 6.
 * So it belongs on this side of the line.
 *
 * **Skipped, never failed, when the key is absent.** "Skipped: GEMINI_API_KEY is
 * unset" is information; a red step is a false report that something is broken.
 */

import { config } from 'dotenv';
import { REPO_ROOT } from './services';

/**
 * Whether the AI dependency is configured at all.
 *
 * Read from `ingestion-service`'s own `.env` rather than `process.env`, because
 * that is where the running service reads it from — a harness that checked its
 * own environment would skip on a machine where the services are perfectly
 * configured, and run on one where they are not.
 */
function aiConfigured(): boolean {
  const parsed = config({
    path: `${REPO_ROOT}/apps/ingestion-service/.env`,
    processEnv: {},
  });

  return Boolean(parsed.parsed?.GEMINI_API_KEY);
}

const describeAi = aiConfigured() ? describe : describe.skip;

describeAi('The AI journey (needs GEMINI_API_KEY and network)', () => {
  it.todo(
    '4. upload a document and wait for INDEXED — gateway, ingestion, storage, BullMQ, Qdrant',
  );

  it.todo('5. ask a question about it — ingestion to rag-service');

  it.todo(
    '8. cross a quota threshold — the producer, the alarm and the notification arm',
  );
});

// The `describe.skip` above reports these as skipped with the suite name saying
// why. A `describe` that vanished entirely would be indistinguishable from one
// nobody wrote, which is the shape this repository keeps finding: a guard that
// silently covers nothing.
