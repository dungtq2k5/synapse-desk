import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Every read of department memberships filters on `deletedAt`.
 *
 * A deleted user keeps their memberships, so restoring them returns them to their
 * departments. A department can therefore be deleted while a deleted user's
 * membership still points at it, and a read that takes memberships as they stand
 * hands a restored user that department — in the login token, where it widens what
 * they can see, with nothing to show for it. So the filter is not a convention to
 * remember at each new read; this scan holds it.
 *
 * Scanned from the source toward the rule:
 *
 * - every `userDepartments:` include, select or `_count` carries a `deletedAt`
 *   filter. A relation filter (`{ some | every | none: … }`) narrows a query rather
 *   than reading memberships, and is not one;
 * - every direct `userDepartment` read carries one too, unless named in
 *   {@link EXCEPTIONS} with the reason it cannot see a deleted row. A named
 *   exception that no longer matches exactly one call fails, so the list cannot go
 *   stale.
 */
describe('department membership reads filter on deletedAt', () => {
  const SRC = join(__dirname, '../..');

  const sources = (): { file: string; source: string }[] => {
    const out: { file: string; source: string }[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'generated') walk(path);
        } else if (
          entry.name.endsWith('.ts') &&
          !entry.name.includes('.spec.')
        ) {
          out.push({
            file: relative(SRC, path),
            source: readFileSync(path, 'utf8'),
          });
        }
      }
    };
    walk(SRC);

    return out;
  };

  /** The text from `open` to its matching closer, inclusive; '' when unbalanced. */
  const balanced = (source: string, open: number): string => {
    const opener = source[open];
    const closer = opener === '{' ? '}' : ')';
    let depth = 0;
    for (let index = open; index < source.length; index++) {
      if (source[index] === opener) depth++;
      else if (source[index] === closer && --depth === 0) {
        return source.slice(open, index + 1);
      }
    }

    return '';
  };

  /** Direct reads that cannot see a deleted row, each with why. */
  const EXCEPTIONS: { file: string; contains: string; why: string }[] = [
    {
      file: 'modules/departments/departments.service.ts',
      contains: 'assignedBy: { select: { fullName: true } }',
      why: 'the member list: its `where`, built above the call, filters `user.deletedAt`',
    },
    {
      file: 'modules/departments/departments.service.ts',
      contains: '{ where }',
      why: "the member list's count, over the same `where`",
    },
    {
      file: 'modules/departments/departments.service.ts',
      contains: 'userId: { in: userIds }',
      why: 'the users being added, in a department already loaded as live',
    },
  ];

  const scan = () => {
    const relationReads: string[] = [];
    const directReads: string[] = [];
    const violations: string[] = [];
    const exceptionHits = new Map<(typeof EXCEPTIONS)[number], number>();

    for (const { file, source } of sources()) {
      for (const match of source.matchAll(/\buserDepartments:\s*(true|\{)/g)) {
        const at = match.index + match[0].length - match[1].length;
        const value = match[1] === 'true' ? 'true' : balanced(source, at);
        if (/^\{\s*(some|every|none):/.test(value)) continue;

        relationReads.push(`${file}: ${value}`);
        if (!value.includes('deletedAt')) {
          violations.push(`${file}: userDepartments: ${value}`);
        }
      }

      for (const match of source.matchAll(
        /\buserDepartment\.(findMany|findFirst|count|aggregate|groupBy)\(/g,
      )) {
        const args = balanced(source, match.index + match[0].length - 1);
        directReads.push(`${file}: ${match[1]}${args}`);
        if (args.includes('deletedAt')) continue;

        const exception = EXCEPTIONS.find(
          (candidate) =>
            candidate.file === file && args.includes(candidate.contains),
        );
        if (exception) {
          exceptionHits.set(exception, (exceptionHits.get(exception) ?? 0) + 1);
        } else {
          violations.push(`${file}: userDepartment.${match[1]}${args}`);
        }
      }
    }

    return { relationReads, directReads, violations, exceptionHits };
  };

  it('finds the reads it is about — the pattern-fires floor', () => {
    const { relationReads, directReads } = scan();

    // The login token, user responses, the current user, the department count.
    expect(relationReads.length).toBeGreaterThanOrEqual(4);
    expect(directReads.length).toBeGreaterThanOrEqual(4);
  });

  it('every read filters on deletedAt, or is a named exception', () => {
    expect(scan().violations).toEqual([]);
  });

  it('every named exception matches exactly one read', () => {
    const { exceptionHits } = scan();

    expect(
      EXCEPTIONS.filter((exception) => exceptionHits.get(exception) !== 1).map(
        (exception) => `${exception.file}: ${exception.contains}`,
      ),
    ).toEqual([]);
  });
});
