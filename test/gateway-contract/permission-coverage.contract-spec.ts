/**
 * @file **The permission registry for REST**: every operation the published document
 * declares is gated in the Java gateway exactly as `test/fixtures/permissions/rest-routes.json`
 * says, and that table names exactly the operations the document declares.
 *
 * **A registry, checked from both sides.** The table maps each `METHOD path` to the
 * permission codes it requires, and `[]` to a route that is deliberately open (a public
 * route, or a caller-scoped one such as `GET /users/me`). A route added to the gateway
 * is published, so it is missing from the table until someone writes down what it
 * requires; a route removed leaves an entry that names nothing. Both fail.
 *
 * **Frozen from the Node gateway.** The table was generated once from the Node gateway's
 * `@RequirePermission` decorators, its last word on the question, when the Java gateway
 * matched it on every operation (230; 124 gated). Reading Java's own annotations back
 * against a scan of Java would agree with itself forever; this table is what the code
 * must match, and changing a route's permission is an edit to it.
 *
 * **An open route is checked too.** `[]` requires the Java handler to carry NO
 * `@RequirePermission`, and the handler must be found: a renamed method is a failure,
 * never "open".
 *
 * `ponytail:` a targeted regex reader of Java, not a parser. It assumes this codebase's
 * style: `@RequirePermission(PermissionCodesEnum.X, ...)` on its own line in the
 * annotation block directly above the handler. An annotation split across lines would
 * need a real parser if that ever shows up.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { matchingBracketIndex } from './brackets';
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

/**
 * The Java handler's name: the `operationId`'s parts joined in camel case.
 *
 * @example javaMethodName('AuthController_login_v1') // 'authControllerLoginV1'
 */
function javaMethodName(operationId: string): string {
  return operationId
    .split('_')
    .map((part, index) =>
      index === 0
        ? part.charAt(0).toLowerCase() + part.slice(1)
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join('');
}

/**
 * The `>` closing the `<` at `start`. Return types nest
 * (`ResponseEntity<ApiResponse<PagedData<T>>>`), and a flat `[^>]*>` pattern stops at
 * the first `>`, reading no method there at all, silently.
 */
function matchingAngleBracketEnd(source: string, start: number): number {
  return matchingBracketIndex(source, start, '<', '>');
}

/**
 * The codes a Java handler's `@RequirePermission` names: `[]` when the handler carries
 * none, and `undefined` when no handler of that name exists at all, which is never read
 * as open.
 */
function javaRequiredCodes(
  javaSources: string,
  methodName: string,
): string[] | undefined {
  const anchor = /ResponseEntity</gu;
  let decorators: string | undefined;

  for (
    let found = anchor.exec(javaSources);
    found;
    found = anchor.exec(javaSources)
  ) {
    const openIndex = found.index + 'ResponseEntity'.length;
    const closeIndex = matchingAngleBracketEnd(javaSources, openIndex);
    if (closeIndex < 0) continue;

    const afterType = javaSources.slice(closeIndex + 1);
    const signature = new RegExp(String.raw`^\s*${methodName}\s*\(`, 'u').exec(
      afterType,
    );
    if (!signature) continue;

    // Bounded to the previous method's end: whatever sits between the last
    // `\n  }\n` and this signature IS this method's own annotation block, and
    // searching only that window keeps the match bounded too.
    const beforeType = javaSources.slice(0, found.index);
    const previousMethodEnd = beforeType.lastIndexOf('\n  }\n');
    const window = beforeType.slice(previousMethodEnd + 1);
    const decoratorMatch = /((?:@[^\n]*\n)*)\s*(?:public\s+)?$/u.exec(window);
    decorators = decoratorMatch?.[1] ?? '';
    break;
  }

  if (decorators === undefined) return undefined;

  const found = /@RequirePermission\(([^)]*)\)/u.exec(decorators);
  if (!found) return [];

  return [...found[1].matchAll(/PermissionCodesEnum\.(\w+)/gu)].map((m) =>
    m[1].toLowerCase().replace(/_/gu, '.'),
  );
}

const javaSources = (() => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.java')) files.push(path);
    }
  };
  walk(join(REPO_ROOT, 'apps/api-gateway-java/src/main/java'));

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

  it('gates at least the 124 operations it was frozen with', () => {
    // A table emptied of codes would pass every row below as "open".
    expect(
      Object.values(TABLE).filter((codes) => codes.length > 0).length,
    ).toBeGreaterThanOrEqual(124);
  });

  for (const [key, codes] of Object.entries(TABLE)) {
    it(`${key} requires ${codes.length ? codes.join(', ') : 'no permission'} in Java`, () => {
      const operationId = documented.get(key);
      expect(operationId).toBeDefined();

      const java = javaRequiredCodes(javaSources, javaMethodName(operationId!));

      expect(java).toBeDefined();
      expect(new Set(java)).toEqual(new Set(codes));
    });
  }

  it('javaRequiredCodes finds the right decorator block past a lambda that closes at two-space indent', () => {
    // The window is bounded at `lastIndexOf('\n  }\n')`, the previous method's
    // closing brace. A lambda in the PRECEDING method whose own closing brace
    // lands alone at that indent must not corrupt the window found for the
    // FOLLOWING one: the true boundary is always the closer of the two.
    const hostile = `
class Foo {

  @RequirePermission(PermissionCodesEnum.TRAP_CODE)
  public ResponseEntity<Void> other() {
    someList.forEach(x ->
  {
      x.process();
  }
    );
  }

  @RequirePermission(PermissionCodesEnum.REAL_CODE)
  public ResponseEntity<ApiResponse<Bar>> target() {
    return null;
  }

  public ResponseEntity<Void> open() {
    return null;
  }
}
`;

    expect(javaRequiredCodes(hostile, 'target')).toEqual(['real.code']);
    expect(javaRequiredCodes(hostile, 'open')).toEqual([]);
    expect(javaRequiredCodes(hostile, 'renamed')).toBeUndefined();
  });
});
