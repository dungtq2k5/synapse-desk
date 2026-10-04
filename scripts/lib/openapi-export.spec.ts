import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  RUNTIME_OUTPUTS,
  firstDifferingLine,
  missingOutputs,
  openapiViolations,
} from './openapi-export.cjs';

/**
 * The OpenAPI export's decisions, without booting the gateway.
 *
 * The script itself does its work when it runs, so it is not imported here;
 * CI's `contract-java` job runs it for real as `npm run openapi:check`.
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

  describe('firstDifferingLine', () => {
    it.each([
      ['a\nb\n', 'a\nb\n', null],
      ['a\nb\n', 'a\nc\n', 2],
      ['a\n', 'a\nextra\n', 2],
    ])('%j vs %j → %s', (expected, actual, line) => {
      expect(firstDifferingLine(expected, actual)).toBe(line);
    });
  });
  describe('openapiViolations', () => {
    /** The smallest document the OAS 3.1 schema accepts. */
    const valid = () => ({
      openapi: '3.1.0',
      info: { title: 'probe', version: '1' },
      paths: {},
      components: { schemas: {} },
    });

    it('a valid document reports nothing', () => {
      expect(openapiViolations(valid())).toEqual([]);
    });

    it('**a BOOLEAN `required` is reported** — the shape that shipped as the contract', () => {
      // `required` is an array of property names. The swagger plugin wrote it
      // as a boolean inside an `items`, every guard stayed green, and the
      // defect surfaced only when a code generator refused the file.
      const document = valid();
      document.components.schemas = {
        Probe: {
          type: 'object',
          properties: { codes: { type: 'array', items: { required: false } } },
        },
      } as never;

      expect(openapiViolations(document).join('\n')).toContain(
        '/components/schemas/Probe/properties/codes/items',
      );
    });

    it('a document claiming 3.0 is reported: the gateway publishes 3.1, and the file is held to it', () => {
      const document = { ...valid(), openapi: '3.0.0' };

      expect(openapiViolations(document).join('\n')).toContain('/openapi');
    });

    it('**a Schema Object inside an operation is checked too**, not only the named components', () => {
      // The OAS schema reaches these through `$dynamicRef`, which the validator
      // cannot resolve; they are checked on their own, so they must be found.
      const document = valid() as Record<string, unknown>;
      document.paths = {
        '/probe': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: { 'application/json': { schema: { type: 'strin' } } },
              },
            },
          },
        },
      };

      expect(openapiViolations(document).join('\n')).toContain(
        '/paths/~1probe/get/responses/200/content/application~1json/schema/type',
      );
    });

    it('a missing `info` is reported — the validator checks the whole document, not one rule', () => {
      // The argument for a real validator over rules written from the bug
      // already had: it knows the classes nobody here has thought of.
      const document = valid() as Record<string, unknown>;
      delete document.info;

      expect(openapiViolations(document).length).toBeGreaterThan(0);
    });

    it('**the export script actually CALLS it, before the write and the comparison**', () => {
      // A structural row, and it has to be: with a valid document in the tree,
      // deleting the validation call changes nothing observable — `npm run
      // openapi:check` exits 0 either way. Measured, as a sabotage that
      // stayed green. So the guard is that the call EXISTS and runs first;
      // what it does when it fires is the rows above.
      const script = readFileSync(
        join(__dirname, '..', 'export-openapi.mjs'),
        'utf8',
      );

      const call = script.indexOf('openapiViolations(document)');
      expect(call).toBeGreaterThan(-1);
      // Before the branch, so one call covers both paths rather than the
      // write path only — the check path is the half that was missing.
      expect(call).toBeLessThan(script.indexOf('if (!CHECK)'));
      expect(script).toContain('process.exit(1)');
    });

    it('the findings are readable lines, not validator objects', () => {
      const document = valid() as Record<string, unknown>;
      delete document.paths;

      for (const violation of openapiViolations(document)) {
        expect(typeof violation).toBe('string');
        expect(violation).toMatch(/^\/.*: .+/u);
      }
    });
  });
});
