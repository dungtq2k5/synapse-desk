/**
 * @file `KnowledgeApi` — no `@RequirePermission` anywhere, deliberately: a
 * knowledge base must be readable by every authenticated user, including
 * one holding zero permissions. The sharpest properties: `ask`/`search`
 * reject an all-whitespace body after trimming (the dropped {@code
 * @Transform(trimIfString)}), `getArticle` sends an explicit empty
 * `sortBy` on its block range, and `ask` refuses at the AI cap (402) while
 * `search` degrades (200 + `degraded`).
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

describe('knowledge', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = 'cccccccc-0000-4000-8000-cccccccccccc';
  const AGENT = 'bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb';
  const ARTICLE = '11111111-1111-4111-8111-111111111111';

  // Zero permission codes — this is the point of the whole interface.
  const headers = () => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: AGENT,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes: [],
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  const wireArticle = (overrides: Record<string, unknown> = {}) => ({
    id: ARTICLE,
    title: 'Refund Policy',
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
    chunkCount: 3,
    ...overrides,
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

  rowFor('Knowledge')(
    '**`listArticles` needs no permission code — zero-permission caller succeeds**',
    async () => {
      peers.ingestion
        .on('DocumentService/ListKnowledgeArticles')
        .reply({ items: [wireArticle()], meta: { totalItems: 1 } });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/knowledge/articles`,
        headers(),
      );

      expect(response.status).toBe(200);
    },
  );

  rowFor('Knowledge')(
    '**`getArticle` sends an explicit empty `sortBy` on the block range**',
    async () => {
      peers.ingestion.on('DocumentService/GetKnowledgeArticle').reply({
        article: wireArticle(),
        blocks: [],
        meta: { totalItems: 0 },
        hasUnindexedPages: false,
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/knowledge/articles/${ARTICLE}`,
        headers(),
      );

      expect(response.status).toBe(200);
      const [call] = peers.ingestion.calls(
        'DocumentService/GetKnowledgeArticle',
      );
      expect((call.request.page as Record<string, unknown>).sortBy).toBe('');
    },
  );

  rowFor('Knowledge')(
    '**`getArticle` forwards a `passage` and answers its `passageIndex`; without one, `null`**',
    async () => {
      const PASSAGE = 'aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa';
      const detail = {
        article: wireArticle(),
        blocks: [],
        meta: { totalItems: 0 },
        hasUnindexedPages: false,
      };
      peers.ingestion
        .on('DocumentService/GetKnowledgeArticle')
        .reply({ ...detail, passageIndex: 1 });
      peers.ingestion.on('DocumentService/GetKnowledgeArticle').reply(detail);

      const cited = await new Session(gateway.baseUrl).get<{
        data: { passageIndex: number | null };
      }>(`${API}/knowledge/articles/${ARTICLE}?passage=${PASSAGE}`, headers());
      const plain = await new Session(gateway.baseUrl).get<{
        data: { passageIndex: number | null };
      }>(`${API}/knowledge/articles/${ARTICLE}`, headers());

      expect(cited.status).toBe(200);
      expect(cited.body.data.passageIndex).toBe(1);
      expect(plain.body.data.passageIndex).toBeNull();
      const [first, second] = peers.ingestion.calls(
        'DocumentService/GetKnowledgeArticle',
      );
      expect(first.request.passage).toBe(PASSAGE);
      expect(second.request.passage).toBeUndefined();
    },
  );

  rowFor('Knowledge')(
    "**`getArticle` refuses a `passage` that isn't a uuid, before the peer**",
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/knowledge/articles/${ARTICLE}?passage=not-a-uuid`,
        headers(),
      );

      expect(response.status).toBe(400);
      expect(
        peers.ingestion.calls('DocumentService/GetKnowledgeArticle'),
      ).toHaveLength(0);
    },
  );

  rowFor('Knowledge')(
    '**`ask` refuses an all-whitespace message after trimming — the dropped `@Transform`**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/knowledge/ask`,
        { message: '   ' },
        headers(),
      );

      expect(response.status).toBe(400);
      expect(peers.rag.calls('RagService/Ask')).toHaveLength(0);
    },
  );

  rowFor('Knowledge')(
    '**`ask` forwards the trimmed message with empty history and zero attachments**',
    async () => {
      peers.rag.on('RagService/Ask').reply({
        content: 'The refund window is 30 days.',
        status: 1, // ANSWER_STATUS_DOC_ANSWER
        citations: [],
        generationId: 'gen-1',
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/knowledge/ask`,
        { message: '  what is the refund policy?  ' },
        headers(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ message: 'Answer generated' });
      const [call] = peers.rag.calls('RagService/Ask');
      expect(call.request).toMatchObject({
        message: 'what is the refund policy?',
        attachmentCount: 0,
      });
      expect(
        (call.request.history as unknown[] | undefined) ?? [],
      ).toHaveLength(0);
    },
  );

  rowFor('Knowledge')(
    '**`ask` refuses at the AI cap with 402, not 403**',
    async () => {
      peers.rag
        .on('RagService/Ask')
        .fail(
          GrpcStatus.PERMISSION_DENIED,
          '[http:402] The workspace has used its AI allowance',
        );

      const response = await new Session(gateway.baseUrl).post(
        `${API}/knowledge/ask`,
        { message: 'what is the refund policy?' },
        headers(),
      );

      expect(response.status).toBe(402);
    },
  );

  rowFor('Knowledge')(
    '**`search` refuses an all-whitespace query after trimming**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/knowledge/search`,
        { query: '   ' },
        headers(),
      );

      expect(response.status).toBe(400);
      expect(peers.rag.calls('RagService/Search')).toHaveLength(0);
    },
  );

  rowFor('Knowledge')(
    '**`search` degrades to 200 with `degraded` set at the cap, rather than refusing**',
    async () => {
      peers.rag.on('RagService/Search').reply({ chunks: [], degraded: 1 }); // SEARCH_DEGRADATION_LEXICAL_ONLY

      const response = await new Session(gateway.baseUrl).post(
        `${API}/knowledge/search`,
        { query: 'refund policy' },
        headers(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { degraded: 'LEXICAL_ONLY' },
      });
    },
  );

  rowFor('Knowledge')(
    '**`search` forwards the trimmed query, limit and `skipRerank`**',
    async () => {
      peers.rag.on('RagService/Search').reply({ chunks: [], degraded: 0 });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/knowledge/search`,
        { query: '  refund policy  ', limit: 20, skipRerank: true },
        headers(),
      );

      expect(response.status).toBe(200);
      const [call] = peers.rag.calls('RagService/Search');
      expect(call.request).toMatchObject({
        query: 'refund policy',
        limit: 20,
        skipRerank: true,
      });
    },
  );
});
