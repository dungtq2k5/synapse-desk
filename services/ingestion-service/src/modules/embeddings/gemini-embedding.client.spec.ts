import { ConfigService } from '@nestjs/config';
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL } from '@synapsedesk/contracts';
import { GeminiEmbeddingClient } from './gemini-embedding.client';

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
});
