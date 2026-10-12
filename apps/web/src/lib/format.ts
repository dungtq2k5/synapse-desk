const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * A past moment as the list and thread show it: "Just now", "5 min ago",
 * "2 hr ago", "Yesterday", "3 days ago", "Last week", then "10 Oct".
 *
 * @example relativeTime('2026-10-12T09:00:00Z', new Date('2026-10-12T09:05:00Z')) // '5 min ago'
 */
export function relativeTime(
  at: string | Date,
  now: Date = new Date(),
  timeZone?: string,
): string {
  const then = new Date(at);
  const minutes = Math.floor((now.getTime() - then.getTime()) / MINUTE);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;

  const days = calendarDays(then, now, timeZone);
  if (days === 0) return `${Math.floor(minutes / 60)} hr ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(then);
}

/** Whole calendar days between two moments, in the viewer's zone. */
function calendarDays(from: Date, to: Date, timeZone?: string): number {
  const day = (date: Date) => {
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone })
      .format(date)
      .split('-')
      .map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((day(to) - day(from)) / DAY);
}

/**
 * A moment in full, as the ticket's details and every tooltip show it.
 *
 * @example absoluteTime('2026-10-10T09:12:00Z', 'UTC') // '10 Oct 2026, 09:12'
 */
export function absoluteTime(at: string | Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(at));
}

/**
 * A moment's time of day, as a message header shows it.
 *
 * @example clockTime('2026-10-10T09:12:00Z', 'UTC') // '09:12'
 */
export function clockTime(at: string | Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(at));
}

/**
 * A file's size on an attachment chip.
 *
 * @example fileSize(217_088) // '212 KB'
 * @example fileSize(1_258_291) // '1.2 MB'
 */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A name's initials, for an avatar with no picture.
 *
 * @example initials('Maya Chen') // 'MC'
 */
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((part) => part[0]?.toUpperCase() ?? '').join('');
}

/**
 * A name's first word, for "Write a reply to Priya…".
 *
 * @example firstName('Priya Shah') // 'Priya'
 */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
