import { PERMISSION_CODES } from '@synapsedesk/common';
import type { CallerContext } from '@synapsedesk/common';
import { memberContext } from './context';

/**
 * A tenant member holding EVERY permission.
 *
 * Four specs had declared this locally — three as `superuser`, one as `admin` —
 * which is how a shared helper hides: the bodies were identical and only the
 * names differed, so no search for either name found all four.
 *
 * Holding everything is deliberate for suites whose subject is not
 * authorization: a test about role assignment should fail because role
 * assignment broke, not because the fixture lacked `user.role.assign`. Suites
 * that ARE about permissions build narrower contexts with `memberContext`.
 */
export function superuser(t: {
  user: { id: string; organizationId: string | null };
}): CallerContext {
  return memberContext(t.user, [...PERMISSION_CODES]);
}
