import {
  AI_MODEL_TIERS,
  DEFAULT_SEARCH,
  DigestMode,
  Gender,
  InvitationStatus,
  NotificationChannel,
  NotificationPriority,
  OrgStatus,
  OtpPurpose,
  PreferenceSource,
  SORT_ORDER_OPTIONS,
} from '@synapsedesk/common';
import {
  AiModelTier as ProtoAiModelTier,
  Gender as ProtoGender,
  OrgStatus as ProtoOrgStatus,
  SortOrder as ProtoSortOrder,
} from './generated/synapsedesk/auth/common';
import { InvitationStatus as ProtoInvitationStatus } from './generated/synapsedesk/auth/invitation';
import { OtpPurpose as ProtoOtpPurpose } from './generated/synapsedesk/auth/otp';
import {
  DigestMode as ProtoDigestMode,
  NotificationChannel as ProtoNotificationChannel,
  NotificationPriority as ProtoNotificationPriority,
  PreferenceSource as ProtoPreferenceSource,
} from './generated/synapsedesk/notification/notification';
import {
  clampLimit,
  fromProtoAiModelTier,
  fromProtoDigestMode,
  fromProtoGender,
  fromProtoInvitationStatus,
  fromProtoNotificationChannel,
  fromProtoNotificationPriority,
  fromProtoOtpPurpose,
  fromProtoPreferenceSource,
  fromProtoSortOrder,
  fromProtoOrgStatus,
  fromTimestamp,
  normalizePage,
  requireTimestamp,
  toIsoDate,
  toPageMeta,
  toPageRequest,
  toProtoAiModelTier,
  toProtoDigestMode,
  toProtoGender,
  toProtoInvitationStatus,
  toProtoNotificationChannel,
  toProtoNotificationPriority,
  toProtoOrgStatus,
  toProtoOtpPurpose,
  toProtoPreferenceSource,
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

  describe('OrgStatus', () => {
    it('round-trips EVERY domain member', () => {
      // Round-trip is also the INJECTIVITY check: if two statuses collapsed
      // onto one proto member, one of them would come back as the other, and
      // `ORG_STATUS_ACCESS` would hand a FROZEN tenant an ACTIVE tenant's
      // permissions. There is no separate assertion for that because this one
      // cannot pass without it.
      for (const orgStatus of Object.values(OrgStatus)) {
        expect(fromProtoOrgStatus(toProtoOrgStatus(orgStatus))).toBe(orgStatus);
      }
    });

    it('maps UNSPECIFIED to NULL — there is no safe status to guess', () => {
      // Both defaults are wrong in opposite directions: ACTIVE would let an
      // unset field unfreeze a tenant, FROZEN would lock out a paying one. The
      // caller gets null and decides how to complain, because it knows its own
      // transport.
      expect(fromProtoOrgStatus(ProtoOrgStatus.ORG_STATUS_UNSPECIFIED)).toBe(
        null,
      );
    });

    it('maps UNRECOGNIZED to null too', () => {
      // A status added by a newer build than this one. Guessing it is the same
      // mistake as guessing UNSPECIFIED, with a value nobody can even name.
      expect(fromProtoOrgStatus(ProtoOrgStatus.UNRECOGNIZED)).toBe(null);
    });

    it('maps an unknown string to UNSPECIFIED, never to ACTIVE', () => {
      // `to*` takes a bare string because it usually receives a Prisma VarChar
      // (§7.3). This is the RESPONSE path, so a column holding something
      // unrecognised must surface as unset rather than as full access.
      expect(toProtoOrgStatus('NOT_A_STATUS')).toBe(
        ProtoOrgStatus.ORG_STATUS_UNSPECIFIED,
      );
      expect(toProtoOrgStatus('')).toBe(ProtoOrgStatus.ORG_STATUS_UNSPECIFIED);
    });
  });

  describe('AiModelTier', () => {
    it('round-trips EVERY domain member', () => {
      // A union of string literals rather than an enum, so this iterates
      // `AI_MODEL_TIERS` — the runtime list the type is derived from — for the
      // same reason the SortOrder sweep below does.
      for (const tier of AI_MODEL_TIERS) {
        expect(fromProtoAiModelTier(toProtoAiModelTier(tier))).toBe(tier);
      }
    });

    it('maps UNSPECIFIED to NULL, and this one costs money either way', () => {
      // The tier selects which MODEL answers a tenant's questions. Reading an
      // unset field as FAST silently downgrades a customer who paid for
      // QUALITY; reading it as QUALITY hands the expensive model to everyone.
      // Neither failure produces an error anybody sees.
      expect(
        fromProtoAiModelTier(ProtoAiModelTier.AI_MODEL_TIER_UNSPECIFIED),
      ).toBe(null);
    });

    it('maps UNRECOGNIZED to null too', () => {
      expect(fromProtoAiModelTier(ProtoAiModelTier.UNRECOGNIZED)).toBe(null);
    });

    it('maps an unknown string to UNSPECIFIED, never to the first member', () => {
      // The specific bug worth naming: a lookup falling back to index 0 would
      // put every unrecognised tenant on FAST — a downgrade that reads as a
      // model quality complaint rather than as a mapping bug.
      expect(toProtoAiModelTier('PREMIUM')).toBe(
        ProtoAiModelTier.AI_MODEL_TIER_UNSPECIFIED,
      );
    });
  });

  describe('NotificationPriority', () => {
    it('round-trips EVERY domain member', () => {
      // Includes LOW and HIGH, which nothing branches on yet (18-doc §8). A
      // level that behaves as NORMAL today still has to SURVIVE the round trip
      // — otherwise the day something starts branching on HIGH, the values were
      // never really stored.
      for (const priority of Object.values(NotificationPriority)) {
        expect(
          fromProtoNotificationPriority(toProtoNotificationPriority(priority)),
        ).toBe(priority);
      }
    });

    it('keeps CRITICAL distinct from every other level', () => {
      // The one level that already MEANS something: it bypasses quiet hours and
      // digest batching. Round-trip covers this, but it is asserted directly
      // because the failure is silent in the worst way — an alert meant to wake
      // someone arriving as an ordinary row they see the next morning.
      const wire = toProtoNotificationPriority(NotificationPriority.CRITICAL);

      expect(wire).toBe(
        ProtoNotificationPriority.NOTIFICATION_PRIORITY_CRITICAL,
      );
      expect(wire).not.toBe(
        ProtoNotificationPriority.NOTIFICATION_PRIORITY_NORMAL,
      );
      expect(fromProtoNotificationPriority(wire)).toBe(
        NotificationPriority.CRITICAL,
      );
    });

    it('maps UNSPECIFIED to NULL, never to NORMAL', () => {
      // Both directions of guessing are wrong: NORMAL silently mutes an alert,
      // CRITICAL wakes everyone. Null makes the caller decide.
      expect(
        fromProtoNotificationPriority(
          ProtoNotificationPriority.NOTIFICATION_PRIORITY_UNSPECIFIED,
        ),
      ).toBe(null);
    });

    it('maps UNRECOGNIZED to null too', () => {
      expect(
        fromProtoNotificationPriority(ProtoNotificationPriority.UNRECOGNIZED),
      ).toBe(null);
    });

    it('maps an unknown string to UNSPECIFIED, never to a level', () => {
      // `notifications.priority` is a VarChar defaulting to "NORMAL" (§7.3), so
      // this receives whatever is in the column. An unrecognised value must
      // surface as unset rather than as a plausible-looking level.
      expect(toProtoNotificationPriority('URGENT')).toBe(
        ProtoNotificationPriority.NOTIFICATION_PRIORITY_UNSPECIFIED,
      );
      expect(toProtoNotificationPriority('')).toBe(
        ProtoNotificationPriority.NOTIFICATION_PRIORITY_UNSPECIFIED,
      );
    });
  });

  describe('NotificationChannel', () => {
    it('round-trips EVERY domain member', () => {
      // Driven off the domain enum, so a channel added to Table 24 without a
      // proto member fails here rather than reaching a user as UNSPECIFIED.
      // WEBHOOK is included deliberately: it is not a valid PREFERENCE, but it
      // is a real channel, and the mapper's job is the type, not the policy.
      for (const channel of Object.values(NotificationChannel)) {
        expect(
          fromProtoNotificationChannel(toProtoNotificationChannel(channel)),
        ).toBe(channel);
      }
    });

    it('maps UNSPECIFIED to NULL, never to a channel', () => {
      // Defaulting to IN_APP would deliver a notification down a transport the
      // sender never named.
      expect(
        fromProtoNotificationChannel(
          ProtoNotificationChannel.NOTIFICATION_CHANNEL_UNSPECIFIED,
        ),
      ).toBe(null);
    });

    it('maps an unknown string to UNSPECIFIED, never to a channel', () => {
      // The `to*` direction takes a bare string because it usually receives a
      // Prisma VarChar (§7.3). A column holding something unrecognised must
      // surface as unset rather than as a plausible-looking EMAIL.
      expect(toProtoNotificationChannel('CARRIER_PIGEON')).toBe(
        ProtoNotificationChannel.NOTIFICATION_CHANNEL_UNSPECIFIED,
      );
    });
  });

  describe('DigestMode', () => {
    it('round-trips EVERY domain member', () => {
      for (const digest of Object.values(DigestMode)) {
        expect(fromProtoDigestMode(toProtoDigestMode(digest))).toBe(digest);
      }
    });

    it('maps UNSPECIFIED to NULL, which is what makes the PATCH safe', () => {
      // Load-bearing rather than incidental: an UpdatePreference that omits
      // `digest` arrives as UNSPECIFIED, and the service leaves the stored
      // value alone only because this reads as "absent". Reading it as
      // IMMEDIATE would switch a user off a digest they chose, on a request
      // that never mentioned it.
      expect(fromProtoDigestMode(ProtoDigestMode.DIGEST_MODE_UNSPECIFIED)).toBe(
        null,
      );
    });

    it('maps UNRECOGNIZED to null too', () => {
      expect(fromProtoDigestMode(ProtoDigestMode.UNRECOGNIZED)).toBe(null);
    });
  });

  describe('PreferenceSource', () => {
    it('round-trips EVERY domain member', () => {
      for (const source of Object.values(PreferenceSource)) {
        expect(fromProtoPreferenceSource(toProtoPreferenceSource(source))).toBe(
          source,
        );
      }
    });

    it('maps UNSPECIFIED to NULL rather than to `default`', () => {
      // The tempting default is exactly the wrong one. `DEFAULT` means "no row
      // exists", which the UI renders as inherited — so reading an unset field
      // that way would tell a user their explicit choice was never saved.
      expect(
        fromProtoPreferenceSource(
          ProtoPreferenceSource.PREFERENCE_SOURCE_UNSPECIFIED,
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
      //
      // Asserted against `DEFAULT_SEARCH.SORT_ORDER` rather than `toBeDefined`,
      // which every possible return value satisfies. The two ends have to agree
      // on WHICH direction, not merely that there is one: a gateway defaulting
      // to ASC while a service defaults to DESC gives a client a first page
      // that changes depending on who answered.
      expect(fromProtoSortOrder(ProtoSortOrder.SORT_ORDER_UNSPECIFIED)).toBe(
        DEFAULT_SEARCH.SORT_ORDER,
      );
    });

    it('maps UNRECOGNIZED to the default direction as well', () => {
      expect(fromProtoSortOrder(ProtoSortOrder.UNRECOGNIZED)).toBe(
        DEFAULT_SEARCH.SORT_ORDER,
      );
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

  describe('clampLimit', () => {
    // Exported precisely because the gateway DTO is not the only door: a
    // service is reachable from other services over gRPC, where no
    // ValidationPipe ever ran. An unclamped `take` there is an unbounded query.
    it('caps a limit above MAX_LIMIT', () => {
      expect(clampLimit(10_000)).toBe(DEFAULT_SEARCH.MAX_LIMIT);
    });

    it('raises a limit below MIN_LIMIT', () => {
      expect(clampLimit(DEFAULT_SEARCH.MIN_LIMIT - 0.5)).toBe(
        DEFAULT_SEARCH.MIN_LIMIT,
      );
    });

    it('reads ZERO as unset and takes the default, not an empty page', () => {
      // proto3's default for an omitted int32 is 0. Clamping it to MIN_LIMIT
      // would be defensible; returning 0 would page forever through nothing,
      // which looks like an empty database rather than a missing field.
      expect(clampLimit(0)).toBe(DEFAULT_SEARCH.LIMIT);
    });

    it('takes the default for negative and non-finite values', () => {
      expect(clampLimit(-5)).toBe(DEFAULT_SEARCH.LIMIT);
      expect(clampLimit(Number.NaN)).toBe(DEFAULT_SEARCH.LIMIT);
      expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SEARCH.LIMIT);
    });

    it('passes an in-range limit through untouched', () => {
      expect(clampLimit(25)).toBe(25);
    });
  });

  describe('normalizePage', () => {
    it('reads ZERO and negatives as unset — pages are 1-based', () => {
      // Note this COERCES where the REST edge REJECTS: `SearchPaginationBase`
      // carries `@Min(1)`, so an HTTP caller sending page 0 gets a 400 and
      // learns about it. This path is the service-to-service one, where there
      // is no response body to explain a rejection and no client to fix.
      expect(normalizePage(0)).toBe(DEFAULT_SEARCH.PAGE);
      expect(normalizePage(-3)).toBe(DEFAULT_SEARCH.PAGE);
      expect(normalizePage(Number.NaN)).toBe(DEFAULT_SEARCH.PAGE);
    });

    it('floors a fractional page rather than passing it to OFFSET', () => {
      // `(page - 1) * limit` with a fractional page produces a fractional
      // OFFSET, which Postgres rejects — a 500 on a query that was one
      // rounding away from being fine.
      expect(normalizePage(2.7)).toBe(2);
    });

    it('passes a valid page through untouched', () => {
      expect(normalizePage(4)).toBe(4);
    });
  });

  describe('toPageMeta', () => {
    const request = (limit: number, page = 1) =>
      toPageRequest({ page, limit, sortBy: 'createdAt', sortOrder: 'DESC' });

    it('keeps itemCount and totalItems DISTINCT on the last page', () => {
      // Conflating them is what makes a paginator show the wrong number of
      // pages: this page holds 3 rows, the result set holds 23.
      const meta = toPageMeta(request(10, 3), 23, 3);

      expect(meta).toMatchObject({
        totalItems: 23,
        itemCount: 3,
        itemsPerPage: 10,
        totalPages: 3,
        currentPage: 3,
      });
    });

    it('computes totalPages from the CLAMPED limit, not the requested one', () => {
      // The subtle one. A caller asking for 10 000 per page gets 100, so 250
      // rows are 3 pages — reporting 1 would tell the client everything is on
      // a page that will only ever return 100 rows.
      const meta = toPageMeta(request(10_000), 250, 100);

      expect(meta.itemsPerPage).toBe(DEFAULT_SEARCH.MAX_LIMIT);
      expect(meta.totalPages).toBe(3);
    });

    it('normalizes currentPage through the same rule as the query', () => {
      // If the envelope reported a different page than the one that was
      // actually queried, a client would page from the wrong place.
      expect(toPageMeta(request(10, 0), 5, 5).currentPage).toBe(
        DEFAULT_SEARCH.PAGE,
      );
    });

    it('reports ZERO pages for an empty result set, never one empty page', () => {
      // `Math.ceil(0 / limit)` is 0. A hard-coded floor of 1 would tell a
      // client there is a page to fetch, and it would fetch it.
      expect(toPageMeta(request(10), 0, 0)).toMatchObject({
        totalItems: 0,
        itemCount: 0,
        totalPages: 0,
      });
    });
  });
});
