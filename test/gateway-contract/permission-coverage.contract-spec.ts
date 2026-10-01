/**
 * @file **The permission-parity guard**: every generated operation Node gates
 * with `@RequirePermission` must be gated the same way in Java, for every
 * operation whose owning `*Api` tag Java has actually implemented.
 *
 * Node fails OPEN on a missing `@RequirePermission` — correct for a
 * caller-scoped route, wrong for one that forgot the annotation. Comparing
 * against a hand-kept list would just relocate that same risk into this
 * file, so this reads the two real sources of truth instead: Node's
 * decorators (`@RequirePermission` and its own `PERMISSION_KEY`), and the
 * PUBLISHED contract's `operationId`, which is the exact string Java's
 * generated method names are derived from (`AuthController_login_v1` ->
 * `authControllerLoginV1` — openapi-generator's own transform, not this
 * file's).
 *
 * `ponytail:` this is a targeted regex reader, not a TypeScript parser. It
 * assumes this codebase's own decorator style (one decorator per line,
 * string-literal codes) and Java's own style (`@RequirePermission` on its
 * own line directly above `@Override`, or directly above the method). A
 * decorator built from a variable, or split across lines, reads as "no
 * permission" here and would need a real AST if that ever shows up.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { matchingBracketIndex } from './brackets';
import { REPO_ROOT } from './gateway';
import { apiNameFor, pendingApis } from './pending';

type Operation = {
  operationId: string;
  tag: string;
  controllerClass: string;
  methodName: string;
};

/** Every operation the published contract declares, straight off `paths`. */
function operations(): Operation[] {
  const document = JSON.parse(
    readFileSync(join(REPO_ROOT, 'docs/reference/openapi.json'), 'utf8'),
  ) as {
    paths: Record<
      string,
      Record<string, { operationId?: string; tags?: string[] }>
    >;
  };

  const found: Operation[] = [];
  for (const methods of Object.values(document.paths)) {
    for (const op of Object.values(methods)) {
      if (!op.operationId || !op.tags?.length) continue;

      // `{Controller}_{method}_v1` — Nest's raw operationId, before
      // openapi-generator lower-cases and joins it into a Java method name.
      const match = /^(\w+Controller)_(\w+)_v\d+$/u.exec(op.operationId);
      if (!match) continue;

      found.push({
        operationId: op.operationId,
        tag: op.tags[0],
        controllerClass: match[1],
        methodName: match[2],
      });
    }
  }

  return found;
}

/** `AuthController_login_v1` -> `authControllerLoginV1` — openapi-generator's transform. */
function javaMethodName(op: Operation): string {
  const controller =
    op.controllerClass.charAt(0).toLowerCase() + op.controllerClass.slice(1);
  const method = op.methodName.charAt(0).toUpperCase() + op.methodName.slice(1);

  return `${controller}${method}V1`;
}

/** Every `*.controller.ts` source under the gateway, read once. */
function nodeControllerSources(): Map<string, string> {
  const sources = new Map<string, string>();
  const root = join(REPO_ROOT, 'apps/api-gateway/src/modules');

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.controller.ts'))
        sources.set(path, readFileSync(path, 'utf8'));
    }
  };
  walk(root);

  return sources;
}

const REQUIRE_PERMISSION = /@RequirePermission\(([^)]*)\)/u;
const STRING_LITERAL = /'([^']+)'/gu;

/** The codes a decorator's argument list names, in call order. */
function codesIn(decoratorArgs: string): string[] {
  return [...decoratorArgs.matchAll(STRING_LITERAL)].map((m) => m[1]);
}

/**
 * What Node requires for one controller method, or `null` for none.
 *
 * Method-level wins over class-level when both exist — `Reflector
 * .getAllAndOverride`'s own precedence, the reason `PermissionGuard` reads
 * it that way rather than merging the two.
 *
 * **Bounded by the PREVIOUS method's closing brace, not walked decorator by
 * decorator.** A walk that consumes one `@decorator\n` line at a time only
 * works when `@RequirePermission` is the LAST decorator directly above the
 * signature — true of every method tested until `UserAdminController`, whose
 * `@ResponseMessage(...)` comes AFTER it on six of its twelve routes. There
 * the walk stopped at `@ResponseMessage` and never saw `@RequirePermission`,
 * returned `null`, and the per-operation assertion below took `null` to mean
 * "Node is open here" and passed without checking anything — the same shape
 * of failure as the `apiNameFor` bug: latent because every existing caller's
 * shape happened not to trigger it. Slicing to the nearest preceding `\n  }\n`
 * is order- and decorator-count-independent: whatever sits between the last
 * method's end and this signature IS this method's own decorator block.
 */
function nodeRequiredCodes(
  source: string,
  className: string,
  methodName: string,
): string[] | null {
  const classMatch = new RegExp(
    String.raw`((?:@\w[^\n]*\n)*)export class ${className}\b`,
    'u',
  ).exec(source);
  const classDecorators = classMatch?.[1] ?? '';
  const classLevel = REQUIRE_PERMISSION.exec(classDecorators);

  const bodyStart = classMatch
    ? source.indexOf(classMatch[0]) + classMatch[0].length
    : -1;
  if (bodyStart < 0) return classLevel ? codesIn(classLevel[1]) : null;

  const rest = source.slice(bodyStart);
  // The signature at the START of a line (this codebase's 2-space method
  // indent), optionally `async` — never a same-named call elsewhere in the
  // class (`this.users.restore(...)` must not be mistaken for `restore(`).
  const signature = new RegExp(
    String.raw`\n(\s*)(?:async\s+)?${methodName}\s*\(`,
    'u',
  ).exec(rest);
  if (!signature) return classLevel ? codesIn(classLevel[1]) : null;

  const beforeSignature = rest.slice(0, signature.index);
  const previousMethodEnd = beforeSignature.lastIndexOf('\n  }\n');
  const decoratorBlock = beforeSignature.slice(previousMethodEnd + 1);
  const methodLevel = REQUIRE_PERMISSION.exec(decoratorBlock);

  if (methodLevel) return codesIn(methodLevel[1]);

  return classLevel ? codesIn(classLevel[1]) : null;
}

