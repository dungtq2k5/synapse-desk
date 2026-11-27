import { parseEnvFile } from '@synapsedesk/testing/env-file';
import { readRepoFiles, repoFiles } from '@synapsedesk/testing/repo-files';
import { stripComments } from '@synapsedesk/testing/strip-comments';

/**
 * Every variable a service requires is set in its demo env example
 * (`deploy/demo/env/<service>.env.example`), so the demo stack boots.
 *
 * The scan runs from each service's schema toward the demo file. A required
 * variable is one the service refuses to start without:
 *
 * - a Joi schema (`env.validation.ts`): a key whose own rule says `.required()`.
 *   One required only under a condition (`.when(…, { then: Joi.required() })`)
 *   depends on a choice the demo file makes, so it isn't counted;
 * - the Java gateway's `application.yaml`: a `${VAR}` placeholder with no
 *   `:default`;
 * - rag-service's `config.py`: an `os.environ["VAR"]` read, never `.get(...)`.
 *
 * A key with a default is optional and may stay out of the demo file. The
 * demo file must SET a required key: a commented line doesn't count.
 *
 * @example a new `.required()` key in ticket-service's schema fails here until
 *   `deploy/demo/env/ticket-service.env.example` sets it.
 */
describe('the demo env examples', () => {
  /** Required by a schema, yet never needed by the demo's running services: each with why. */
  const DEV_ONLY: Readonly<Record<string, string>> = {
    SHADOW_DATABASE_URL:
      'read by `prisma.config.ts` for `migrate dev` and the drift check, never by a running service',
  };

  /** Demo env files that belong to no service schema: each with why. */
  const NO_SCHEMA: Readonly<Record<string, string>> = {
    web: 'the renderer reads its few variables directly, with no env schema',
    tools: 'not a service: the seeds, run by hand on the demo network',
  };

  /** service -> the keys it requires, read from its schema as text. */
  const required = (): Map<string, Set<string>> => {
    const byService = new Map<string, Set<string>>();

    for (const { path, text } of readRepoFiles(
      'services/*/src/**/env.validation.ts',
    )) {
      // Each key's rule runs to the next top-level key.
      const parts = stripComments(text).split(/^ {2}([A-Z][A-Z0-9_]*):/m);
      const keys = new Set<string>();
      for (let i = 1; i < parts.length; i += 2) {
        if (/(?<!Joi)\.required\(\)/.test(parts[i + 1])) keys.add(parts[i]);
      }
      byService.set(path.split('/')[1], keys);
    }

    for (const { path, text } of readRepoFiles(
      'services/*/src/main/resources/application.yaml',
    )) {
      const yaml = text.replace(/(^|\s)#.*$/gm, '$1');
      byService.set(
        path.split('/')[1],
        new Set(
          [...yaml.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)].map(([, key]) => key),
        ),
      );
    }

    for (const { path, text } of readRepoFiles(
      'services/rag-service/rag_service/config.py',
    )) {
      byService.set(
        path.split('/')[1],
        new Set(
          [...text.matchAll(/os\.environ\["([A-Z][A-Z0-9_]*)"\]/g)].map(
            ([, key]) => key,
          ),
        ),
      );
    }

    return byService;
  };

  /** service -> the keys its demo example sets. */
  const demo = (): Map<string, Set<string>> =>
    new Map(
      readRepoFiles('deploy/demo/env/*.env.example').map(({ path, text }) => [
        path.split('/').pop()!.replace('.env.example', ''),
        new Set(Object.keys(parseEnvFile(text))),
      ]),
    );

  it('covers every demo env file: a service schema, or a named exemption', () => {
    const schemas = required();
    const files = [...demo().keys()];

    // The corpus floor: seven services and the two named exemptions.
    expect(files.length).toBeGreaterThanOrEqual(9);
    expect(
      files.filter((name) => !schemas.has(name) && !(name in NO_SCHEMA)),
    ).toEqual([]);
    // Every service with a schema has a demo file.
    expect(
      [...schemas.keys()].filter((service) => !files.includes(service)),
    ).toEqual([]);
    for (const service of schemas.keys()) {
      expect(repoFiles(`deploy/demo/env/${service}.env.example`)).toHaveLength(
        1,
      );
    }
  });

  it('reads enough required keys from each schema to mean something', () => {
    // A formatting change that broke a pattern would empty a set and make the
    // row below vacuously green. The smallest (rag-service) requires 4.
    const thin = [...required()].filter(([, keys]) => keys.size < 4);
    expect(thin.map(([service]) => service)).toEqual([]);
    expect(required().size).toBeGreaterThanOrEqual(7);
  });

  it('**every key a service requires is set in its demo env example**', () => {
    const files = demo();
    const missing = [...required()].flatMap(([service, keys]) =>
      [...keys]
        .filter((key) => !(key in DEV_ONLY) && !files.get(service)?.has(key))
        .map((key) => `${service}: ${key}`),
    );

    expect(missing).toEqual([]);
  });
});
