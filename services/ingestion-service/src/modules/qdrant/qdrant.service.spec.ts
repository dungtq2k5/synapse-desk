import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { EMBEDDING_DIMENSION, QDRANT_COLLECTION } from '@synapsedesk/contracts';
import { QdrantService, READ_ATTEMPTS, READ_DELAY_MS } from './qdrant.service';

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

  beforeEach(() => {
    jest.mocked(QdrantClient).mockClear();
    service = new QdrantService({
      getOrThrow: () => 'http://qdrant.test',
    } as unknown as ConfigService);
    client = jest.mocked(QdrantClient).mock
      .instances[0] as jest.Mocked<QdrantClient>;
    client.collectionExists.mockResolvedValue({ exists: false });
    client.createPayloadIndex.mockResolvedValue({} as never);
    client.getCollection.mockResolvedValue({
      config: { params: { vectors: { size: EMBEDDING_DIMENSION } } },
    } as never);
  });

  it('creates a missing collection and its indexes', async () => {
    client.createCollection.mockResolvedValue(true);

    await service.ensureCollection();

    expect(client.createCollection).toHaveBeenCalledTimes(1);
    expect(client.getCollection).not.toHaveBeenCalled();
    expect(client.createPayloadIndex).toHaveBeenCalledTimes(5);
  });

  it('**a create that loses the race to rag-service goes on as if it found the collection**', async () => {
    client.createCollection.mockRejectedValue(conflict);

    await expect(service.ensureCollection()).resolves.toBeUndefined();

    expect(client.getCollection).toHaveBeenCalledWith(QDRANT_COLLECTION);
    expect(client.createPayloadIndex).toHaveBeenCalledTimes(5);
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

      await expect(done).resolves.toBeUndefined();
      expect(client.getCollection).toHaveBeenCalledTimes(3);
      expect(client.createPayloadIndex).toHaveBeenCalledTimes(5);
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
});
