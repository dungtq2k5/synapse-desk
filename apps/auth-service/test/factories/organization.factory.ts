import { faker } from '@faker-js/faker';
import { FREE_TIER_ORGANIZATION_GRANTS, OrgStatus } from '@synapsedesk/common';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

/**
 * Monotonic counter, not `faker.company.name()` alone.
 *
 * `slug` and `domain` are globally unique columns, and faker draws from a
 * finite word list — over a few hundred rows in one run it WILL repeat. The
 * resulting failure is a unique-violation in a test that has nothing to do with
 * uniqueness, appearing only on some runs. The counter makes collisions
 * impossible rather than unlikely.
 */
let orgIdx = 0;

export function buildOrganization(
  overrides: Partial<Prisma.OrganizationCreateInput> = {},
): Prisma.OrganizationCreateInput {
  orgIdx++;
  const slug = `org-${orgIdx}-${faker.string.alphanumeric(6).toLowerCase()}`;

  return {
    // The free tier, so a test that cares about none of the seven quota columns
    // says nothing about them — which is every test but a handful. ONE edit
    // here covers the whole suite, which is what the factory rule buys.
    ...FREE_TIER_ORGANIZATION_GRANTS,
    name: `${faker.company.name()} ${orgIdx}`,
    slug,
    // ACTIVE rather than the real registration default of PENDING_ONBOARDING:
    // most tests are about something else entirely, and PENDING_ONBOARDING is a
    // state whose own behaviour a handful of tests assert deliberately. A
    // default that quietly changes what half the suite exercises is worse than
    // one that requires those few tests to say what they mean.
    status: OrgStatus.ACTIVE,
    ...overrides,
  };
}

export function createOrganization(
  prisma: PrismaService,
  overrides: Partial<Prisma.OrganizationCreateInput> = {},
) {
  return prisma.organization.create({ data: buildOrganization(overrides) });
}
