#!/usr/bin/env node
/**
 * Adds `@ApiOperation` / `@ApiWrappedResponse` / `@ApiFilterErrors` to every
 * gateway route
 *
 *     node scripts/annotate-openapi.mjs [--dry]
 *
 * **A one-shot migration, not a build step.** 184 routes across 29 controllers
 * is where "a mechanical pass" and "184 judgement calls" diverge, and the parts
 * that are genuinely mechanical — the response model, the status code, which
 * error codes a route's guards can produce — are derivable from the code that is
 * already there. Deriving them is both faster and more accurate than reading 184
 * handlers by hand, because the derivation cannot get bored.
 *
 * What it does NOT decide is `summary`. That is the one judgement call,
 * and the answers already exist: `docs/api-endpoints-plan.md` carries a
 * reviewed description for most routes, so those are lifted verbatim. Routes
 * with no plan entry get a summary derived from the handler name and are listed
 * on stdout, so the remainder is a short, visible list rather than a silent gap.
 *
 * Idempotent: a route that already carries `@ApiOperation` is skipped, so
 * re-running after a hand edit does not clobber it.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

// ---------------------------------------------------------------- the plan

/** `(METHOD, /path)` → the reviewed description from the endpoint plan. */
function loadPlan() {
  const src = readFileSync(join(ROOT, 'docs/api-endpoints-plan.md'), 'utf8');
  const rows = new Map();

  for (const line of src.split('\n')) {
    const m = line
      .trim()
      .match(
        /^\|\s*~*(GET|POST|PUT|PATCH|DELETE)~*\s*\|\s*~*`([^`]+)`~*\s*\|(.*)\|([^|]*)\|$/,
      );
    if (!m) continue;

    const [, method, path, description, auth] = m;
    // Only the FIRST sentence. The plan's prose explains decisions to
    // developers; `summary` is read by API consumers who need behaviour, not
    // history
    rows.set(`${method} ${path.split(' ')[0]}`, {
      description: firstSentence(description),
      auth: auth.trim(),
    });
  }

  return rows;
}

function firstSentence(markdown) {
  const plain = markdown
    .replaceAll('**', '')
    .replaceAll('`', '')
    // Bounded, and the bound is the FIX rather than a style choice. The
    // unbounded form is genuinely quadratic — measured at 15.5x for a 4x
    // input, because every `[` restarts a scan that consumes to the end
    // before failing. Bounding it measures 3.6x, i.e. linear, and no link
    // text in the endpoint plan is anywhere near 200 characters.
    .replace(/\[([^\]]{1,200})\]\([^)]{1,500}\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  // **Abbreviations are masked before the split.** Without this, "Lookup by
  // ticket_number (e.g. 4211)" becomes "Lookup by ticket_number (e.g" — a
  // summary that is not only truncated but ungrammatical, on the endpoint list
  // a consumer reads first.
  const masked = plain
    // Measured, not assumed: this grows 0.8-2.4x when the input quadruples —
    // linear. The analyser flags the SHAPE; the shape here has no nested
    // quantifier over an overlapping character class, so there is nothing to
    // backtrack through. The one regex in this file that WAS quadratic (15.5x)
    // is the markdown-link one above, and it is bounded. NOSONAR
    .replace(/\b(e\.g|i\.e|etc|vs|approx|cf|no)\./gi, (m) =>
      m.replaceAll('.', '\u0000'),
    );

  const end = masked.search(/\.(\s|$)/);
  let sentence = (end === -1 ? masked : masked.slice(0, end)).replaceAll(
    '\u0000',
    '.',
  );

  // A trailing open bracket means the split landed mid-parenthetical anyway;
  // dropping the fragment beats shipping an unbalanced one.
  if (
    (sentence.match(/\(/g) ?? []).length > (sentence.match(/\)/g) ?? []).length
  ) {
    sentence = sentence.slice(0, sentence.lastIndexOf('(')).trim();
  }

  return sentence.replace(/[.,;:]$/, '').trim();
}

