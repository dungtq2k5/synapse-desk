import {
  Gender,
  InvitationStatus,
  OtpPurpose,
  SORT_ORDER_OPTIONS,
} from '@synapsedesk/common';
import {
  Gender as ProtoGender,
  SortOrder as ProtoSortOrder,
} from './generated/synapsedesk/auth/common';
import { InvitationStatus as ProtoInvitationStatus } from './generated/synapsedesk/auth/invitation';
import { OtpPurpose as ProtoOtpPurpose } from './generated/synapsedesk/auth/otp';
import {
  fromProtoGender,
  fromProtoInvitationStatus,
  fromProtoOtpPurpose,
  fromProtoSortOrder,
  fromTimestamp,
  requireTimestamp,
  toIsoDate,
  toPageRequest,
  toProtoGender,
  toProtoInvitationStatus,
  toProtoOtpPurpose,
  toProtoSortOrder,
  toTimestamp,
} from './mappers';

/**
 * the mapper round-trip sweep.
 *
 * Two enums share every one of these names: a STRING domain enum ('MALE') and a
 * NUMERIC proto enum (1). They are not interchangeable, and these functions are
 * the only sanctioned bridge — which makes a silent asymmetry here a value that
 * arrives on the other side as something the sender never wrote.
 *
 * Every table below is driven off the domain enum's own members rather than a
 * hand-written list, so adding a member without a mapping fails HERE rather
 * than in whichever service first sends it.
 */
