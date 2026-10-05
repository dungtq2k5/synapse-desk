/**
 * @file Which decorators sit on which properties of a TypeScript class, read from
 * source.
 *
 * Node's request validation lives in `class-validator` decorators, and the published
 * document expresses only some of them (a `format`, a bound). To find the ones it does
 * NOT express, the constraint has to be read from where it is written, which is the
 * DTO source, not the document that omits it.
 *
 * **A scan over source is a guard that can go quietly blind**, so this is not a regex
 * over lines. Comments are blanked and the CONTENT of string and regex literals is
 * blanked, so a comment that mentions `@IsStrongPassword`, a message containing `//`,
 * or a pattern containing a quote cannot be read as code; decorators are read with
 * balanced parentheses, so one spread over several lines, or with an arrow function
 * inside, is one decorator; and a decorator separated from its property by a comment
 * still belongs to it. `validator-scan.contract-spec.ts` holds each of those to a
 * hostile fixture, and holds the real sources to a floor.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type ScannedProperty = { name: string; decorators: string[] };
export type ScannedClass = { name: string; properties: ScannedProperty[] };

/** Where a `/` begins a regular expression literal, not a division. */
const REGEX_CAN_FOLLOW = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '',
]);

/**
 * The source with comments and the CONTENT of string, template and regex literals
 * replaced by spaces, same length, so structure (braces, parentheses, `@`) is all that
 * is left to read.
 */
export function blank(source: string): string {
  const out = source.split('');
  const mask = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let previous = '';
  let i = 0;

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      mask(i, stop);
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      mask(i, stop);
      i = stop;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== c)
        j += source[j] === '\\' ? 2 : 1;
      mask(i + 1, j);
      i = j + 1;
      previous = c;
    } else if (c === '/' && REGEX_CAN_FOLLOW.has(previous)) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && (source[j] !== '/' || inClass)) {
        if (source[j] === '\\') j += 1;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        j += 1;
      }
      mask(i + 1, j);
      i = j + 1;
      previous = '/';
    } else {
      if (!/\s/u.test(c)) previous = c;
      i += 1;
    }
  }

  return out.join('');
}

/** The index just past the `close` that balances the `open` at `from`. */
function balanced(
  text: string,
  from: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === open) depth += 1;
    else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }

  return text.length;
}

const MEMBER =
  /^(?:(?:public|private|protected|readonly|static|declare|abstract|override)\s+)*([A-Za-z_$][\w$]*)\s*[!?]?\s*:/u;

/** Every class in a source file, with each property's decorators, in order. */
export function scanClasses(source: string): ScannedClass[] {
  const text = blank(source);
  const classes: ScannedClass[] = [];

  for (const match of text.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)[^{]*\{/gu)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = balanced(text, open, '{', '}') - 1;
    const properties: ScannedProperty[] = [];
    let decorators: string[] = [];
    let i = open + 1;

    while (i < close) {
      if (/\s/u.test(text[i])) {
        i += 1;
      } else if (text[i] === '@') {
        const name = /^@([A-Za-z_$][\w$.]*)/u.exec(text.slice(i))?.[1] ?? '';
        i += 1 + name.length;
        while (/\s/u.test(text[i] ?? '')) i += 1;
        if (text[i] === '(') i = balanced(text, i, '(', ')');
        decorators.push(name);
      } else {
        // One member: up to its `;`, or the end of its `{ ... }` body, at depth 0.
        let end = i;
        let depth = 0;
        while (end < close) {
          const c = text[end];
          if ('([{'.includes(c)) depth += 1;
          else if (')]}'.includes(c)) depth -= 1;
          if (depth === 0 && (c === ';' || c === '}')) break;
          end += 1;
        }
        const header = text.slice(i, end).trim();
        const property = MEMBER.exec(header);
        if (property) properties.push({ name: property[1], decorators });
        decorators = [];
        i = end + 1;
      }
    }

    classes.push({ name: match[1], properties });
  }

  return classes;
}

/** The request DTO source files under a directory: `*.dto.ts` inside a `dto/rest` folder. */
export function dtoFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const full = join(root, name);
    if (statSync(full).isDirectory()) return dtoFiles(full);

    return full.endsWith('.dto.ts') && full.includes('/dto/rest/')
      ? [full]
      : [];
  });
}

/** Every class in every request DTO source under `root`. */
export function scanDtoDirectory(root: string): ScannedClass[] {
  return dtoFiles(root).flatMap((file) =>
    scanClasses(readFileSync(file, 'utf8')),
  );
}
