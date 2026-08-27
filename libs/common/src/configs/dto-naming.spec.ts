import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every class in `<entity>-response.dto.ts` ends `ResponseDto`.
 *
 * `development-conventions.md` §12.1 states it, and the reason is the import
 * line: a `ValidationPipe` runs on request DTOs and never on response ones, so
 * "does this class get validated?" has to be answerable without opening the
 * file. A class named `…Dto` sitting among responses answers it wrongly.
 *
 * **Written because the rule was unenforced and three violations had shipped.**
 * `PlanSubscriberProjectionDto`, `FailedInvitationDto` and
 * `InvitationPreviewRowDto` all sat in `*-response.dto.ts` files, and all three
 * were found the way `mapper-naming.spec.ts` records for its own rule — a
 * person happening to look, once, for an unrelated reason. Two of them were
 * still unnoticed when the third was renamed by hand.
 *
 * **Scanned from the CODE toward the rule**, the same direction and for the
 * same reason as its sibling: the reverse can only confirm that names already
 * written down are still spelled correctly, which is not where violations come
 * from.
 */
describe('response DTO classes carry the ResponseDto suffix', () => {
  const REPO_ROOT = join(__dirname, '../../../..');

  /**
   * `export class Foo` — the declaration, not a reference to one.
   *
   * Anchored to the start of a LINE (`m`), which is what keeps a commented-out
   * `// export class OldDto {}` from being reported. Test 2 below caught that:
   * the unanchored form flagged a class that does not exist.
   */
  const DECLARATION = /^export class ([A-Za-z0-9_]+)/gm;

  /**
   * Response DTO files only.
   *
   * `git ls-files` rather than a directory walk, so an untracked scratch file
   * cannot fail the suite and a file deleted but not staged cannot pass it.
   */
  const responseFiles = (): string[] =>
    execFileSync(
      'git',
      [
        'ls-files',
        '--',
        'apps/**/*-response.dto.ts',
        'libs/**/*-response.dto.ts',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean);

  /**
   * Every REST DTO file that is NOT a response file.
   *
   * `.gql-dto.ts` is excluded because GraphQL answers to a different rule —
   * §12.1 gives the DECORATOR the naming authority there, so a class name
   * carries no obligation.
   */
  const requestFiles = (): string[] =>
    execFileSync(
      'git',
      ['ls-files', '--', 'apps/**/*.dto.ts', 'libs/**/*.dto.ts'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .filter(
        (file) =>
          !file.endsWith('-response.dto.ts') && !file.endsWith('.gql-dto.ts'),
      );

  const offenders = (source: string): string[] =>
    [...source.matchAll(DECLARATION)]
      .map(([, name]) => name)
      .filter((name) => !name.endsWith('ResponseDto'));

  it('**1. every class in a response file is named for what it is**', () => {
    const violations: string[] = [];

    for (const file of responseFiles()) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');

      for (const name of offenders(source)) {
        violations.push(`${file}: ${name} — expected a ResponseDto suffix`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('**2. …and the scan can actually SEE a violation**', () => {
    // The half that stops test 1 passing because the regex matched nothing. A
    // guard that scans zero classes is indistinguishable from a clean repo, and
    // this repo has shipped that shape before.
    const source = [
      'export class GoodResponseDto {}',
      'export class BadDto {}',
      '// export class CommentedDto {}',
    ].join('\n');

    expect(offenders(source)).toEqual(['BadDto']);
  });

  it('**3. no response class hides in a REQUEST file**', () => {
    // The other half of §12.1, and the half that has teeth: a `ValidationPipe`
    // runs on request DTOs and never on response ones, so a response class
    // filed among requests makes "does this get validated?" unanswerable from
    // the import line. `inbound-attachment.dto.ts` held three of them, and its
    // own docblock said so — "which is why it carries no validators" — without
    // anything acting on it.
    const violations: string[] = [];

    for (const file of requestFiles()) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');

      for (const [, name] of source.matchAll(DECLARATION)) {
        if (!name.endsWith('ResponseDto')) continue;

        violations.push(
          `${file}: ${name} — a response class belongs in <entity>-response.dto.ts`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it('**4. the scan reaches real files, not an empty list**', () => {
    // `git ls-files` with a glob that matches nothing exits cleanly, so test 1
    // would pass over zero files and report a compliance it never checked.
    const files = responseFiles();

    expect(files.length).toBeGreaterThan(10);
    expect(files.every((file) => file.endsWith('-response.dto.ts'))).toBe(true);
    expect(requestFiles().length).toBeGreaterThan(10);
  });
});
