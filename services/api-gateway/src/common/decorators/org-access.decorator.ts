import { SetMetadata } from '@nestjs/common';
import { OrgAccess } from '@synapsedesk/common';

export const ORG_ACCESS_KEY = 'orgAccess';

/**
 * Declares which lifecycle category a route belongs to, for the tenant status
 * gate (`OrganizationStatusInterceptor`).
 *
 * Routes that do NOT carry this are treated by their HTTP verb: `GET`/`HEAD`
 * count as READ, everything else as WRITE. That default is the important part
 * of the design — a route added later is gated automatically, and the decorator
 * is only needed where the verb lies about the intent:
 *
 *   `@OrgAccessKind(OrgAccess.AUTH)`        // never blocked
 *   `@OrgAccessKind(OrgAccess.ONBOARDING)`  // a POST that must work pre-ACTIVE
 *   `@OrgAccessKind(OrgAccess.BILLING)`     // must survive SUSPENDED_PAST_DUE
 */
export const OrgAccessKind = (kind: OrgAccess) =>
  SetMetadata(ORG_ACCESS_KEY, kind);
