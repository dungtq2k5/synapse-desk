/**
 * @file **The permission registry for REST**: every operation the published document
 * declares is gated in the gateway exactly as `test/fixtures/permissions/rest-routes.json`
 * says, and that table names exactly the operations the document declares.
 *
 * **A registry, checked from both sides.** The table maps each `METHOD path` to the
 * permission codes it requires, and `[]` to a route that is deliberately open (a public
 * route, or a caller-scoped one such as `GET /users/me`). A route added to the gateway
 * is published, so it is missing from the table until someone writes down what it
 * requires; a route removed leaves an entry that names nothing. Both fail.
 *
 * **The table is what the code must match.** The gateway fails OPEN on a missing
 * `@RequirePermission`: correct for a caller-scoped route, wrong for one that forgot the
 * decorator. Reading the decorators back against themselves would agree forever, so
 * changing a route's permission is an edit to this table.
 *
 * **An open route is checked too.** `[]` requires the handler to carry NO
 * `@RequirePermission` (on the method or its class), and the handler must be found: a
 * renamed method is a failure, never "open".
 *
 * `ponytail:` a targeted regex reader, not a TypeScript parser. It assumes this
 * codebase's decorator style: one decorator per line, string-literal codes. A decorator
 * built from a variable, or split across lines, would need a real AST if that ever
 * shows up.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './gateway';

const read = <T>(path: string): T =>
  JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8')) as T;

const TABLE = read<Record<string, string[]>>(
  'test/fixtures/permissions/rest-routes.json',
);

/** `METHOD path` to `operationId`, for every operation the published document declares. */
function documentedOperations(): Map<string, string> {
  const document = read<{
    paths: Record<string, Record<string, { operationId: string }>>;
  }>('docs/reference/openapi.json');
  const found = new Map<string, string>();
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      found.set(`${method.toUpperCase()} ${path}`, operation.operationId);
    }
  }

  return found;
}

/** `AuthController_login_v1` (or an unversioned `HealthController_liveness`) → the class and the method it names. */
function handlerOf(operationId: string): { className: string; method: string } {
  const match = /^(\w+Controller)_([A-Za-z0-9]+)(?:_v\d+)?$/u.exec(operationId);
  if (!match) throw new Error(`Unexpected operationId shape: ${operationId}`);

  return { className: match[1], method: match[2] };
}

const REQUIRE_PERMISSION = /@RequirePermission\(([^)]*)\)/u;

/** The string-literal codes a decorator's argument list names. */
const codesIn = (decoratorArgs: string): string[] =>
  [...decoratorArgs.matchAll(/'([^']+)'/gu)].map((match) => match[1]);

/**
 * The codes one controller method requires: `[]` when neither it nor its class carries
 * `@RequirePermission`, and `undefined` when the class or the method is not found at
 * all, which is never read as open.
 *
 * Method-level wins over class-level when both exist — `Reflector.getAllAndOverride`'s
 * own precedence, the reason `PermissionGuard` reads it that way rather than merging the
 * two.
 *
 * **Bounded by the PREVIOUS method's closing brace, not walked decorator by
 * decorator.** `@RequirePermission` is not always the last decorator above the
 * signature (`UserAdminController` puts `@ResponseMessage(...)` after it), so a walk
 * that stops at the first other decorator would miss it and read the route as open.
 * Whatever sits between the last `\n  }\n` and this signature IS this method's own
 * decorator block.
 */
export function requiredCodes(
  source: string,
  className: string,
  method: string,
): string[] | undefined {
  const classMatch = new RegExp(
    String.raw`((?:@\w[^\n]*\n)*)export class ${className}\b`,
    'u',
  ).exec(source);
  if (!classMatch) return undefined;
  const classLevel = REQUIRE_PERMISSION.exec(classMatch[1]);

  const rest = source.slice(classMatch.index + classMatch[0].length);
  // The signature at the START of a line (this codebase's 2-space method indent),
  // optionally `async` — never a same-named call elsewhere in the class
  // (`this.users.restore(...)` must not be mistaken for `restore(`).
  const signature = new RegExp(
    String.raw`\n\s*(?:async\s+)?${method}\s*\(`,
    'u',
  ).exec(rest);
  if (!signature) return undefined;

  const beforeSignature = rest.slice(0, signature.index);
  const decoratorBlock = beforeSignature.slice(
    beforeSignature.lastIndexOf('\n  }\n') + 1,
  );
  const methodLevel = REQUIRE_PERMISSION.exec(decoratorBlock);
  if (methodLevel) return codesIn(methodLevel[1]);

  return classLevel ? codesIn(classLevel[1]) : [];
}

/** Every controller source under the gateway, joined: a class is found by its name. */
const controllerSources = (() => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.controller.ts')) files.push(path);
    }
  };
  walk(join(REPO_ROOT, 'services/api-gateway/src/modules'));

  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
})();

describe('permission coverage — every documented operation is gated as the table says', () => {
  const documented = documentedOperations();

  it('the table names exactly the documented operations, no more and no fewer', () => {
    expect({
      missingFromTheTable: [...documented.keys()].filter(
        (key) => !(key in TABLE),
      ),
      namingNothing: Object.keys(TABLE).filter((key) => !documented.has(key)),
    }).toEqual({ missingFromTheTable: [], namingNothing: [] });
  });

  it('gates at least the 123 operations it was frozen with', () => {
    // A table emptied of codes would pass every row below as "open".
    // 123, not 124: `DELETE /attachments/{id}` is decided by ticket-service
    // (a file's sender may remove it while they may still edit), so the
    // gateway no longer requires `ticket.message.moderate` there.
    expect(
      Object.values(TABLE).filter((codes) => codes.length > 0).length,
    ).toBeGreaterThanOrEqual(123);
  });

  for (const [key, codes] of Object.entries(TABLE)) {
    it(`${key} requires ${codes.length ? codes.join(', ') : 'no permission'}`, () => {
      const operationId = documented.get(key);
      expect(operationId).toBeDefined();

      const { className, method } = handlerOf(operationId!);
      const required = requiredCodes(controllerSources, className, method);

      expect(required).toBeDefined();
      expect(new Set(required)).toEqual(new Set(codes));
    });
  }

  it('requiredCodes reads past a later decorator, falls back to the class, and never reads a missing method as open', () => {
    const hostile = `
@RequirePermission('class.code')
export class FooController {
  @Get()
  @RequirePermission('trap.code')
  other() {
    return this.restore();
  }

  @Get()
  @RequirePermission('real.code')
  @ResponseMessage('Done')
  async target() {
    return null;
  }

  @Get()
  inherited() {
    return null;
  }
}

export class OpenController {
  @Get()
  open() {
    return null;
  }
}
`;

    expect(requiredCodes(hostile, 'FooController', 'target')).toEqual([
      'real.code',
    ]);
    expect(requiredCodes(hostile, 'FooController', 'inherited')).toEqual([
      'class.code',
    ]);
    expect(requiredCodes(hostile, 'OpenController', 'open')).toEqual([]);
    expect(requiredCodes(hostile, 'FooController', 'renamed')).toBeUndefined();
    expect(requiredCodes(hostile, 'GoneController', 'open')).toBeUndefined();
  });
});
