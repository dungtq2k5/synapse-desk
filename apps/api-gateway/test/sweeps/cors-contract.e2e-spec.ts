import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CORS_ALLOWED_HEADERS,
  CORS_EXPOSED_HEADERS,
  CORS_METHODS,
} from '../../src/common/config/cors.config';
import { compareAlphabetically } from '@synapsedesk/common';

/**
 * The CORS allow-lists cover what a client actually has to send.
 *
 * **Why a scan and not only the e2e.** `cors.e2e-spec.ts` proves the middleware
 * honours the lists, against literals that spell out today's requirement. It
 * cannot notice tomorrow's: route a `@Head()` handler, or wire `enableCors` in
 * `main.ts` from something other than these constants, and it stays green. Both
 * of those are text properties with no runtime expression inside a harness that
 * boots one app from one bootstrap, which is the case where a scan is the only
 * guard available rather than a substitute for a test.
 *
 * Each check below carries a corpus floor and a control that the pattern still
 * fires, because the way a scan dies is by matching nothing and reporting it as
 * agreement.
 */
describe('CORS allow-lists cover the client contract', () => {
  const SRC = join(__dirname, '../../src');
  const CONFIG = join(SRC, 'common/config/cors.config.ts');

  /** Every `.ts` under `src`, minus the config the scan is checking. */
  function sources(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        found.push(...sources(path));
      } else if (entry.endsWith('.ts')) {
        found.push(path);
      }
    }
    return found;
  }

  /**
   * Source with comments removed.
   *
   * Not tidiness, and measured rather than assumed. Deleting `credentials:
   * true` from `main.ts` while leaving the LINE-comment strip out passes check
   * 4: the comment above the call reads "`credentials: true` is required for
   * the HttpOnly access-token cookie", so the scan finds its own explanation of
   * the rule and reports it as an observance of the rule.
   *
   * The block-comment half is defensive — nothing in today's corpus needs it —
   * but `cors.config.ts` names every header in its docblocks, so the first file
   * to describe this policy in a block comment would reintroduce exactly the
   * shape the line-comment half was proven to prevent.
   */
  const code = (path: string): string => {
    return (
      readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // `[ \t]`, not `\s`. `\s` matches a NEWLINE, so `^\s*` runs past the
        // start of its own line and backtracks across every blank line looking for
        // a `//` that is not there — measured quadratic over this corpus: 4.2ms at
        // 2k blank lines, 15.4ms at 4k, 61.8ms at 8k, against 0.0ms for this form.
        //
        // Behaviour is unchanged where it matters: over all 346 files this scan
        // reads, the two forms differ on 106 of them and in ZERO non-whitespace
        // content. `\s` was only swallowing the blank lines between comments.
        .replace(/^[ \t]*\/\/.*$/gm, '')
    );
  };

  const FILES = sources(SRC).filter((path) => path !== CONFIG);

  it('0. **The corpus is populated** — control', () => {
    // A floor, not a count. If a refactor moves `src`, every check below
    // vacuously agrees with an empty corpus and this is the only line that
    // notices.
    expect(FILES.length).toBeGreaterThan(150);
  });

  it('1. **Every routed HTTP method is in `CORS_METHODS`**', () => {
    // `PUT` is the reason: four routes used it — the replace-the-whole-set
    // writes for roles, permissions and department membership — while the
    // allow-list named only four other verbs, so a browser could not change
    // who can do what and the failure arrived as a CORS error rather than a
    // 403.
    const routed = new Set<string>();
    for (const path of FILES) {
      for (const match of code(path).matchAll(
        /@(Get|Post|Put|Patch|Delete|Options|Head)\s*\(/g,
      )) {
        routed.add(match[1].toUpperCase());
      }
    }

    // Control: the pattern finds the verbs that are known to be routed. Without
    // it, a decorator syntax change makes `routed` empty and the assertion
    // below passes over nothing.
    expect([...routed].sort(compareAlphabetically)).toEqual(
      expect.arrayContaining(
        ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'].sort(compareAlphabetically),
      ),
    );

    // `OPTIONS` is answered by the `cors` middleware itself and `HEAD` is
    // implied by `GET`; neither needs to be declared, and neither is routed
    // today. If one ever is, this fails and the fix is to add it to the
    // allow-list rather than to except it here.
    expect([...routed].filter((verb) => !CORS_METHODS.includes(verb))).toEqual(
      [],
    );
  });

  /**
   * Headers a browser must send that NO controller reads.
   *
   * The important half of the list. `@Headers('…')` finds `idempotency-key`
   * and would have found nothing else: `Content-Type` and `Authorization` are
   * consumed by the pipes and the guard, `X-Requested-With` by nothing at all,
   * and Apollo's two by the driver before any handler runs. A list derived from
   * controllers alone would have looked complete and shipped a broken GraphQL
   * client.
   */
  const UNREAD_BUT_REQUIRED: Readonly<Record<string, string>> = {
    'Content-Type': 'every JSON body; the pipes read it, no handler does',
    Authorization:
      'Bearer fallback when the cookie is absent — read by the guard',
    'X-Requested-With': 'the front end sets it on XHR; nothing reads it',
    'x-apollo-operation-name':
      "Apollo's CSRF prevention is ON by default and rejects without it",
    'apollo-require-preflight':
      'the alternative Apollo accepts for the same check',
  };

  /**
   * Headers only a MACHINE caller sends, which is why they are absent from the
   * allow-list.
   *
   * Named rather than carved out with a pattern, for the reason the `TWINLESS`
   * map is: a regex exemption makes the scan red the day a browser header is
   * added that happens to match it, and whoever runs it next widens the regex.
   * A named entry has to be argued for.
   */
  const NON_BROWSER_HEADERS: Readonly<Record<string, string>> = {
    'stripe-signature':
      'Stripe posts server-to-server and sends no Origin; CORS never applies',
    'auto-submitted': 'the mail Worker relays it; RFC 3834 loop suppression',
    precedence: 'same relay, same purpose',
    'user-agent':
      'a forbidden header name — the browser sets it and script cannot',
  };

  it('2. **Every header a browser must send is in `CORS_ALLOWED_HEADERS`**', () => {
    const read = new Set<string>();
    for (const path of FILES) {
      const text = code(path);
      for (const match of text.matchAll(/@Headers\s*\(\s*'([^']+)'/g)) {
        read.add(match[1].toLowerCase());
      }
      for (const match of text.matchAll(/headers\[\s*'([^']+)'\s*\]/g)) {
        read.add(match[1].toLowerCase());
      }
    }

    // Control: the two shapes still find the headers known to be read.
    expect([...read].sort(compareAlphabetically)).toEqual(
      expect.arrayContaining(
        ['auto-submitted', 'idempotency-key', 'stripe-signature'].sort(
          compareAlphabetically,
        ),
      ),
    );

    const allowed = new Set(
      CORS_ALLOWED_HEADERS.map((header) => header.toLowerCase()),
    );
    const exempt = new Set(
      Object.keys(NON_BROWSER_HEADERS).map((header) => header.toLowerCase()),
    );

    // Direction one: a header a controller reads is either allowed or named as
    // machine-only. Adding `@Headers('x-tenant-id')` fails here.
    expect(
      [...read].filter((header) => !allowed.has(header) && !exempt.has(header)),
    ).toEqual([]);

    // Direction two: the headers no controller reads, which the scan above
    // cannot see and which are the ones that broke.
    expect(
      Object.keys(UNREAD_BUT_REQUIRED).filter(
        (header) => !allowed.has(header.toLowerCase()),
      ),
    ).toEqual([]);

    // And the exemption list stays honest: an entry that no longer appears
    // anywhere is a carve-out for a caller that no longer exists.
    expect([...exempt].filter((header) => !read.has(header))).toEqual([]);
  });

  it('3. **Every rate-limit header the guard writes is exposed**', () => {
    // `@nestjs/throttler` writes four (`headerPrefix = 'X-RateLimit'`, plus
    // `Retry-After`) and a cross-origin client could read none of them.
    // `Retry-After` is recovery; `X-RateLimit-Remaining` is avoidance, and it
    // is the only one that lets a client slow down before it is refused.
    const written = [
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ];
    const exposed = new Set(
      CORS_EXPOSED_HEADERS.map((header) => header.toLowerCase()),
    );

    expect(
      written.filter((header) => !exposed.has(header.toLowerCase())),
    ).toEqual([]);
  });

  it('4. **Both bootstraps read the same four values**', () => {
    // The gap sabotage found: the e2e boots `test/utils/bootstrap.ts`, so
    // rewriting `main.ts` to inline its own method list leaves every CORS test
    // green while production refuses `PUT`. Neither file is reachable from a
    // runtime assertion in this suite, which is what makes text the only
    // available guard here.
    const BOOTSTRAPS = {
      'src/main.ts': join(SRC, 'main.ts'),
      'test/utils/bootstrap.ts': join(__dirname, '../utils/bootstrap.ts'),
    };

    for (const [label, path] of Object.entries(BOOTSTRAPS)) {
      const text = code(path);

      // Control: the call itself is present. Without this, a file that stopped
      // calling `enableCors` would satisfy nothing and fail nothing.
      expect([label, /app\.enableCors\(/.test(text)]).toEqual([label, true]);

      for (const token of [
        'corsOrigins(',
        'credentials: true',
        'methods: CORS_METHODS',
        'allowedHeaders: CORS_ALLOWED_HEADERS',
        'exposedHeaders: CORS_EXPOSED_HEADERS',
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
