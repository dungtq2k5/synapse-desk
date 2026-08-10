/**
 * Quiet hours, evaluated in the USER'S timezone — 18-doc §4.
 *
 * Two things here are easy to get wrong and both reach production:
 *
 *   1. **A window that crosses midnight.** 22:00–07:00 is the common case, and
 *      the naive `start <= now < end` is false for every minute of it — so
 *      quiet hours silently do nothing for exactly the users who bothered to
 *      set them.
 *
 *   2. **The server's timezone.** A fixture that only ever uses UTC passes
 *      against an implementation that never converts, and the bug surfaces as
 *      "I got paged at 4am" from users in one region only.
 *
 * Pure functions, no clock of their own: the caller passes `now`, so the
 * midnight-crossing case is testable without waiting for midnight.
 */

/** `22:00` → 1320. Returns null for anything that is not `HH:mm`. */
export function parseTimeOfDay(value: string | null): number | null {
  if (!value) return null;

  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  // Rejected rather than clamped. A stored "25:00" is corrupt data, and
  // clamping it to 23:59 would silently apply a window nobody chose.
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/**
 * Minutes since midnight for `instant`, in `timeZone`.
 *
 * `Intl.DateTimeFormat` rather than an offset table: it is the only thing in
 * the platform that knows a given zone's DST rules on a given date, and quiet
 * hours are precisely the setting where being an hour out twice a year is
 * indistinguishable from a bug.
 *
 * An unknown zone falls back to UTC rather than throwing. The alternative —
 * letting a bad `timezone` value fail the notification — would lose a message
 * to a settings error.
 */
export function minutesInZone(instant: Date, timeZone: string | null): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone ?? 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(instant);

    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
    const minute = Number(
      parts.find((part) => part.type === 'minute')?.value ?? 0,
    );

    // `en-GB` with hour12:false renders midnight as "24" in some ICU versions.
    return (hour % 24) * 60 + minute;
  } catch {
    return minutesInZone(instant, 'UTC');
  }
}

/**
 * Is `now` inside the user's quiet window?
 *
 * Both ends are required: half a window is not a window, and treating a missing
 * end as "until midnight" would invent a setting the user never chose.
 */
export function isWithinQuietHours(
  now: Date,
  quietHours: {
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    timezone: string | null;
  },
): boolean {
  const start = parseTimeOfDay(quietHours.quietHoursStart);
  const end = parseTimeOfDay(quietHours.quietHoursEnd);

  if (start === null || end === null) return false;

  // A zero-length window means "no quiet hours" rather than "always quiet".
  // The other reading would silence a user permanently because they set the
  // same value twice.
  if (start === end) return false;

  const current = minutesInZone(now, quietHours.timezone);

  // **The midnight-crossing case.** 22:00–07:00 means start > end, and the
  // window is the UNION of the two ends of the day rather than the span
  // between them.
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}
