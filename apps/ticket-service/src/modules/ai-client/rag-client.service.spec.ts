import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { RAG_GRPC_CLIENT } from '@synapsedesk/grpc-proto';
import { memberContext } from '@synapsedesk/common/testing/context';
import { RagClientService } from './rag-client.service';
/**
 * **Populate model/token fields only where they cannot be read as the meter.**
 *
 * The rule looks like an inconsistency, which is the dangerous combination:
 * `generateReplyDraft` zeroes `modelName`/`promptTokens` while
 * `generateSummary` passes `modelName` through, and a tidying pass unifies them
 * in one line. The asymmetry is the design:
 *
 *   - A draft lands on `ticket_messages`, which HAS token columns. Leaving them
 *     empty is what stops a second metering path forming beside
 *     `ai_generations` — the one the quota gate actually sums.
 *   - A summary lands on `ai_summaries`, where `model_name` is NOT NULL and
 *     there are NO token columns. Display metadata, not spend.
 *
 * Asserted here rather than in an e2e test: one that stubs the adapter and
 * checks the columns are zero proves only that zero was stored, and would pass
 * against a mapper that had stopped zeroing. The wire responses below carry
 * real numbers deliberately.
 */
describe('RagClientService — the single metering path', () => {
  /** Any caller will do — none of this affects the mapping under test. */
  const CONTEXT = memberContext({
    id: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
  });

  /**
   * A stand-in, NOT a real model name.
   *
   * `check-model-literals.mjs` scans test files too, and it is
   * right to: a real name here would be one grep away from being copied into a
   * call site. Nothing in this test depends on the value — the point is that the
   * mapper drops whatever the wire carried.
   */
  const WIRE_MODEL = 'model-from-the-wire';

  const WIRE_DRAFT = {
    draft: 'A generated reply',
    generationId: 'gen-1',
    modelName: WIRE_MODEL,
    promptTokens: 1_234,
    completionTokens: 567,
    citations: [],
  };

  const WIRE_SUMMARY = {
    summary: 'Customer cannot print.',
    suggestedAction: 'Dispatch an engineer.',
    confidenceScore: 0.8,
    modelName: WIRE_MODEL,
    generationId: 'gen-2',
    promptTokens: 999,
    completionTokens: 111,
  };

  let service: RagClientService;

  beforeEach(async () => {
    const rag = {
      draft: jest.fn().mockReturnValue(of(WIRE_DRAFT)),
      summarize: jest.fn().mockReturnValue(of(WIRE_SUMMARY)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RagClientService,
        {
          provide: ConfigService,
          // Configured, so `isAvailable` is true and the calls are dialled.
          useValue: { get: () => 'localhost:50055' },
        },
        {
          provide: RAG_GRPC_CLIENT,
          useValue: { getService: () => rag },
        },
      ],
    }).compile();

    service = moduleRef.get(RagClientService);
    service.onModuleInit();
  });

  it('DROPS the model and token fields from a reply draft', async () => {
    // rag-service has already written the ledger row carrying these exact
    // numbers. Copying them onto `ticket_messages` from a second source is how
    // two metering paths start, and they then disagree in a way nobody notices
    // until someone queries an invoice.
    const draft = await service.generateReplyDraft('t-1', [], CONTEXT);

    expect(draft.content).toBe('A generated reply');
    expect(draft.modelName).toBe('');
    expect(draft.promptTokens).toBe(0);
    expect(draft.completionTokens).toBe(0);
  });

  it('KEEPS the generation id, which is not a meter', async () => {
    // The id is the join the review loop needs — it comes back as
    // `generatedFromId` when the agent posts. Dropping it with the token fields
    // would silently disable outcome tracking.
    const draft = await service.generateReplyDraft('t-1', [], CONTEXT);

    expect(draft.generationId).toBe('gen-1');
  });

  it('KEEPS the model name on a summary, where there is no token column', async () => {
    // The other side of the asymmetry. `ai_summaries.model_name` is NOT NULL
    // and the table has no token columns, so the name is display metadata that
    // cannot be read as spend.
    const summary = await service.generateSummary('t-1', [], CONTEXT, false);

    expect(summary.modelName).toBe(WIRE_MODEL);
    expect(summary).not.toHaveProperty('promptTokens');
  });
});
