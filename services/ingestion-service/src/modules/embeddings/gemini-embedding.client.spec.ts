import { ApiError } from '@google/genai';
import { ConfigService } from '@nestjs/config';
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL } from '@synapsedesk/contracts';
import { DEFAULT_RATE_LIMIT_WAIT_MS, RateLimited } from './embedding.contract';
import { GeminiEmbeddingClient, retryDelayMs } from './gemini-embedding.client';

/** The client with the SDK's `embedContent` replaced, answering one vector per content. */
function clientWith(embedContent: jest.Mock): GeminiEmbeddingClient {
  const config = { getOrThrow: () => 'test-key' } as unknown as ConfigService;
  const client = new GeminiEmbeddingClient(config);
  (client as unknown as { client: unknown }).client = {
    models: { embedContent },
  };
  return client;
}

const vector = () => new Array<number>(EMBEDDING_DIMENSION).fill(0.1);

describe('GeminiEmbeddingClient', () => {
  it('sends each text as its own content, so it gets one vector per text', async () => {
    // The real API's behavior: one embedding per content, whatever its parts.
    const embedContent = jest.fn(({ contents }: { contents: unknown[] }) =>
      Promise.resolve({
        embeddings: contents.map(() => ({ values: vector() })),
        metadata: { billableCharacterCount: 42 },
      }),
    );
    const texts = ['first passage', 'second passage', 'third passage'];

    const result = await clientWith(embedContent).embedBatch(
      texts,
      EMBEDDING_MODEL,
    );

    expect(embedContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: texts.map((text) => ({ role: 'user', parts: [{ text }] })),
      }),
    );
    expect(result.vectors).toHaveLength(3);
    expect(result.promptTokens).toBe(42);
  });

  it('refuses a response with fewer vectors than texts', async () => {
    const embedContent = jest.fn(() =>
      Promise.resolve({ embeddings: [{ values: vector() }] }),
    );

    await expect(
      clientWith(embedContent).embedBatch(['a', 'b'], EMBEDDING_MODEL),
    ).rejects.toThrow('Embedding provider returned 1 vectors for 2 texts');
  });

  it('turns a 429 into RateLimited, with the wait the provider asked for', async () => {
    // The shape the SDK throws: the API's JSON body as the message.
    const message = JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.RetryInfo',
            retryDelay: '7s',
          },
        ],
      },
    });
    const embedContent = jest.fn(() =>
      Promise.reject(new ApiError({ message, status: 429 })),
    );

    const refused = clientWith(embedContent).embedBatch(['a'], EMBEDDING_MODEL);

    await expect(refused).rejects.toBeInstanceOf(RateLimited);
    await expect(refused).rejects.toMatchObject({ waitMs: 7000 });
  });

  it('passes any other provider error through unchanged', async () => {
    const error = new ApiError({ message: 'bad request', status: 400 });
    const embedContent = jest.fn(() => Promise.reject(error));

    await expect(
      clientWith(embedContent).embedBatch(['a'], EMBEDDING_MODEL),
    ).rejects.toBe(error);
  });

  it.each([
    ['"retryDelay": "7s"', 7000],
    ['"retryDelay":"0.5s"', 500],
    ['no delay at all', DEFAULT_RATE_LIMIT_WAIT_MS],
  ])('reads the wait from %s', (message, waitMs) => {
    expect(retryDelayMs(message)).toBe(waitMs);
  });
});
