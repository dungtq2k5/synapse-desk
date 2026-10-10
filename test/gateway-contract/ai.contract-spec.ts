/**
 * @file `AiApi` — the AI co-pilot surface. Every route is a single unary
 * passthrough; the sharpest row here proves the billing 402 (a gRPC
 * `PERMISSION_DENIED` carrying a `[http:402]` marker) resolves end to end
 * through the generic gap-38 mapping, the first route in this port to
 * actually exercise that marker.
 */

import { sign } from 'jsonwebtoken';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('ai', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = 'bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb';
  const USER = 'bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb';
  const TICKET = 'cccccccc-1111-4111-8111-cccccccccccc';

  const headers = (permissionCodes: string[] = []) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes,
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    gateway = await startGateway({
      ...peers.env,
      REDIS_URL: redisUrl,
      NATS_URL: natsUrl,
    });
  }, 90_000);

  afterAll(async () => {
    await gateway.stop();
    await peers.stop();
  });

  beforeEach(() => {
    peers.reset();
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
  });

  rowFor('Ai')(
    '**`getSummary` needs `ticket.read.all`, not `ticket.ai.use`**',
    async () => {
      peers.ticket.on('AiService/GetSummary').reply({
        id: 'sum-1',
        ticketId: TICKET,
        summaryText: 'The customer wants a refund.',
        suggestedAction: 'Issue the refund.',
        confidenceScore: 0.9,
        modelName: 'gpt-test',
        createdAt: { seconds: 1_756_684_800, nanos: 0 },
        updatedAt: { seconds: 1_756_684_800, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/tickets/${TICKET}/ai/summary`,
        headers(['ticket.read.all']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { summaryText: 'The customer wants a refund.' },
      });
    },
  );

  rowFor('Ai')(
    '**`generateSummary` upserts and answers 200, not 201**',
    async () => {
      peers.ticket.on('AiService/GenerateSummary').reply({
        id: 'sum-1',
        ticketId: TICKET,
        summaryText: 'Regenerated summary.',
        suggestedAction: 'Follow up.',
        confidenceScore: 0.8,
        modelName: 'gpt-test',
        createdAt: { seconds: 1_756_684_800, nanos: 0 },
        updatedAt: { seconds: 1_756_684_800, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/ai/summary`,
        undefined,
        headers(['ticket.ai.use']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { summaryText: 'Regenerated summary.' },
      });
    },
  );

  rowFor('Ai')(
    '**`generateSummary` answers 402 when the AI allowance is exhausted — the `[http:402]` marker, resolved end to end**',
    async () => {
      peers.ticket
        .on('AiService/GenerateSummary')
        .fail(
          GrpcStatus.PERMISSION_DENIED,
          '[http:402] Your AI allowance for this billing cycle is exhausted',
        );

      const response = await new Session(gateway.baseUrl).post<{
        error: string;
      }>(
        `${API}/tickets/${TICKET}/ai/summary`,
        undefined,
        headers(['ticket.ai.use']),
      );

      expect(response.status).toBe(402);
      expect(response.body).toMatchObject({
        error: expect.stringContaining(
          'AI allowance for this billing cycle is exhausted',
        ),
      });
      expect(response.body.error).not.toContain('[http:402]');
    },
  );

  rowFor('Ai')(
    '**`generateDraft` forwards the optional instruction and returns citations**',
    async () => {
      peers.ticket.on('AiService/GenerateDraft').reply({
        content: 'Draft reply text.',
        modelName: 'gpt-test',
        promptTokens: 120,
        completionTokens: 45,
        generationId: 'gen-1',
        citations: [
          {
            chunkId: 'chunk-1',
            documentId: 'doc-1',
            documentTitle: 'Refund Policy',
            pageNumber: 3,
          },
        ],
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/ai/draft`,
        { instruction: 'Keep it short' },
        headers(['ticket.ai.use']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          generationId: 'gen-1',
          citations: [{ documentTitle: 'Refund Policy', pageNumber: 3 }],
        },
      });
      const [call] = peers.ticket.calls('AiService/GenerateDraft');
      expect(call.request).toMatchObject({
        ticketId: TICKET,
        instruction: 'Keep it short',
      });
    },
  );

  rowFor('Ai')(
    '**`getSuggestions` passes a `LEXICAL_ONLY` degradation through untouched, with 200**',
    async () => {
      peers.ticket.on('AiService/GetSuggestions').reply({
        items: [],
        articles: [
          { documentId: 'doc-1', documentTitle: 'Refund Policy', score: 0.5 },
        ],
        degraded: 'SUGGESTIONS_DEGRADATION_LEXICAL_ONLY',
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/ai/suggestions`,
        undefined,
        headers(['ticket.ai.use']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { degraded: 'LEXICAL_ONLY', nextSteps: [] },
      });
    },
  );

  rowFor('Ai')(
    '**`classify` narrows an unrecognized priority to `null` rather than a guess**',
    async () => {
      peers.ticket.on('AiService/ClassifyTicket').reply({
        suggestedDepartmentId: 'dept-1',
        suggestedPriority: 'TICKET_PRIORITY_UNSPECIFIED',
        confidenceScore: 0.4,
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/ai/classify`,
        undefined,
        headers(['ticket.ai.use']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { suggestedDepartmentId: 'dept-1', suggestedPriority: null },
      });
    },
  );
});
