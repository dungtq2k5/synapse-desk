/**
 * Finds the constraints the Java gateway's sources declare on a value, beyond its JSON
 * type: the six constraint annotations of `com.synapsedesk.gateway.common.validation`, and a
 * value whose Java type is a date (`OffsetDateTime`), which only a valid date-time
 * string satisfies.
 *
 * **Read from the source, not the document.** A scan from the document outward finds
 * only what the document already says; this one finds what the code enforces, so a
 * constraint added to a DTO is found whether or not it was published.
 *
 * Three shapes, all this codebase's own:
 *
 * - on a DTO getter, named by the `@JsonProperty("x")` in the same annotation block;
 * - inline on a handler parameter, named by its `@RequestParam(value = "x")`;
 * - inline on a record component, named by the component.
 *
 * `ponytail:` a reader of this codebase's Java, not a parser: comments are blanked first
 * (a docblock that mentions `@StrictIso8601` is not a use of it), and an annotation's
 * own arguments are skipped string-aware (a `@Matches` regex holds parentheses).
 * `java-constraint-scan.contract-spec.ts` holds it to a hostile fixture and a floor.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const CONSTRAINTS = [
  'StrongPassword',
  'ValidPhoneNumber',
  'NumberString',
  'FutureDate',
  'StrictIso8601',
  'Matches',
] as const;

/** A constraint annotation's name, or `OffsetDateTime` for a value typed as a date. */
export type Kind = (typeof CONSTRAINTS)[number] | 'OffsetDateTime';

export type Constraint = {
  /** The declaring class or record. */
  className: string;
  /** The JSON property, or the query parameter's name. */
  property: string;
  kind: Kind;
  /** A request parameter is not part of any body. */
  on: 'property' | 'parameter';
};

/** `source` with every comment replaced by spaces, so offsets and lines are kept. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, (comment) =>
    comment.replace(/[^\n]/gu, ' '),
  );
}

/** The index just past the `)` closing the `(` at `open`, skipping string literals. */
function pastArguments(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      index++;
      while (index < source.length && source[index] !== '"') {
        if (source[index] === '\\') index++;
        index++;
      }
    } else if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) return index + 1;
    }
  }

  return source.length;
}

/** The member an annotation at `from` applies to, as far as its declaration's end. */
function memberAfter(source: string, from: number): string {
  let index = from;
  // Past this annotation and every annotation after it, arguments included.
  for (;;) {
    const rest = /^\s*@\w+(?:\.\w+)*/u.exec(source.slice(index));
    if (!rest) break;
    index += rest[0].length;
    const open = /^\s*\(/u.exec(source.slice(index));
    if (open) index = pastArguments(source, index + open[0].length - 1);
  }
  const end = source.slice(index).search(/[;{,)=]/u);

  return source.slice(from, end < 0 ? source.length : index + end);
}

/** Every constraint declared in one Java source file. */
export function scanJava(text: string): Constraint[] {
  const source = withoutComments(text);
  const found: Constraint[] = [];
  const classAt = (index: number): string =>
    [
      ...source.slice(0, index).matchAll(/\b(?:class|record)\s+(\w+)/gu),
    ].pop()?.[1] ?? '?';

  const annotation = new RegExp(
    String.raw`@(${CONSTRAINTS.join('|')})\b`,
    'gu',
  );
  for (const match of source.matchAll(annotation)) {
    const member = memberAfter(source, match.index);
    const parameter = /@RequestParam\(\s*value\s*=\s*"([^"]+)"/u.exec(member);
    const property =
      /@JsonProperty\("([^"]+)"\)/u.exec(member)?.[1] ??
      parameter?.[1] ??
      /(\w+)\s*$/u.exec(member)?.[1];
    if (!property) continue;

    found.push({
      className: classAt(match.index),
      property,
      kind: match[1] as Kind,
      on: parameter ? 'parameter' : 'property',
    });
  }

  // A DTO getter whose type is a date: Jackson reads it from a date-time string only.
  const dateGetter =
    /@JsonProperty\("([^"]+)"\)\s*public\s+(?:@\w+\s+)?OffsetDateTime\s+get\w+\s*\(/gu;
  for (const match of source.matchAll(dateGetter)) {
    found.push({
      className: classAt(match.index),
      property: match[1],
      kind: 'OffsetDateTime',
      on: 'property',
    });
  }

  return found;
}

/** Every constraint under a source root, read once. */
export function scanJavaDirectory(root: string): Constraint[] {
  const found: Constraint[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.java')) {
        found.push(...scanJava(readFileSync(path, 'utf8')));
      }
    }
  };
  walk(root);

  return found;
}
