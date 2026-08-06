/**
 * Re-exported from the shared test helpers.
 *
 * This file was one of three near-identical copies across four services,
 * differing only in comment wording and in two signatures that had quietly
 * drifted. It stays as a re-export rather than being deleted so the ~40 specs
 * that import `../utils/context` keep working, and so a service that needs a
 * genuinely local builder has an obvious place to add one.
 */

export {
  callerContext,
  memberContext,
  requestOrigin,
  superAdminContext,
} from '@synapsedesk/common/testing/context';
export { pageRequest } from '@synapsedesk/grpc-proto/testing/page';
