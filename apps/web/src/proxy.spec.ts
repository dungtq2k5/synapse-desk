/**
 * @jest-environment node
 */
import { contentSecurityPolicy } from './proxy';

describe('the Content-Security-Policy', () => {
  const policy = (development = false) =>
    Object.fromEntries(
      contentSecurityPolicy('abc', development)
        .split('; ')
        .map((directive) => {
          const [name, ...values] = directive.split(' ');
          return [name, values];
        }),
    );

  it('allows scripts by this request nonce only, and nothing from elsewhere', () => {
    expect(policy()['script-src']).toEqual([
      "'self'",
      "'nonce-abc'",
      "'strict-dynamic'",
    ]);
    expect(policy()['default-src']).toEqual(["'self'"]);
    expect(policy()['connect-src']).toEqual(["'self'"]);
    expect(policy()['object-src']).toEqual(["'none'"]);
  });

  it('cannot be framed', () => {
    expect(policy()['frame-ancestors']).toEqual(["'none'"]);
  });

  it("adds eval and the dev server's socket in development only", () => {
    expect(policy(true)['script-src']).toContain("'unsafe-eval'");
    expect(policy(true)['connect-src']).toContain('ws:');
    expect(policy(false)['script-src']).not.toContain("'unsafe-eval'");
  });
});
