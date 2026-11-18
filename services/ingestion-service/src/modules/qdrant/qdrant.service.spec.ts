import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import {
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL,
  MODELS_BY_PROVIDER,
  QDRANT_COLLECTION,
  collectionAlias,
} from '@synapsedesk/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { QdrantService, READ_ATTEMPTS, READ_DELAY_MS } from './qdrant.service';

const GEMINI_ALIAS = collectionAlias(EMBEDDING_MODEL);
const LOCAL_MODEL = MODELS_BY_PROVIDER.ollama.embeddingModel;

jest.mock('@qdrant/js-client-rest');

/** Qdrant's answer to a create that lost the race: what the client throws. */
const conflict = Object.assign(new Error('Conflict'), {
  status: 409,
  data: {
    status: {
      error: `Wrong input: Collection \`${QDRANT_COLLECTION}\` already exists!`,
    },
  },
});

describe('QdrantService.ensureCollection (unit)', () => {
  let client: jest.Mocked<QdrantClient>;
  let service: QdrantService;
  let embedded: { id: string } | null;

  /** The service for one provider, over a Qdrant mock with no alias yet. */
  function build(provider = 'gemini'): void {
    jest.mocked(QdrantClient).mockClear();
    const rows = {
      documentChunk: { findFirst: jest.fn(() => Promise.resolve(embedded)) },
    };
    const prisma = { unscoped: () => rows } as unknown as PrismaService;
    service = new QdrantService(
      {
        getOrThrow: () => 'http://qdrant.test',
        get: () => provider,
      } as unknown as ConfigService,
      prisma,
    );
    client = jest.mocked(QdrantClient).mock
      .instances[0] as jest.Mocked<QdrantClient>;
    client.getAliases.mockResolvedValue({ aliases: [] });
    client.updateCollectionAliases.mockResolvedValue(true);
    client.updateCollection.mockResolvedValue(true);
    client.collectionExists.mockResolvedValue({ exists: false });
    client.createPayloadIndex.mockResolvedValue({} as never);
    client.getCollection.mockResolvedValue({
      config: { params: { vectors: { size: EMBEDDING_DIMENSION } } },
    } as never);
  }

  beforeEach(() => {
    embedded = null;
    build();
  });

  it('creates a missing collection and its indexes', async () => {
    client.createCollection.mockResolvedValue(true);

    await expect(service.ensureCollection()).resolves.toBe(true);

    expect(client.createCollection).toHaveBeenCalledWith(
      `${GEMINI_ALIAS}_1`,
      expect.objectContaining({
        metadata: { embedding_model: EMBEDDING_MODEL },
      }),
    );
    expect(client.getCollection).not.toHaveBeenCalled();
    expect(client.createPayloadIndex).toHaveBeenCalledTimes(6);
    expect(client.updateCollectionAliases).toHaveBeenCalledWith({
      actions: [
        {
          create_alias: {
            collection_name: `${GEMINI_ALIAS}_1`,
            alias_name: GEMINI_ALIAS,
          },
        },
      ],
    });
  });

  it('**a create that loses the race to rag-service goes on as if it found the collection**', async () => {
    client.createCollection.mockRejectedValue(conflict);

    await expect(service.ensureCollection()).resolves.toBe(true);

    expect(client.getCollection).toHaveBeenCalledWith(`${GEMINI_ALIAS}_1`);
    expect(client.createPayloadIndex).toHaveBeenCalledTimes(6);
  });

  it('still checks the dimension of the collection the other service created', async () => {
    client.createCollection.mockRejectedValue(conflict);
    client.getCollection.mockResolvedValue({
      config: { params: { vectors: { size: EMBEDDING_DIMENSION + 1 } } },
    } as never);

    await expect(service.ensureCollection()).rejects.toThrow(
      /dimensional vectors/,
    );
  });

  it('any other create failure fails the boot', async () => {
    client.createCollection.mockRejectedValue(
      Object.assign(new Error('Bad Request'), { status: 400 }),
    );

    await expect(service.ensureCollection()).rejects.toThrow('Bad Request');
    expect(client.createPayloadIndex).not.toHaveBeenCalled();
  });

  describe('a collection still loading', () => {
    /** Qdrant's answer while the other service's collection loads. */
    const loading = Object.assign(new Error('Internal Server Error'), {
      status: 500,
    });

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('is waited for, then checked like any other', async () => {
      client.collectionExists.mockResolvedValue({ exists: true });
      client.getCollection
        .mockRejectedValueOnce(loading)
        .mockRejectedValueOnce(loading);

      const done = service.ensureCollection();
      await jest.advanceTimersByTimeAsync(2 * READ_DELAY_MS);

      await expect(done).resolves.toBe(true);
      expect(client.getCollection).toHaveBeenCalledTimes(3);
      expect(client.createPayloadIndex).toHaveBeenCalledTimes(6);
    });

    it('that never loads still fails the boot', async () => {
      client.collectionExists.mockResolvedValue({ exists: true });
      client.getCollection.mockRejectedValue(loading);

      const done = service.ensureCollection();
      const settled = expect(done).rejects.toThrow('Internal Server Error');
      await jest.advanceTimersByTimeAsync(READ_ATTEMPTS * READ_DELAY_MS);

      await settled;
      expect(client.getCollection).toHaveBeenCalledTimes(READ_ATTEMPTS);
    });
  });

  it("adopts the pre-alias collection as Gemini's", async () => {
    client.collectionExists.mockResolvedValue({ exists: true });

    await expect(service.ensureCollection()).resolves.toBe(true);

    expect(client.updateCollection).toHaveBeenCalledWith(QDRANT_COLLECTION, {
      metadata: { embedding_model: EMBEDDING_MODEL },
    });
    expect(client.updateCollectionAliases).toHaveBeenCalledWith({
      actions: [
        {
          create_alias: {
            collection_name: QDRANT_COLLECTION,
            alias_name: GEMINI_ALIAS,
          },
        },
      ],
    });
    expect(client.createCollection).not.toHaveBeenCalled();
  });

  it('**holds rather than creating when chunks already have vectors elsewhere**', async () => {
    // The flip without `ai:reembed`: another model's vectors exist, so an
    // empty collection for this one would answer every question with nothing.
    embedded = { id: 'chunk' };
    build('ollama');
    client.collectionExists.mockResolvedValue({ exists: true });

    await expect(service.ensureCollection()).resolves.toBe(false);
    expect(client.createCollection).not.toHaveBeenCalled();
    expect(client.updateCollectionAliases).not.toHaveBeenCalled();
  });

  it("fails the boot when the alias points at another model's collection", async () => {
    build('ollama');
    client.getAliases.mockResolvedValue({
      aliases: [
        {
          alias_name: collectionAlias(LOCAL_MODEL),
          collection_name: 'elsewhere',
        },
      ],
    });
    client.getCollection.mockResolvedValue({
      config: {
        params: { vectors: { size: EMBEDDING_DIMENSION } },
        metadata: { embedding_model: EMBEDDING_MODEL },
      },
    } as never);

    await expect(service.ensureCollection()).rejects.toThrow(
      `holds ${EMBEDDING_MODEL} vectors but is reached as ${LOCAL_MODEL}'s`,
    );
  });

  it('skips a scope write while held: ai:reembed rewrites it from the rows', async () => {
    embedded = { id: 'chunk' };
    build('ollama');

    await service.setDocumentScope('doc', 'org', { isDeleted: true });

    expect(client.setPayload).not.toHaveBeenCalled();
  });
});
