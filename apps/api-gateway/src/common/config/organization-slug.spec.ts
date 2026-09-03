import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ORGANIZATION_DOMAIN_PATTERN,
  ORGANIZATION_SLUG_PATTERN,
} from './dto.config';
import { UpdateOrganizationDto } from '../../modules/organizations/dto/rest/organization.dto';
import { CreatePlatformOrganizationDto } from '../../modules/platform/dto/rest/platform.dto';

/**
 * The organization slug format rule.
 *
 * Until this existed a slug carried only a length bound, so a space, a `/`, an
 * `@` or an emoji all passed — in a field that is `@unique` and reads like a URL
 * segment. The rule is a FORMAT, not a character exclusion, which is why it is a
 * pattern rather than the emoji decorator that guards `name`.
 */
describe('Organization slug format (unit)', () => {
  /**
   * Only the `slug` verdict.
   *
   * The DTO requires an admin email and name too, and including their errors
   * would make every assertion here depend on fields this file has no opinion
   * about — a rename elsewhere would fail these tests for the wrong reason.
   */
  const slugErrors = (slug: unknown) =>
    validateSync(
      plainToInstance(CreatePlatformOrganizationDto, { name: 'Acme', slug }),
    )
      .map((error) => error.property)
      .filter((property) => property === 'slug');

  it('1. accepts a conventional slug', () => {
    expect(slugErrors('acme-corp')).toEqual([]);
  });

  it('**2. refuses the shapes the length bound let through**', () => {
    // Each of these was accepted before the pattern existed, and each is a slug
    // that would land in a URL.
    for (const slug of [
      'acme corp',
      'acme/corp',
      'acme@corp',
      // `ACME-CORP` is deliberately NOT here — it is normalized rather than
      // refused, which 2b pins. Case was the one shape the service already
      // handled correctly.
      'acme_corp',
      'acme😀',
    ]) {
      expect([slug, slugErrors(slug)]).toEqual([slug, ['slug']]);
    }
  });

  it('**2b. and an UPPERCASE slug is normalized, not refused**', () => {
    // A regression the format rule introduced and the first draft did not name.
    //
    // `platform.service.ts` has done `.trim().toLowerCase()` on this field all
    // along, so `PUT { slug: "ACME-CORP" }` returned 200 and stored
    // `acme-corp`. A bare `@Matches` turned that into a 400 — a request that
    // worked yesterday failing today, for a field the server was already
    // canonicalizing correctly.
    //
    // The pattern still earns its place: `acme corp` and `acme/corp` were never
    // fixed by lowercasing and reached the database meaningless. Moving THAT
    // refusal earlier is the point of the rule; rejecting case was collateral.
    expect(slugErrors('ACME-CORP')).toEqual([]);
    expect(slugErrors('  Acme-Corp  ')).toEqual([]);

    // And the transform is what makes it pass — not a widened pattern.
    expect(ORGANIZATION_SLUG_PATTERN.test('ACME-CORP')).toBe(false);
  });

  // Test 3 — "accepts what `generateUniqueOrganizationSlug` actually emits" —
  // moved to auth-service's `utils.spec.ts`: it asserts the PRODUCER's
  // conformance to the (now shared) pattern, and asserting it from here took
  // a cross-workspace relative import that a pruned image build refuses —
  // measured as the first failure the in-image typecheck ever caught.

  describe('**the domain format rule**', () => {
    const domainErrors = (domain: unknown) =>
      validateSync(plainToInstance(UpdateOrganizationDto, { domain }))
        .map((error) => error.property)
        .filter((property) => property === 'domain');

    it('1. accepts real hostnames, including punycode', () => {
      for (const domain of [
        'acme.com',
        'sub.example.co.uk',
        'a-b.io',
        'xn--mnchen-3ya.de',
      ]) {
        expect([domain, domainErrors(domain)]).toEqual([domain, []]);
      }
    });

    it('**2. refuses what `.trim().toLowerCase()` only tidied**', () => {
      // Every one of these was stored before the rule existed: the service
      // lowercased and trimmed it, leaving the field neat and meaningless.
      // Emoji is one row of several, which is why this is a FORMAT rule rather
      // than the emoji decorator the ASK proposed.
      for (const domain of [
        '🎉.com',
        'acme',
        'acme..com',
        '-acme.com',
        'ac me.com',
        'acme@com',
        'acme.com/x',
      ]) {
        expect([domain, domainErrors(domain)]).toEqual([domain, ['domain']]);
      }
    });

    it('3. and an UPPERCASE domain is normalized, not refused', () => {
      // Same compatibility point as the slug: auth-service has lowercased this
      // field all along, so refusing `ACME.COM` would break a working request.
      expect(domainErrors('ACME.COM')).toEqual([]);
      expect(ORGANIZATION_DOMAIN_PATTERN.test('ACME.COM')).toBe(false);
    });
  });
});
