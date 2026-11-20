/**
 * @jest-environment node
 */
import { firebaseOrigins, storageOrigin } from './lib/firebase-config';
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

  it('lets Google sign-in reach the emulator, or Google, and frame its auth page', () => {
    const directives = (
      firebase: Parameters<typeof contentSecurityPolicy>[2],
    ) =>
      Object.fromEntries(
        contentSecurityPolicy('abc', false, firebase)
          .split('; ')
          .map((directive) => {
            const [name, ...values] = directive.split(' ');
            return [name, values];
          }),
      );
    const config = {
      apiKey: 'k',
      authDomain: 'acme.firebaseapp.com',
      projectId: 'acme',
      emulatorUrl: null,
    };

    const emulated = directives(
      firebaseOrigins({ ...config, emulatorUrl: 'http://localhost:9099' }),
    );
    expect(emulated['connect-src']).toEqual([
      "'self'",
      'http://localhost:9099',
    ]);
    expect(emulated['frame-src']).toEqual(["'self'", 'http://localhost:9099']);

    const real = directives(firebaseOrigins(config));
    expect(real['connect-src']).toEqual([
      "'self'",
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com',
    ]);
    expect(real['frame-src']).toEqual([
      "'self'",
      'https://acme.firebaseapp.com',
    ]);

    // Not configured: nothing beyond this origin.
    expect(directives(firebaseOrigins(null))['frame-src']).toEqual(["'self'"]);
  });

  it('lets a photo be uploaded to storage and shown from it', () => {
    const directives = Object.fromEntries(
      contentSecurityPolicy('abc', false, undefined, 'http://localhost:9199')
        .split('; ')
        .map((directive) => {
          const [name, ...values] = directive.split(' ');
          return [name, values];
        }),
    );
    expect(directives['connect-src']).toContain('http://localhost:9199');
    expect(directives['img-src']).toContain('http://localhost:9199');
    expect(storageOrigin({})).toBe('https://storage.googleapis.com');
  });

  it("adds eval and the dev server's socket in development only", () => {
    expect(policy(true)['script-src']).toContain("'unsafe-eval'");
    expect(policy(true)['connect-src']).toContain('ws:');
    expect(policy(false)['script-src']).not.toContain("'unsafe-eval'");
  });
});
