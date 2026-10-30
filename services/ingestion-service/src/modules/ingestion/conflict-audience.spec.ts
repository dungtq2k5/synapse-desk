import { mayName } from './conflict-check.service';

/**
 * B3: a `CONFLICTING` flag on one document may name another only when every
 * reader of the first can open the second.
 */
describe('Who a conflict flag may name (unit)', () => {
  const orgWide = {
    isOrganizationWide: true,
    departmentIds: [],
    deleted: false,
  };
  const scoped = (...departmentIds: string[]) => ({
    isOrganizationWide: false,
    departmentIds,
    deleted: false,
  });

  it.each([
    ['org-wide names org-wide', orgWide, orgWide, true],
    ['scoped names org-wide', scoped('hr'), orgWide, true],
    ['org-wide never names scoped', orgWide, scoped('hr'), false],
    [
      'scoped names a superset of its departments',
      scoped('hr'),
      scoped('hr', 'it'),
      true,
    ],
    [
      'scoped never names a document missing one of them',
      scoped('hr', 'it'),
      scoped('hr'),
      false,
    ],
    [
      'scoped never names disjoint departments',
      scoped('hr'),
      scoped('it'),
      false,
    ],
  ])('%s', (_, flagged, named, expected) => {
    expect(mayName(flagged, named)).toBe(expected);
  });

  it('never names, and never flags, a deleted document', () => {
    expect(mayName(orgWide, { ...orgWide, deleted: true })).toBe(false);
    expect(mayName({ ...orgWide, deleted: true }, orgWide)).toBe(false);
  });
});
