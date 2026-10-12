import { defineConfig } from 'orval';

/**
 * The REST client, generated from the committed document. Generated, never
 * committed: `generate` runs before `build`, `typecheck` and `test`, so a
 * breaking change to `docs/reference/openapi.json` fails this package's
 * typecheck in the same push.
 *
 * Every call goes through one mutator, `customFetch`, which is where the 401
 * handling lives. Calls return the response body; a non-2xx throws `ApiError`.
 */
export default defineConfig({
  rest: {
    input: { target: '../../docs/reference/openapi.json' },
    output: {
      target: 'src/generated/rest/endpoints.ts',
      schemas: 'src/generated/rest/model',
      client: 'react-query',
      httpClient: 'fetch',
      mode: 'split',
      override: {
        mutator: { path: 'src/fetcher.ts', name: 'customFetch' },
        fetch: { includeHttpResponseReturnType: false },
        query: { version: 5 },
      },
    },
  },
});
