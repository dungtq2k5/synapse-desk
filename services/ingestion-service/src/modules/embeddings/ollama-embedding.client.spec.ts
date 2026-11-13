import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  EMBEDDING_DIMENSION,
  MODELS_BY_PROVIDER,
} from '@synapsedesk/contracts';
import { RateLimited } from './embedding.contract';
import { silentServer } from '../../../test/utils/silent-server';
import {
  checkOllama,
  DOCUMENT_PREFIX,
  OllamaEmbeddingClient,
} from './ollama-embedding.client';

const MODEL = MODELS_BY_PROVIDER.ollama.embeddingModel;
const GENERATOR = MODELS_BY_PROVIDER.ollama.cheapModel;

/** A fake Ollama: a real HTTP server answering `/api/embed`. */
describe('OllamaEmbeddingClient (unit)', () => {
  let server: Server;
  let url: string;
  let received: { model: string; input: string[]; options: unknown }[];
  let answer: { status: number; body: unknown };

  beforeAll(async () => {
    server = createServer((request, response) => {
      let raw = '';
      request.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      request.on('end', () => {
        if (raw) received.push(JSON.parse(raw) as (typeof received)[number]);
        response.writeHead(answer.status, {
          'Content-Type': 'application/json',
        });
        response.end(JSON.stringify(answer.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  beforeEach(() => {
    received = [];
    answer = {
      status: 200,
      body: {
        embeddings: [
          new Array(EMBEDDING_DIMENSION).fill(0.1),
          new Array(EMBEDDING_DIMENSION).fill(0.2),
        ],
        prompt_eval_count: 12,
      },
    };
  });

  it('embeds the document side with its prefix, and sends num_ctx', async () => {
    const result = await new OllamaEmbeddingClient(url, 8192).embedBatch(
      ['Refunds take 5 days.', 'Laptops are replaced every 3 years.'],
      MODEL,
    );

    expect(received[0]).toEqual({
      model: MODEL,
      input: [
        `${DOCUMENT_PREFIX}Refunds take 5 days.`,
        `${DOCUMENT_PREFIX}Laptops are replaced every 3 years.`,
      ],
      options: { num_ctx: 8192 },
    });
    expect(result.vectors).toHaveLength(2);
    expect(result.promptTokens).toBe(12);
  });

  it('refuses a vector of the wrong length', async () => {
    answer.body = { embeddings: [new Array(1024).fill(0.1)] };

    await expect(
      new OllamaEmbeddingClient(url, 8192).embedBatch(['a'], MODEL),
    ).rejects.toThrow('1024-dim');
  });

  it('refuses a short answer rather than shifting vectors onto other chunks', async () => {
    await expect(
      new OllamaEmbeddingClient(url, 8192).embedBatch(['a', 'b', 'c'], MODEL),
    ).rejects.toThrow('2 vectors for 3 texts');
  });

  it('turns a full queue (503) into a wait, not a failure', async () => {
    answer = { status: 503, body: { error: 'server busy' } };

    await expect(
      new OllamaEmbeddingClient(url, 8192).embedBatch(['a'], MODEL),
    ).rejects.toBeInstanceOf(RateLimited);
  });

  it('names an unpulled model in the failure', async () => {
    answer = { status: 404, body: { error: `model "${MODEL}" not found` } };

    await expect(
      new OllamaEmbeddingClient(url, 8192).embedBatch(['a'], MODEL),
    ).rejects.toThrow(`Ollama answered 404 for ${MODEL}`);
  });

  describe('the boot check', () => {
    beforeEach(() => {
      answer = {
        status: 200,
        body: { models: [{ name: MODEL, digest: 'abc' }] },
      };
    });

    it('names the variable when Ollama does not answer', async () => {
      await expect(
        checkOllama('http://127.0.0.1:9', MODEL, {}),
      ).rejects.toThrow(/OLLAMA_BASE_URL .* doesn't answer/);
    });

    it('names the pull command for a model that is not there', async () => {
      await expect(checkOllama(url, GENERATOR, {})).rejects.toThrow(
        `run \`ollama pull ${GENERATOR}\``,
      );
    });

    it('refuses a tag re-pulled onto other weights', async () => {
      await expect(checkOllama(url, MODEL, { [MODEL]: 'def' })).rejects.toThrow(
        'not the pinned',
      );
      await expect(
        checkOllama(url, MODEL, { [MODEL]: 'abc' }),
      ).resolves.toBeUndefined();
    });
  });

  it('gives up at its deadline when Ollama accepts and never answers', async () => {
    const silent = await silentServer();
    try {
      const started = Date.now();
      await expect(
        new OllamaEmbeddingClient(silent.url, 8192, 300).embedBatch(
          ['a'],
          MODEL,
        ),
      ).rejects.toBeInstanceOf(RateLimited);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await silent.close();
    }
  });
});
