import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * `database-url.mjs` is ES modules, which ts-jest can't load, so each check
 * runs the real module in Node and reads its answer.
 */
const check = (
  name: 'isLocalDatabase' | 'isSeedableDatabase',
  url: string,
  env: Record<string, string> = {},
): boolean => {
  const module = join(__dirname, 'database-url.mjs');
  const out = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import * as m from ${JSON.stringify(module)}; console.log(m.${name}(process.argv[1]))`,
      url,
    ],
    { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' },
  );
  return out.trim() === 'true';
};

const DEMO = 'postgresql://synapse:secret@postgres-auth:5432/synapsedesk_auth';

describe('the seeders’ database guard', () => {
  it('refuses a Compose host without SEED_DATABASE_HOSTS', () => {
    expect(check('isSeedableDatabase', DEMO)).toBe(false);
  });

  it('allows a host SEED_DATABASE_HOSTS names, and no other', () => {
    const env = { SEED_DATABASE_HOSTS: 'postgres-auth, postgres-ticket' };
    expect(check('isSeedableDatabase', DEMO, env)).toBe(true);
    expect(
      check(
        'isSeedableDatabase',
        'postgresql://synapse:secret@db.example.com:5432/auth',
        env,
      ),
    ).toBe(false);
  });

  it('keeps a local database allowed, and db:reset’s check unchanged', () => {
    expect(
      check('isSeedableDatabase', 'postgresql://u:p@localhost:5432/auth'),
    ).toBe(true);
    expect(
      check('isLocalDatabase', DEMO, { SEED_DATABASE_HOSTS: 'postgres-auth' }),
    ).toBe(false);
  });
});