describe('mapper round-trip sweep (unit)', () => {
  describe('Gender', () => {
    it('round-trips EVERY domain member', () => {
      for (const gender of Object.values(Gender)) {
        expect(fromProtoGender(toProtoGender(gender))).toBe(gender);
      }
    });

    it('round-trips EVERY proto member', () => {
      const real = Object.values(ProtoGender).filter(
        (v): v is ProtoGender =>
          typeof v === 'number' && v !== ProtoGender.UNRECOGNIZED,
      );

      for (const gender of real) {
        expect(toProtoGender(fromProtoGender(gender))).toBe(gender);
      }
    });

    it("maps NULL onto UNSPECIFIED — what proto3's mandatory zero value is for", () => {
      // The column is a nullable VarChar and the proto field is non-optional,
      // so there is nowhere else for a null to go.
      expect(toProtoGender(null)).toBe(ProtoGender.GENDER_UNSPECIFIED);
      expect(toProtoGender('')).toBe(ProtoGender.GENDER_UNSPECIFIED);
    });

    it('maps an UNRECOGNIZED value to UNSPECIFIED rather than crashing', () => {
      // A member added by a newer build than this one is closer to "not
      // stated" than to a reason to fail the request.
      expect(fromProtoGender(ProtoGender.UNRECOGNIZED)).toBe(
        Gender.UNSPECIFIED,
      );
      expect(fromProtoGender(999 as ProtoGender)).toBe(Gender.UNSPECIFIED);
    });

    it('maps a value outside the enum to UNSPECIFIED, never to MALE', () => {
      // The failure worth naming: a `?? PROTO_GENDER_BY_NAME[0]`-style fallback
      // would silently assign everyone the first member.
      expect(toProtoGender('not-a-gender')).toBe(
        ProtoGender.GENDER_UNSPECIFIED,
      );
    });
  });

  describe('OtpPurpose', () => {
    it('round-trips EVERY domain member', () => {
      for (const purpose of Object.values(OtpPurpose)) {
        expect(fromProtoOtpPurpose(toProtoOtpPurpose(purpose))).toBe(purpose);
      }
    });

    it('maps UNSPECIFIED to NULL, never to a real purpose', () => {
      // UNSPECIFIED here means "the caller omitted the field". Defaulting it to
      // EMAIL_VERIFICATION would let a malformed request verify an address the
      // sender never named.
      expect(fromProtoOtpPurpose(ProtoOtpPurpose.OTP_PURPOSE_UNSPECIFIED)).toBe(
        null,
      );
    });

    it('maps UNRECOGNIZED to null too', () => {
      expect(fromProtoOtpPurpose(ProtoOtpPurpose.UNRECOGNIZED)).toBe(null);
    });
  });

  describe('InvitationStatus', () => {
    it('round-trips EVERY domain member', () => {
      for (const invitationStatus of Object.values(InvitationStatus)) {
        expect(
          fromProtoInvitationStatus(toProtoInvitationStatus(invitationStatus)),
        ).toBe(invitationStatus);
      }
    });

    it('maps UNSPECIFIED to NULL so an unset filter cannot become a PENDING filter', () => {
      expect(
        fromProtoInvitationStatus(
          ProtoInvitationStatus.INVITATION_STATUS_UNSPECIFIED,
        ),
      ).toBe(null);
    });
  });

  describe('SortOrder', () => {
    it('round-trips EVERY domain member', () => {
      // A union of string literals, not an enum — `SORT_ORDER_OPTIONS` is the
      // runtime list the type is derived from, so iterating it cannot drift
      // from the type the way a hand-written array would.
      for (const order of SORT_ORDER_OPTIONS) {
        expect(fromProtoSortOrder(toProtoSortOrder(order))).toBe(order);
      }
    });

    it('maps UNSPECIFIED to the default direction, not to a rejection', () => {
      // Direction is a presentation preference — a request is not wrong for
      // omitting it, unlike an OTP purpose.
      expect(
        fromProtoSortOrder(ProtoSortOrder.SORT_ORDER_UNSPECIFIED),
      ).toBeDefined();
    });
  });

  describe('Timestamp', () => {
    it('round-trips to the same instant at millisecond precision', () => {
      // `google.protobuf.Timestamp` is NOT a Date on the wire: proto-loader
      // treats it as an ordinary message, so it travels as { seconds, nanos }.
      const date = new Date('2026-08-02T12:34:56.789Z');

      expect(fromTimestamp(toTimestamp(date))!.getTime()).toBe(date.getTime());
    });

    it('round-trips an instant before the epoch', () => {
      // Negative seconds are where a naive `Math.floor`/modulo pair goes wrong.
      const date = new Date('1969-07-20T20:17:40.000Z');

      expect(fromTimestamp(toTimestamp(date))!.getTime()).toBe(date.getTime());
    });

    it('maps NULL to undefined in both directions', () => {
      expect(toTimestamp(null)).toBeUndefined();
      expect(fromTimestamp(undefined)).toBeUndefined();
    });

    it('requireTimestamp THROWS on a missing value rather than substituting a date', () => {
      // ts-proto types every message field as `T | undefined` as a convention,
      // not as permission to omit it — so a missing value is a contract
      // violation, and a fallback `new Date()` would write today's date into a
      // record that has no created-at.
      expect(() => requireTimestamp(undefined, 'createdAt')).toThrow(
        /createdAt/,
      );
    });

    it('requireTimestamp passes a present value through unchanged', () => {
      const date = new Date('2026-01-15T00:00:00.000Z');

      expect(requireTimestamp(toTimestamp(date), 'createdAt').getTime()).toBe(
        date.getTime(),
      );
    });
  });

  describe('toIsoDate', () => {
    it('formats from UTC components so the day cannot drift west of UTC', () => {
      // `@db.Date` columns are calendar dates — no time, no zone. Reading local
      // components instead would move a birthday by a day for half the world.
      expect(toIsoDate(new Date('2026-08-02T00:30:00.000Z'))).toBe(
        '2026-08-02',
      );
      expect(toIsoDate(new Date('2026-08-02T23:30:00.000Z'))).toBe(
        '2026-08-02',
      );
    });

    it('zero-pads single-digit months and days', () => {
      expect(toIsoDate(new Date('2026-01-05T12:00:00.000Z'))).toBe(
        '2026-01-05',
      );
    });

    it('maps NULL to undefined', () => {
      expect(toIsoDate(null)).toBeUndefined();
    });
  });

  describe('toPageRequest', () => {
    it('collapses an absent searchTerm to the empty string, not undefined', () => {
      // proto3 scalars have no null, and `defaults: true` would materialise an
      // omitted field as '' on the receiving side anyway. Doing it here makes
      // the two ends agree explicitly instead of by accident.
      const request = toPageRequest({
        page: 2,
        limit: 25,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      });

      expect(request.searchTerm).toBe('');
      expect(request.page).toBe(2);
      expect(request.limit).toBe(25);
      expect(request.sortOrder).toBe(ProtoSortOrder.SORT_ORDER_DESC);
    });

    it('passes a supplied searchTerm through', () => {
      const request = toPageRequest({
        page: 1,
        limit: 20,
        searchTerm: 'alice',
        sortBy: 'name',
        sortOrder: 'ASC',
      });

      expect(request.searchTerm).toBe('alice');
    });
  });
});
