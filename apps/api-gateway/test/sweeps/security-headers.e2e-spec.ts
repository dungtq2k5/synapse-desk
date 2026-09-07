import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { stripComments } from '@synapsedesk/common/testing/strip-comments';
import { API, E2eFixture, bootstrapE2eTest } from '../utils';

/**
 * The response-header policy, and the one HTML page it is written for.
 *
 * Everything this gateway serves is JSON except the Swagger UI, so the CSP is a
 * policy for that page — and a policy nothing loads is a policy nobody notices
 * breaking. These tests are the two halves of that: the headers are present on
 * an ordinary route, and the page they govern still only loads things they
 * allow. known-gaps #27.
 *
 * **What this suite cannot prove** is that a browser enforces the header. A
 * `Content-Security-Policy` that is present and wrong looks identical here to
 * one that is present and right — hence the sabotage recorded in the batch
 * plan: set `scriptSrc: ["'none'"]` and load `/docs` by hand once.
 */
describe('Security response headers', () => {
  let fx: E2eFixture;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  afterAll(() => fx.close());

  it('1. **A JSON route carries the whole set, and no `X-Powered-By`**', async () => {
    // `/health` rather than an API route: it is outside the global prefix and
    // needs no auth, so this asserts the middleware runs for everything rather
    // than for the routes that happen to be guarded.
    const response = await request(fx.app.getHttpServer()).get('/health');

    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBeDefined();

    // Express advertises itself by default; helmet removes it. A version string
    // in a header is free reconnaissance.
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('2. **Every asset the docs page loads is same-origin**', async () => {
    // The test that fails the day `@nestjs/swagger` starts loading from a CDN —
    // which is the day `script-src 'self'` silently stops rendering the page.
    // Asserted against the served HTML rather than against the package, because
    // the package is what changes.
    const response = await request(fx.app.getHttpServer()).get(`${API}/docs`);

    expect(response.status).toBe(200);

    const urls = [
      ...response.text.matchAll(/<script[^>]+src=["']([^"']+)["']/g),
      ...response.text.matchAll(/<link[^>]+href=["']([^"']+)["']/g),
    ].map((match) => match[1]);

    // Vacuity floor: a page that loads nothing would satisfy the filter below
    // while proving nothing about the policy.
    expect(urls.length).toBeGreaterThanOrEqual(3);

    const offsite = urls.filter(
      (url) => /^[a-z]+:/i.test(url) || url.startsWith('//'),
    );

    expect(offsite).toEqual([]);
  });

  it('3. **The docs page carries no inline `<script>` at all**', async () => {
    // `script-src 'self'` is only sufficient while that holds. The template's
    // `<% customJs %>` / `<% customJsStr %>` slots render empty when unset, and
    // `swagger.config.ts` sets neither — so this is the assertion that fires
    // the day somebody sets one without revisiting the directive.
    const response = await request(fx.app.getHttpServer()).get(`${API}/docs`);

    const inline = [...response.text.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)];

    expect(inline).toEqual([]);
  });

  it('4. **Both bootstraps apply the same options object**', () => {
    // The gap the CORS sweep found, one middleware over: the e2e boots
    // `test/utils/bootstrap.ts`, so a `main.ts` that inlined its own directives
    // would leave every test above green while production served a different
    // policy. Neither file is reachable from a runtime assertion here, which is
    // what makes text the only available guard.
    const BOOTSTRAPS = {
      'src/main.ts': join(__dirname, '../../src/main.ts'),
      'test/utils/bootstrap.ts': join(__dirname, '../utils/bootstrap.ts'),
    };

    for (const [label, path] of Object.entries(BOOTSTRAPS)) {
      const text = stripComments(readFileSync(path, 'utf8'));

      for (const token of [
        'security-headers.config',
        'helmet(SECURITY_HEADERS)',
      ]) {
        expect([label, token, text.includes(token)]).toEqual([
          label,
          token,
          true,
        ]);
      }
    }
  });
});
