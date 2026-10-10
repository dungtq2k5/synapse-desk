import {
  isWithinQuietHours,
  minutesInZone,
  parseTimeOfDay,
} from './quiet-hours';

/**
 * Quiet hours.
 *
 * Two bugs here reach production and only one of them is visible in review:
 *
 *   - **A window that crosses midnight.** 22:00–07:00 is the common case, and
 *     the naive `start <= now < end` is false for every minute of it — so
 *     quiet hours silently do nothing for exactly the users who bothered to set
 *     them, which is the worst possible failure distribution.
 *   - **The server's timezone.** A fixture that only ever uses UTC passes
 *     against an implementation that never converts, and the bug surfaces as
 *     "I got paged at 4am" from one region only.
 *
 * A unit spec rather than e2e because the interesting inputs are times of day,
 * and an e2e test cannot wait for 3am.
 */
describe('quiet hours', () => {
  describe('parseTimeOfDay', () => {
    it('parses HH:mm into minutes since midnight', () => {
      expect(parseTimeOfDay('22:00')).toBe(22 * 60);
      expect(parseTimeOfDay('07:30')).toBe(7 * 60 + 30);
      expect(parseTimeOfDay('00:00')).toBe(0);
    });

    it('REJECTS an out-of-range time rather than clamping it', () => {
      // A stored "25:00" is corrupt data. Clamping it to 23:59 would silently
      // apply a window nobody chose, and the user would have no way to tell.
      expect(parseTimeOfDay('25:00')).toBeNull();
      expect(parseTimeOfDay('22:60')).toBeNull();
      expect(parseTimeOfDay('nonsense')).toBeNull();
      expect(parseTimeOfDay(null)).toBeNull();
    });
  });

  describe('minutesInZone', () => {
    it('reads the wall clock in the USER’s zone, not the server’s', () => {
      // 18:00 UTC is 01:00 the next day in Ho Chi Minh City (UTC+7) — the case
      // a UTC-only fixture cannot distinguish from a broken conversion.
      const instant = new Date('2026-08-06T18:00:00.000Z');

      expect(minutesInZone(instant, 'UTC')).toBe(18 * 60);
      expect(minutesInZone(instant, 'Asia/Ho_Chi_Minh')).toBe(60);
      expect(minutesInZone(instant, 'America/New_York')).toBe(14 * 60);
    });

    it('handles the DST offset for the date given, not a fixed one', () => {
      // The reason `Intl` is used rather than an offset table: being an hour
      // out twice a year is indistinguishable from a bug.
      const summer = new Date('2026-07-01T12:00:00.000Z');
      const winter = new Date('2026-01-01T12:00:00.000Z');

      expect(minutesInZone(summer, 'Europe/London')).toBe(13 * 60);
      expect(minutesInZone(winter, 'Europe/London')).toBe(12 * 60);
    });

    it('falls back to UTC for an unknown zone rather than throwing', () => {
      // Letting a bad `timezone` value fail the notification would lose a
      // message to a settings error.
      expect(
        minutesInZone(new Date('2026-08-06T09:00:00.000Z'), 'Mars/Olympus'),
      ).toBe(9 * 60);
    });

    it('treats a NULL zone as UTC', () => {
      expect(minutesInZone(new Date('2026-08-06T09:00:00.000Z'), null)).toBe(
        9 * 60,
      );
    });
  });

  describe('isWithinQuietHours', () => {
    const utc = (start: string | null, end: string | null) => ({
      quietHoursStart: start,
      quietHoursEnd: end,
      timezone: 'UTC',
    });

    it('is false when no window is configured', () => {
      expect(
        isWithinQuietHours(
          new Date('2026-08-06T03:00:00.000Z'),
          utc(null, null),
        ),
      ).toBe(false);
    });

    it('is false when only HALF a window is configured', () => {
      // Half a window is not a window. Treating a missing end as "until
      // midnight" would invent a setting the user never chose.
      expect(
        isWithinQuietHours(
          new Date('2026-08-06T23:00:00.000Z'),
          utc('22:00', null),
        ),
      ).toBe(false);
    });

    describe('a SAME-DAY window (09:00-17:00)', () => {
      const window = utc('09:00', '17:00');

      it.each([
        ['08:59', '2026-08-06T08:59:00.000Z', false],
        ['09:00', '2026-08-06T09:00:00.000Z', true],
        ['12:00', '2026-08-06T12:00:00.000Z', true],
        // Exclusive at the end: a window "until 17:00" that still suppressed at
        // 17:00 would be a minute longer than it says.
        ['17:00', '2026-08-06T17:00:00.000Z', false],
        ['23:00', '2026-08-06T23:00:00.000Z', false],
      ])('%s → %s', (_label, instant, expected) => {
        expect(isWithinQuietHours(new Date(instant), window)).toBe(expected);
      });
    });

    describe('**a window CROSSING MIDNIGHT (22:00-07:00)** — the one that breaks', () => {
      const window = utc('22:00', '07:00');

      it.each([
        ['21:59, just before', '2026-08-06T21:59:00.000Z', false],
        ['22:00, the boundary', '2026-08-06T22:00:00.000Z', true],
        ['23:30, before midnight', '2026-08-06T23:30:00.000Z', true],
        ['00:30, after midnight', '2026-08-06T00:30:00.000Z', true],
        ['03:00, the middle of the night', '2026-08-06T03:00:00.000Z', true],
        ['06:59, the last minute', '2026-08-06T06:59:00.000Z', true],
        ['07:00, the boundary', '2026-08-06T07:00:00.000Z', false],
        ['12:00, the middle of the day', '2026-08-06T12:00:00.000Z', false],
      ])('%s', (_label, instant, expected) => {
        // A naive `start <= now < end` returns FALSE for every one of the
        // `true` rows above — so quiet hours would do nothing at all for the
        // window most people actually set.
        expect(isWithinQuietHours(new Date(instant), window)).toBe(expected);
      });
    });

    it('is evaluated in the USER’s timezone', () => {
      // 18:00 UTC is 01:00 in Ho Chi Minh City: inside a 22:00-07:00 window for
      // that user and the middle of the afternoon for a UTC one. The bug that
      // reaches production if the fixture only ever uses UTC.
      const instant = new Date('2026-08-06T18:00:00.000Z');
      const window = { quietHoursStart: '22:00', quietHoursEnd: '07:00' };

      expect(
        isWithinQuietHours(instant, {
          ...window,
          timezone: 'Asia/Ho_Chi_Minh',
        }),
      ).toBe(true);
      expect(isWithinQuietHours(instant, { ...window, timezone: 'UTC' })).toBe(
        false,
      );
    });

    it('treats a ZERO-LENGTH window as no quiet hours, not as always quiet', () => {
      // The other reading would silence a user permanently because they set the
      // same value twice — a setting they would then have to guess at to undo.
      expect(
        isWithinQuietHours(
          new Date('2026-08-06T03:00:00.000Z'),
          utc('22:00', '22:00'),
        ),
      ).toBe(false);
    });

    it('ignores a CORRUPT window rather than applying part of it', () => {
      expect(
        isWithinQuietHours(
          new Date('2026-08-06T03:00:00.000Z'),
          utc('25:00', '07:00'),
        ),
      ).toBe(false);
    });
  });
});
