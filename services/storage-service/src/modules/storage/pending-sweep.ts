import { StoragePurpose } from '@synapsedesk/contracts';
import { PURPOSE_POLICY } from '../../common/purpose-registry';

/**
 * The two places `buildObjectPath` puts an upload before its confirm, and
 * nowhere else: `pending/` in exactly that position. A committed object never
 * matches, and neither does anything a caller names: the sweep takes an age,
 * never a path.
 *
 * `glob` narrows the bucket listing (GCS's `matchGlob`; the Firebase emulator
 * ignores it); `pattern` is the guarantee, applied to every name listed.
 */
export const PENDING_SHAPES = [
  {
    glob: `organizations/*/${PURPOSE_POLICY[StoragePurpose.TICKET_ATTACHMENT].prefix}/*/attachments/pending/**`,
    pattern: new RegExp(
      `^organizations/[^/]+/${PURPOSE_POLICY[StoragePurpose.TICKET_ATTACHMENT].prefix}/[^/]+/attachments/pending/(?:[^/]+/)?[^/]+$`,
    ),
  },
  {
    glob: `organizations/*/${PURPOSE_POLICY[StoragePurpose.TICKET_OPENING].prefix}/*/pending/*`,
    pattern: new RegExp(
      `^organizations/[^/]+/${PURPOSE_POLICY[StoragePurpose.TICKET_OPENING].prefix}/[^/]+/pending/[^/]+$`,
    ),
  },
] as const;

/**
 * Whether a listed object is an abandoned upload: in a pending shape, and
 * created before `cutoff` (strictly; an object exactly at it stays).
 *
 * @example isAbandoned(name, '2026-11-17T00:00:00Z', Date.parse('2026-11-17T01:00:00Z'), PENDING_SHAPES[0].pattern)
 */
export function isAbandoned(
  name: string,
  timeCreated: string | undefined,
  cutoff: number,
  pattern: RegExp,
): boolean {
  if (!pattern.test(name) || !timeCreated) return false;

  return Date.parse(timeCreated) < cutoff;
}