/**
 * A generated wrapper class kept every return type flat
 * (`ResponseEntity<FooV1200Response>`), which a single-level `[^>]*>` regex
 * matched fine. The OpenAPI-ownership flip's own envelope nests
 * (`ResponseEntity<ApiResponse<PagedData<T>>>`), and a flat pattern stops at
 * the FIRST `>` — reading no method there at all, silently, for every
 * migrated controller from here on. {@link matchingBracketIndex} is the
 * fix, shared with the same problem in `graphql-permission-coverage`'s
 * decorator parsing.
 */
function matchingAngleBracketEnd(source: string, start: number): number {
  return matchingBracketIndex(source, start, '<', '>');
}

/** What Java requires for one generated method, or `null` for none. */
function javaRequiredCodes(
  javaSources: string,
  methodName: string,
): string[] | null {
  const anchor = /ResponseEntity</gu;
  let decorators: string | null = null;

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

    // Bounded to the previous method's end, not the whole file up to here —
    // `nodeRequiredCodes`'s own reasoning: whatever sits between the last
    // `\n  }\n` and this signature IS this method's own decorator block, and
    // searching only that window (rather than every prefix of a large file)
    // keeps the match itself bounded too.
    const beforeType = javaSources.slice(0, found.index);
    const previousMethodEnd = beforeType.lastIndexOf('\n  }\n');
    const window = beforeType.slice(previousMethodEnd + 1);
    const decoratorMatch = /((?:@[^\n]*\n)*)\s*(?:public\s+)?$/u.exec(window);
    decorators = decoratorMatch?.[1] ?? '';
    break;
  }

  if (decorators === null) return null;

  const found = /@RequirePermission\(([^)]*)\)/u.exec(decorators);
  if (!found) return null;

  return [...found[1].matchAll(/PermissionCodesEnum\.(\w+)/gu)].map((m) =>
    m[1].toLowerCase().replace(/_/gu, '.'),
  );
}

describe('permission coverage — every gated Node operation stays gated in Java', () => {
  const pending = pendingApis();
  const nodeSources = nodeControllerSources();
  const javaRoot = join(REPO_ROOT, 'apps/api-gateway-java/src/main/java');
  const javaFiles = (() => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.java')) files.push(path);
      }
    };
    walk(javaRoot);

    return files;
  })();
  const javaSourcesConcatenated = javaFiles
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

  // `apiNameFor` now handles the published tag's spaces and casing
  // (`'Audit Logs'` -> `AuditLogsApi`) itself — this used to hand-roll that
  // normalization, which is exactly the kind of second copy that drifts.
  const implemented = operations().filter(
    (op) => !pending.has(apiNameFor(op.tag)),
  );

  it('found at least one implemented, permission-gated operation to check', () => {
    // A guard with nothing to guard is vacuous — `Feedback`'s
    // `analytics.read` route is the one this floor exists to keep exercised.
    const gated = implemented.filter((op) => {
      const source = [...nodeSources.values()].find((s) =>
        s.includes(`class ${op.controllerClass}`),
      );

      return (
        source &&
        nodeRequiredCodes(source, op.controllerClass, op.methodName) !== null
      );
    });

    expect(gated.length).toBeGreaterThanOrEqual(1);
  });

  for (const op of implemented) {
    const source = [...nodeSources.entries()].find(([, s]) =>
      s.includes(`class ${op.controllerClass}`),
    )?.[1];

    it(`${op.operationId} is gated the same in Java as in Node`, () => {
      if (!source) {
        throw new Error(
          `No controller source found declaring class ${op.controllerClass}`,
        );
      }

      const nodeCodes = nodeRequiredCodes(
        source,
        op.controllerClass,
        op.methodName,
      );
      const javaCodes = javaRequiredCodes(
        javaSourcesConcatenated,
        javaMethodName(op),
      );

      if (nodeCodes === null) {
        // Node itself is open here — nothing for Java to be missing.
        return;
      }

      expect(javaCodes).not.toBeNull();
      expect(new Set(javaCodes)).toEqual(new Set(nodeCodes));
    });
  }

  it('javaRequiredCodes finds the right decorator block past a lambda that closes at two-space indent', () => {
    // `javaRequiredCodes` bounds its decorator window at
    // `lastIndexOf('\n  }\n')` — the previous method's own closing brace,
    // at the class-body indent. A lambda argument whose OWN closing brace
    // lands alone on a two-space-indent line (a reformatter's choice, not
    // this codebase's convention, but not this scanner's to assume) is the
    // shape that could be mistaken for that boundary. This pins that a
    // lambda inside the PRECEDING method does not corrupt the window found
    // for the FOLLOWING one — `lastIndexOf` always resolves to whichever
    // `\n  }\n` sits CLOSEST to the target, and the true method boundary is
    // always closer than anything nested inside an earlier method.
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
}
`;

    expect(javaRequiredCodes(hostile, 'target')).toEqual(['real.code']);
  });
});
