import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  RUNTIME_OUTPUTS,
  assignEnvFile,
  firstDifferingLine,
  missingOutputs,
} from './openapi-export.cjs';

/**
 * The OpenAPI export's decisions, without booting the gateway.
 *
 * The script itself does its work when it runs, so it is not imported here;
 * CI's `build` job runs it for real as `npm run openapi:check`.
 */
describe('the OpenAPI export — the pure half', () => {
  describe('missingOutputs', () => {
    let root: string;

    const touch = (relative: string) => {
      const path = join(root, relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '');
    };

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'openapi-export-'));
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('**names the gateway AND both libraries** — the export requires all three at runtime', () => {
      // The built gateway resolves `@synapsedesk/common` and `grpc-proto` to
      // each library's own `dist/`; a gateway-only build is not enough.
      expect(RUNTIME_OUTPUTS).toEqual([
        'apps/api-gateway/dist/apps/api-gateway/src/main.js',
        'libs/common/dist/main.js',
        'libs/grpc-proto/dist/index.js',
      ]);
      expect(missingOutputs(root)).toEqual(RUNTIME_OUTPUTS);
    });

    it.each(RUNTIME_OUTPUTS.map((output) => [output]))(
      'each output is checked on its own: only %s missing is reported',
      (absent: string) => {
        for (const output of RUNTIME_OUTPUTS) {
          if (output !== absent) touch(output);
        }

        expect(missingOutputs(root)).toEqual([absent]);
      },
    );

    it('nothing missing → nothing reported', () => {
      RUNTIME_OUTPUTS.forEach(touch);

      expect(missingOutputs(root)).toEqual([]);
    });
  });

  describe('assignEnvFile', () => {
    it('**the file wins over a variable already in the environment**', () => {
      // `process.loadEnvFile` would leave this alone, and a cookie name
      // exported in a shell would reach the published document.
      const env: Record<string, string | undefined> = {
        JWT_ACCESS_NAME: 'leak',
        UNRELATED: 'kept',
      };

      const assigned = assignEnvFile(
        'JWT_ACCESS_NAME = access_token\nAPP_VERSION = 0.0.0-local\n',
        env,
      );

      // `util.parseEnv` does not keep the file's key order.
      expect([...assigned].sort()).toEqual(['APP_VERSION', 'JWT_ACCESS_NAME']);
      expect(env).toEqual({
        JWT_ACCESS_NAME: 'access_token',
        APP_VERSION: '0.0.0-local',
        UNRELATED: 'kept',
      });
    });
  });

  describe('firstDifferingLine', () => {
    it.each([
      ['a\nb\n', 'a\nb\n', null],
      ['a\nb\n', 'a\nc\n', 2],
      ['a\n', 'a\nextra\n', 2],
    ])('%j vs %j → %s', (expected, actual, line) => {
      expect(firstDifferingLine(expected, actual)).toBe(line);
    });
  });
});
