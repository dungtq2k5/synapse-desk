import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **no inbound path can create an organization.**
 *
 * Static, and deliberately so: the failure it guards is total and one call
 * away. Self-signup's path creates an organization when no domain matches and
 * makes the registrant its Org Admin —
 *
 * ```ts
 * const org = existingOrg ?? (await tx.organization.create({ … }));
 * const isFounder = existingOrg === null;
 * ```
 *
 * — and inbound mail reaching it turns an email from an unrecognised domain,
 * the case the policy calls a DROP, into a tenant owned by a stranger. No
 * runtime test finds that, because the code would have to be written first and
 * would then look reasonable in review: it is a call to an existing, correct,
 * well-tested function.
 *
 * The doc's phrasing is the assertion: *an RPC that receives an
 * `organization_id` has no branch in which it can mint one.*
 */
const USERS_SERVICE = join(__dirname, 'users.service.ts');

/** `resolveInboundSender`'s body, brace-matched from its signature. */
function resolveInboundSenderBody(): string {
  const source = readFileSync(USERS_SERVICE, 'utf8');
  const start = source.indexOf('async resolveInboundSender(');

  if (start === -1) {
    // Loud rather than empty: a renamed method makes every assertion below
    // pass over an empty string, which is the most reassuring possible way for
    // this guard to stop working.
    throw new Error('resolveInboundSender not found — was it renamed?');
  }

  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;

  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0) {
      return source.slice(open, index + 1);
    }
  }

  throw new Error('resolveInboundSender body did not close');
}

describe('The inbound sender path cannot create a tenant', () => {
  const body = resolveInboundSenderBody();

  it('the scan found a real body', () => {
    // Guards the guard.
    expect(body.length).toBeGreaterThan(200);
    expect(body).toContain('organizationId');
  });

  it('**never calls `organization.create`**', () => {
    expect(body).not.toMatch(/organization\.create/);
  });

  it('**and never creates an organization by any spelling**', () => {
    // `tx.organization.create`, `prisma.organization.create`, `createMany`,
    // `upsert` — upsert is the one that would slip through a `.create` check
    // while doing exactly the same thing.
    expect(body).not.toMatch(/organization\.(create|createMany|upsert)/);
  });

  it('**and does not assign a role from the request**', () => {
    // The other half of the escalation. A role the caller names turns an
    // unauthenticated webhook into a privilege grant; the role is a constant
    // here and `getEndUserRoleId` is the only source.
    expect(body).toContain('getEndUserRoleId');
    expect(body).not.toMatch(/request\.role|roleIds|SystemRoleName\./);
  });

  it('**and never looks up an organization by the sender’s domain**', () => {
    // A2's misroute. The global `findFirst({ allowedEmailDomains: { has } })`
    // answers "which tenant claims this domain?" — a different question, whose
    // answer may be a tenant the mail was not addressed to.
    const orgLookups = [
      ...body.matchAll(/organization\.findFirst\([\s\S]*?\)/g),
    ];

    expect(orgLookups).toHaveLength(1);
    // The one lookup it does make is BY ID, and the id came from the token.
    expect(orgLookups[0][0]).toContain('id: organizationId');
    expect(orgLookups[0][0]).not.toContain('allowedEmailDomains: {');
  });
});