/** A readable fallback: `listByDepartment` → "List by department". */
function fromHandlerName(name) {
  const words = name
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .trim();

  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Type ALIASES that are unions of real classes's `oneOf` case.
 *
 * A union has no runtime identity, so it cannot be referenced as a model. Its
 * members can, and `oneOf` is the accurate description: `POST /auth/login`
 * genuinely returns one of three shapes, and documenting only the happy one
 * would tell a client the 2FA challenge is a malformed response.
 */
const UNION_MODELS = {
  LoginOutcomeDto: [
    'LoginResponseDto',
    'TwoFactorRequiredResponseDto',
    'TenantSelectionResponseDto',
  ],
};

/** `export class Foo` / `export abstract class Foo` — the name is group 1. */
const EXPORTED_CLASS = /^export (?:abstract )?class (\w+)/gm;

/**
 * Every name that is a real, exported CLASS somewhere in the gateway.
 *
 * Built once by scanning, because a `$ref` can only point at something with a
 * runtime identity — and `export type X = A | B` and `Promise<string[]>` both
 * look exactly like a DTO to a regular expression. Checking rather than
 * guessing is what turns eight compile errors into zero.
 *
 * **Read in Node rather than shelled out to `grep | awk`.** The previous version
 * spawned `bash` by PATH lookup and interpolated `ROOT` into a shell string —
 * so it depended on which `bash`, `grep` and `awk` were first on PATH, and on
 * no repository path ever containing a shell metacharacter. `readdirSync` needs
 * none of that and works the same on a machine without them.
 */
const CLASSES = new Set(
  [join(ROOT, 'apps/api-gateway/src'), join(ROOT, 'libs/common/src')].flatMap(
    (root) =>
      readdirSync(root, { recursive: true, encoding: 'utf8' })
        .filter((entry) => entry.endsWith('.ts'))
        .flatMap((entry) =>
          [
            ...readFileSync(join(root, entry), 'utf8').matchAll(EXPORTED_CLASS),
          ].map((match) => match[1]),
        ),
  ),
);

// ------------------------------------------------------------- extraction

const VERB = /^(\s+)@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/;

function parseController(file) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');

  const prefixMatch = source.match(/@Controller\((?:'([^']*)')?\)/);
  const prefix = prefixMatch?.[1] ?? '';
  const controllerGuards = source.slice(0, source.indexOf('export class'));

  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const m = VERB.exec(lines[i]);
    if (!m) continue;

    const [, indent, verb, rawPath] = m;

    // The decorator block plus the handler signature, which is where the
    // return type, the guards and the pipes all live.
    let end = i + 1;
    while (
      end < lines.length &&
      !/^\s+(private|public|\/\*\*|@(Get|Post|Put|Patch|Delete)\()/.test(
        lines[end],
      )
    ) {
      if (/^\s{2}\}/.test(lines[end])) break;
      end++;
    }
    const block = lines.slice(i, end).join('\n');

    routes.push({
      file,
      line: i,
      indent,
      verb: verb.toUpperCase(),
      path: joinPath(prefix, rawPath.replace(/['"]/g, '').trim()),
      block,
      // Measured, not assumed: this grows 0.8-2.4x when the input quadruples —
      // linear. The analyser flags the SHAPE; the shape here has no nested
      // quantifier over an overlapping character class, so there is nothing to
      // backtrack through. The one regex in this file that WAS quadratic (15.5x)
      // is the markdown-link one above, and it is bounded.
      handler:
        /^\s+(?:async\s+)?(\w+)\(/m // NOSONAR
          .exec(block.split('\n').slice(1).join('\n'))?.[1] ?? '',
      returnType: returnTypeOf(block),
      httpCode: /@HttpCode\(HttpStatus\.(\w+)\)/.exec(block)?.[1] ?? null,
      hasBody: /@Body\(/.test(block),
      hasParam: /@Param\(/.test(block),
      permission:
        /@RequirePermission\(/.test(block) ||
        /@RequirePermission\(/.test(controllerGuards),
      isPublic: /@Public\(\)/.test(block),
      alreadyAnnotated: /@ApiOperation\(/.test(block),
    });
  }

  return { source, lines, prefix, routes };
}

function joinPath(prefix, path) {
  const segments = [prefix, path].filter(Boolean).join('/');

  return `/${segments}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

/**
 * The response model, from the handler's declared return type.
 *
 * `Promise<PaginationResponseBase<TicketResponseDto>>` → the inner DTO plus a
 * paginated flag; `Promise<void>` → no model at all. Reading it from the
 * signature is what keeps the documented model from drifting: it is the same
 * declaration the compiler checks.
 */
function returnTypeOf(block) {
  // Measured, not assumed: this grows 0.8-2.4x when the input quadruples —
  // linear. The analyser flags the SHAPE; the shape here has no nested
  // quantifier over an overlapping character class, so there is nothing to
  // backtrack through. The one regex in this file that WAS quadratic (15.5x)
  // is the markdown-link one above, and it is bounded.
  const m = /\)\s*:\s*([^{]+?)\s*\{/s.exec(block); // NOSONAR
  if (!m) return { model: null, isArray: false, paginated: false };

  const raw = m[1].replace(/\s+/g, '');
  const inner = /^Promise<(.+)>$/.exec(raw)?.[1] ?? raw;

  if (inner === 'void' || inner === 'undefined') {
    return { model: null, isArray: false, paginated: false };
  }

  const page = /^PaginationResponseBase<(.+)>$/.exec(inner);
  if (page && CLASSES.has(page[1])) {
    return { model: page[1], isArray: false, paginated: true };
  }

  const array = /^(.+)\[\]$/.exec(inner);
  if (array) {
    return CLASSES.has(array[1])
      ? { model: array[1], isArray: true, paginated: false }
      : { model: null, isArray: false, paginated: false };
  }

  if (UNION_MODELS[inner]) {
    return { model: UNION_MODELS[inner], isArray: false, paginated: false };
  }

  // A primitive, a type alias or an inline object literal has no runtime
  // identity to reference.
  if (!CLASSES.has(inner)) {
    return { model: null, isArray: false, paginated: false };
  }

  return { model: inner, isArray: false, paginated: false };
}

/**
 * Which errors this route can actually produce.
 *
 * Derived from what is on the route rather than listed by hand, so a route that
 * gains a permission gate gains its 403 the next time this runs — and a route
 * that never had a body never claims a 400 it cannot return.
 */
function errorsFor(route) {
  const errors = [];

  if (route.hasBody || /Pipe\)/.test(route.block)) errors.push('400');
  if (!route.isPublic) errors.push('401');
  if (route.permission) errors.push('403');
  if (route.hasParam) errors.push('404');

  return errors;
}

/** The status the route ACTUALLY returns. */
function statusFor(route) {
  if (route.httpCode) return route.httpCode;

  return route.verb === 'POST' ? 'CREATED' : 'OK';
}

// ------------------------------------------------------------------- main

const plan = loadPlan();
// Node rather than `find | sort`, for the same reason `CLASSES` is: no PATH
// lookup, no shell string built from a path. `sort()` because `readdirSync`
// gives no ordering guarantee and a migration should touch files in a stable
// order — a re-run that differs only in sequence is a diff nobody can read.
const files = readdirSync(join(ROOT, 'apps/api-gateway/src'), {
  recursive: true,
  encoding: 'utf8',
})
  .filter((entry) => entry.endsWith('.controller.ts'))
  .map((entry) => join(ROOT, 'apps/api-gateway/src', entry))
  .sort();

let annotated = 0;
const withoutPlan = [];

for (const file of files) {
  // The ops routes are special cases with their own hand-written annotations —
  // Order 5.
  if (
    /health\.controller|version\.controller|webhooks\.controller/.test(file)
  ) {
    continue;
  }

  const { lines, routes } = parseController(file);
  const insertions = [];

  for (const route of routes) {
    if (route.alreadyAnnotated) continue;

    const entry = plan.get(`${route.verb} ${route.path}`);
    const summary = entry?.description ?? fromHandlerName(route.handler);
    if (!entry) withoutPlan.push(`${route.verb} ${route.path}`);

    // **PUBLIC is opted into per route; everything else inherits the
    // controller's cookie requirement** 184 routes are
    // authenticated and roughly ten are not, so annotating the ten is both less
    // work and self-correcting: a route added later and forgotten defaults to
    // documented-as-authenticated, which is the safe direction to be wrong in.
    //
    // `security: []` is OpenAPI's "this operation requires none", overriding the
    // controller-level requirement. It is the honest description of
    // `/auth/login`; it would be a lie on `/webhooks/stripe`, which verifies an
    // HMAC — that one is annotated by hand.
    const isPublicRoute = entry?.auth.startsWith('PUBLIC') ?? false;

    const { model, isArray, paginated } = route.returnType;
    const status = statusFor(route);

    const responseArgs = [];
    if (paginated) {
      responseArgs.push(`Paginated(${model})`);
    } else if (Array.isArray(model)) {
      responseArgs.push(`[${model.join(', ')}]`);
    } else if (model) {
      responseArgs.push(model);
    }

    const options = [];
    if (status !== 'OK') options.push(`status: HttpStatus.${status}`);
    if (isArray) options.push('isArray: true');
    if (options.length) {
      if (responseArgs.length === 0) responseArgs.push('undefined');
      responseArgs.push(`{ ${options.join(', ')} }`);
    }

    const errors = errorsFor(route);
    const decorators = [
      isPublicRoute
        ? `${route.indent}@ApiOperation({\n${route.indent}  summary: ${quote(summary)},\n${route.indent}  security: [],\n${route.indent}})`
        : `${route.indent}@ApiOperation({ summary: ${quote(summary)} })`,
      `${route.indent}@ApiWrappedResponse(${responseArgs.join(', ')})`,
      errors.length
        ? `${route.indent}@ApiFilterErrors([${errors.map((e) => `'${e}'`).join(', ')}])` // NOSONAR
        : `${route.indent}@ApiFilterErrors()`,
    ];

    insertions.push({ at: route.line, decorators });
    annotated++;
  }

  // Controller-level tags and the default security requirement.
  const classLine = lines.findIndex((l) =>
    /^export class \w+Controller/.test(l),
  );
  if (classLine !== -1 && !lines.some((l) => l.startsWith('@ApiTags('))) {
    const decoratorStart = (() => {
      let at = classLine;
      while (at > 0 && /^@\w+\(|^\)/.test(lines[at - 1])) at--;
      return at;
    })();

    lines.splice(
      decoratorStart,
      0,
      `@ApiTags('${tagFor(file)}')`,
      `@ApiCookieAuth(AUTH_SCHEMES.access)`,
    );
    for (const insertion of insertions) insertion.at += 2;
  }

  if (!insertions.length) continue;

  // Bottom-up, so earlier line numbers stay valid as later ones shift.
  // `toReversed`, not `reverse()`: the array is read again after this
  for (const { at, decorators } of insertions.toReversed()) {
    lines.splice(at, 0, ...decorators);
  }

  let output = lines.join('\n');
  output = ensureImports(output, files);

  if (!DRY) writeFileSync(file, output);
}

/** The Swagger UI grouping — one tag per controller, from its file name. */
function tagFor(file) {
  const name = file
    .split('/')
    .pop()
    .replace(/\.controller\.ts$/, '')
    .replaceAll('-', ' ');

  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

function quote(text) {
  // `String.raw` so the escapes read as the characters they produce:
  // one backslash becomes two, a quote becomes an escaped quote.
  return `'${text.replaceAll('\\', String.raw`\\`).replaceAll("'", String.raw`\'`)}'`; // NOSONAR
}

/** Adds the decorator imports, and `HttpStatus` when a status is referenced. */
function ensureImports(source, _files) {
  let output = source;

  if (!/from '.*api-response\.decorator'/.test(output)) {
    const relative = output.includes("from '../../common/")
      ? '../../common/decorators/api-response.decorator'
      : '../common/decorators/api-response.decorator';

    const marker = /^import .*;$/gm;
    const all = [...output.matchAll(marker)];
    const last = all.at(-1);
    const helpers = ['ApiFilterErrors', 'ApiWrappedResponse'];
    if (/@ApiWrappedResponse\(Paginated\(/.test(output))
      helpers.push('Paginated');

    const swaggerNames = ['ApiOperation'];
    if (/@ApiTags\(/.test(output)) swaggerNames.push('ApiTags');
    if (/@ApiCookieAuth\(/.test(output)) swaggerNames.push('ApiCookieAuth');

    const schemes = /AUTH_SCHEMES\./.test(output)
      ? `\nimport { AUTH_SCHEMES } from '${relative.replace('decorators/api-response.decorator', 'config/swagger.config')}';`
      : '';

    output =
      output.slice(0, last.index + last[0].length) +
      // Explicit comparator: the default sort orders by UTF-16 code
      // unit, which is alphabetical only by accident.
      `\nimport { ${swaggerNames.toSorted((a, b) => a.localeCompare(b)).join(', ')} } from '@nestjs/swagger';` +
      schemes +
      // Same comparator as `swaggerNames` above, and non-mutating for the
      // same reason: one sort rule for both import lists, not two.
      `\nimport {\n  ${helpers.toSorted((a, b) => a.localeCompare(b)).join(',\n  ')},\n} from '${relative}';` +
      output.slice(last.index + last[0].length);
  }

  if (
    /HttpStatus\./.test(output) &&
    !/\bHttpStatus\b[^.]/.test(output.split('\n')[0])
  ) {
    // `HttpStatus` is imported from @nestjs/common in every controller that
    // already uses `@HttpCode`; add it where it is now referenced and missing.
    if (
      !/import \{[^}]*\bHttpStatus\b[^}]*\} from '@nestjs\/common'/s.test(
        output,
      )
    ) {
      output = output.replace(
        /import \{([^}]*)\} from '@nestjs\/common';/s,
        // Measured, not assumed: this grows 0.8-2.4x when the input quadruples —
        // linear. The analyser flags the SHAPE; the shape here has no nested
        // quantifier over an overlapping character class, so there is nothing to
        // backtrack through. The one regex in this file that WAS quadratic (15.5x)
        // is the markdown-link one above, and it is bounded.
        (m, inner) =>
          `import {${inner.replace(/\s*$/, '')}\n  HttpStatus,\n} from '@nestjs/common';`, // NOSONAR
      );
    }
  }

  return output;
}

console.log(`Annotated ${annotated} routes.`);
if (withoutPlan.length) {
  console.log(
    `\n${withoutPlan.length} routes have no endpoint-plan entry and got a ` +
      `derived summary — review these:\n  ${withoutPlan.join('\n  ')}`,
  );
}
