import {
  NOTIFICATION_TYPE_VALUES,
  NotificationChannel,
  PREFERENCE_CHANNELS,
} from './notification.contract';

describe('the notification contract', () => {
  it('**PREFERENCE_CHANNELS never contains WEBHOOK**', () => {
    // The omission used to be guarded by nothing — no comment on the list, no
    // test — and the two comments that existed both said "unimplemented",
    // which the implementation made false. The durable reason: a webhook
    // endpoint belongs to the ORGANIZATION, so a per-user preference over it
    // would either do nothing or silently break the whole tenant's
    // integration. Whoever turns this red is choosing to build that setting,
    // and should have to argue with this sentence to do it.
    expect(PREFERENCE_CHANNELS).not.toContain(NotificationChannel.WEBHOOK);

    // The control: the list is the other four, so an emptied list cannot pass
    // the assertion above by accident.
    expect([...PREFERENCE_CHANNELS].sort()).toEqual(
      [
        NotificationChannel.IN_APP,
        NotificationChannel.EMAIL,
        NotificationChannel.SMS,
        NotificationChannel.PUSH,
      ].sort(),
    );
  });

  it('every notification type is a dotted subject-style string', () => {
    // The vocabulary is also the WEBHOOK payload's public `type` field, so a
    // member that drifted from the `noun.verb` shape would land in customer
    // parsers. Loose on depth, strict on charset.
    for (const type of NOTIFICATION_TYPE_VALUES) {
      expect(type).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
    }
    expect(NOTIFICATION_TYPE_VALUES.length).toBeGreaterThanOrEqual(10);
  });
});
