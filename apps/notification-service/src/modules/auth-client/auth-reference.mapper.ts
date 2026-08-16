/**
 * A recipient, with everything needed to DECIDE about them.
 *
 * The quiet-hours fields ride along on this read rather than needing a second
 * one: an extra round trip per notification to learn whether it is
 * 3am for the recipient would put a cross-service read on the fan-out path.
 */
export type NotificationRecipient = {
  userId: string;
  email: string;
  fullName: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string | null;
};

/**
 * Wire → domain, with `undefined` normalised to `null`.
 *
 * proto3 `optional` arrives as `undefined` when unset, and the rest of this
 * service uses `null` for "not configured". One shape, decided here, so a
 * quiet-hours check never has to handle both.
 */
export function toNotificationRecipient(holder: {
  userId: string;
  email: string;
  fullName: string;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;
}): NotificationRecipient {
  return {
    userId: holder.userId,
    email: holder.email,
    fullName: holder.fullName,
    quietHoursStart: holder.quietHoursStart ?? null,
    quietHoursEnd: holder.quietHoursEnd ?? null,
    timezone: holder.timezone ?? null,
  };
}
