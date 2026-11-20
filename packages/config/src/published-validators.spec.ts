import { readListed, repoFiles } from '@synapsedesk/testing/repo-files';

/**
 * A gateway request field's validator publishes what it enforces.
 *
 * The validators that carry a regular expression (`@Matches`, `@IsISO8601`,
 * `@IsStrongPassword`, `@IsNumberString`) have a `pattern` in the document, so
 * a generated client can refuse what the gateway would. Request DTOs use the
 * publishing versions (`published-validators.decorator.ts`), never the bare
 * ones, or the document goes silent on that field's rule again.
 */
describe('a validator on a gateway request field', () => {
  const BARE = /@(Matches|IsISO8601|IsStrongPassword|IsNumberString)\(/g;

  const requestFiles = () =>
    repoFiles('services/api-gateway/src').filter(
      (file) =>
        (file.endsWith('.dto.ts') && !file.endsWith('-response.dto.ts')) ||
        file.endsWith('.gql-dto.ts'),
    );

  const bare = (source: string) =>
    [...source.matchAll(BARE)].map(([, name]) => name);

  it('**1. is the publishing version, never the bare one**', () => {
    const violations = readListed(requestFiles()).flatMap(({ path, text }) =>
      bare(text).map((name) => `${path}: @${name}() publishes nothing`),
    );

    expect(violations).toEqual([]);
  });

  it('**2. the scan reaches real files, and can see a bare validator**', () => {
    expect(requestFiles().length).toBeGreaterThan(30);
    expect(
      bare('@PublishedMatches(X)\n@Matches(X)\n@IsISO8601({ strict: true })'),
    ).toEqual(['Matches', 'IsISO8601']);
  });
});
