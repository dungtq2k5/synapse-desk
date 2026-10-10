import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `docs/development-conventions.md` 12.3 — a docblock sits on the DECLARATION —
 * enforced for DTO properties, where breaking it costs documentation silently.
 *
 * A `/** *\/` block placed between a property's decorators and its name reads
 * exactly like a docblock and is not one. The Swagger plugin runs with
 * `introspectComments`, and it takes the LEADING comment: a block below the
 * decorators never reaches the published spec. Three of these were found by
 * hand, and one of them — `AcceptInvitationDto.deviceName` — was the field's
 * only comment, so it shipped with no description at all while the file looked
 * thoroughly documented.
 *
 * That is the reason this is a test rather than a review note. The failure is
 * invisible in the source, invisible in the diff, and only visible in a
 * generated artifact nobody diffs.
 */
describe('A DTO docblock sits above the decorators, not below them', () => {
  const MODULES_DIR = __dirname;

  const walkFiles = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walkFiles(path, out);
      else out.push(path);
    }

    return out;
  };

  const dtoFiles = walkFiles(MODULES_DIR).filter((path) =>
    path.endsWith('.dto.ts'),
  );

  /**
   * Every `/**` whose nearest preceding CODE line is a decorator.
   *
   * Blank lines and `//` comments are stepped over — a stray note between the
   * decorator and the block is exactly how two of the three were written, and
   * stopping at it would miss them.
   *
   * Deliberately does not walk back through a multi-line decorator's closing
   * `)`. Doing so means guessing which closing brace belongs to a decorator and
   * which ends the member before it, and a structural guard that reports a
   * wrong line is worse than one with a known blind spot.
   */
  const misplaced = (source: string): number[] => {
    const lines = source.split('\n');
    const found: number[] = [];

    lines.forEach((line, index) => {
      if (!line.trim().startsWith('/**')) return;

      for (let back = index - 1; back >= 0; back--) {
        const previous = lines[back].trim();
        if (previous === '' || previous.startsWith('//')) continue;
        if (previous.startsWith('@')) found.push(index + 1);
        break;
      }
    });

    return found;
  };

  it('the sweep reads DTO files at all', () => {
    // Guards the guard: an empty file list passes every assertion below while
    // checking nothing, which is the failure mode a structural test has.
    expect(dtoFiles.length).toBeGreaterThan(20);
  });

  /**
   * Every property docblock whose nearest preceding line is a `//` comment.
   *
   * A SECOND way to lose the same description, and the opposite arrangement to
   * the one above: the plugin takes the FIRST leading comment, so a `//` above
   * the docblock wins and the docblock is dropped. A blank line between them
   * does not help — measured, not assumed.
   *
   * Class docblocks are excluded because they never become schema descriptions
   * at all: `UpdateOrganizationSettingsDto` has a clean one and still reports
   * `undefined`, so flagging them would report a loss that cannot happen.
   */
  const suppressed = (source: string): number[] => {
    const lines = source.split('\n');
    const found: number[] = [];

    lines.forEach((line, index) => {
      if (!line.trim().startsWith('/**')) return;

      let precededByComment = false;
      for (let back = index - 1; back >= 0; back--) {
        const previous = lines[back].trim();
        if (previous === '') continue;
        precededByComment = previous.startsWith('//');
        break;
      }
      if (!precededByComment) return;

      let end = index;
      while (end < lines.length && !lines[end].includes('*/')) end++;

      for (let forward = end + 1; forward < lines.length; forward++) {
        const next = lines[forward].trim();
        if (next === '' || next.startsWith('//') || next.startsWith('@'))
          continue;
        if (!/^(export )?class /.test(next)) found.push(index + 1);
        break;
      }
    });

    return found;
  };

  it('**no `//` comment sits above a property docblock**', () => {
    const offenders = dtoFiles.flatMap((path) => {
      const lines = suppressed(readFileSync(path, 'utf8'));

      return lines.map(
        (line) => `${path.replace(`${MODULES_DIR}/`, '')}:${line}`,
      );
    });

    expect(offenders).toEqual([]);
  });

  it('**no docblock is stranded below a decorator**', () => {
    const offenders = dtoFiles.flatMap((path) => {
      const lines = misplaced(readFileSync(path, 'utf8'));

      return lines.map(
        (line) => `${path.replace(`${MODULES_DIR}/`, '')}:${line}`,
      );
    });

    expect(offenders).toEqual([]);
  });
});
