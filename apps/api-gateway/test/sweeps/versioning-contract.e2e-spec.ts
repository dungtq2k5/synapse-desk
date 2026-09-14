import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { stripComments } from '@synapsedesk/common/testing/strip-comments';
import { API, E2eFixture, bootstrapE2eTest } from '../utils';
import {
  API_VERSION,
  resolveGlobalPrefix,
} from '../../src/modules/health/ops-routes';

/**
 * URI versioning is applied, the same way, by every composition root.
 *
 * **Why the static half exists.** The e2e suites boot `test/utils/bootstrap.ts`
 * and `test/utils/realtime.ts`, never `main.ts`. A bootstrap that forgot
 * `enableVersioning` — or kept applying the raw `GLOBAL_PREFIX` — would serve
 * its own set of paths and every test against it would stay green. The CORS and
 * helmet sweeps found exactly that shape; this is the same guard for routing.
 */
describe('URI versioning is applied by every composition root', () => {
  const SRC = join(__dirname, '../../src');
  const code = (path: string): string =>
    stripComments(readFileSync(path, 'utf8'));

  const BOOTSTRAPS = {
    'src/main.ts': join(SRC, 'main.ts'),
    'test/utils/bootstrap.ts': join(__dirname, '../utils/bootstrap.ts'),
    'test/utils/realtime.ts': join(__dirname, '../utils/realtime.ts'),
  };

  /** What each composition root must contain, as source text. */
  const REQUIRED = [
    /app\.setGlobalPrefix\(\s*(?:globalPrefix|resolveGlobalPrefix\()/,
    /exclude:\s*OPS_ROUTES/,
    /app\.enableVersioning\(\s*API_VERSIONING\s*\)/,
  ];

  const missing = (text: string): string[] =>
    REQUIRED.filter((pattern) => !pattern.test(text)).map(String);

  it('1. **all three bootstraps resolve the prefix and enable the SAME versioning**', () => {
    for (const [label, path] of Object.entries(BOOTSTRAPS)) {
      expect([label, missing(code(path))]).toEqual([label, []]);
    }

    // `main.ts` names its prefix `globalPrefix`, so the first pattern accepts
    // that — this pins that the name it applies is the RESOLVED value.
    expect(code(BOOTSTRAPS['src/main.ts'])).toMatch(
      /const globalPrefix = resolveGlobalPrefix\(/,
    );
  });

  it('2. …and the check can see a bootstrap that left versioning OUT', () => {
    // The pattern-fires half: a bootstrap that applies the raw prefix and never
    // enables versioning must be reported, and a conforming one must not.
    const stale = `app.setGlobalPrefix(configService.getOrThrow('GLOBAL_PREFIX'), { exclude: OPS_ROUTES });`;
    const conforming = `app.setGlobalPrefix(resolveGlobalPrefix(raw), { exclude: OPS_ROUTES });\napp.enableVersioning(API_VERSIONING);`;

    expect(missing(stale)).toHaveLength(2);
    expect(missing(conforming)).toEqual([]);
  });

  describe('what the running gateway serves', () => {
    let fx: E2eFixture;

    beforeAll(async () => {
      fx = await bootstrapE2eTest();
    }, 30_000);

    afterAll(() => fx.close());

    it('3. a route answers under the version and **404s WITHOUT it**', async () => {
      // Under URI versioning the version is part of the path. This is the test
      // that fails if `defaultVersion` is ever "simplified" away: unversioned
      // controllers would then answer at `/api/tickets` as well.
      const server = fx.app.getHttpServer();
      const prefix = resolveGlobalPrefix(process.env.GLOBAL_PREFIX ?? 'api');

      expect(API).toBe(`/${prefix}/v${API_VERSION}`);
      expect((await request(server).get(`${API}/tickets`)).status).not.toBe(
        404,
      );
      expect((await request(server).get(`/${prefix}/tickets`)).status).toBe(
        404,
      );
      // And the legacy prefix is not applied on top of the version.
      expect(
        (await request(server).get(`${API}/v${API_VERSION}/tickets`)).status,
      ).toBe(404);
    });

    it('4. **the Swagger document stays under the version** — `docs-json` generates client SDKs', async () => {
      const server = fx.app.getHttpServer();

      expect((await request(server).get(`${API}/docs-json`)).status).toBe(200);
      expect(
        (
          await request(server).get(
            `/${resolveGlobalPrefix(process.env.GLOBAL_PREFIX ?? 'api')}/docs-json`,
          )
        ).status,
      ).toBe(404);
    });
  });
});
