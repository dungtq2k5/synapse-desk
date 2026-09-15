import { status } from '@grpc/grpc-js';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { memberContext } from '@synapsedesk/common/testing/context';
import {
  DeliverySkipReason,
  DeliveryStatus,
  DigestMode,
  NOTIFICATION_TYPES,
  NotificationChannel,
  NotificationPriority,
  PREFERENCE_WILDCARD_TYPE,
  PreferenceSource,
} from '@synapsedesk/common';
import {
  DigestMode as ProtoDigestMode,
  NotificationChannel as ProtoNotificationChannel,
  PreferenceSource as ProtoPreferenceSource,
} from '@synapsedesk/grpc-proto';
import { bootstrapE2eTest, E2eFixture } from '../utils/bootstrap';
import { PreferenceResolver } from '../../src/modules/preferences/preference-resolver.service';
import { PreferencesService } from '../../src/modules/preferences/preferences.service';
import { InAppNotificationService } from '../../src/modules/in-app/in-app-notification.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { EmailService } from '../../src/modules/email/email.service';

/**
 * Preferences and quiet hours.
 *
 * **The section most likely to be deferred and least safe to defer.** The producers turn
 * on the volume; this is the only thing that lets a user survive it, and a user
 * who disables notifications in week one is not recovered by shipping
 * preferences in week three.
 *
 * Every suppression here writes a `SKIPPED` delivery row. *"I never got
 * notified"* is unanswerable without one, and it is the single most common
 * support question this feature will generate.
 */
describe('Preferences and quiet hours (e2e)', () => {
  let fx: E2eFixture;
  let resolver: PreferenceResolver;
  let preferences: PreferencesService;
  let inApp: InAppNotificationService;

  let listPermissionHolders: jest.SpyInstance;
  let sendEmail: jest.SpyInstance;

  const ORG = '11111111-1111-4111-8111-111111111111';
  const ME = '22222222-2222-4222-8222-222222222222';

  const me = () => memberContext({ id: ME, organizationId: ORG });

  /** A recipient whose quiet hours the test controls. */
  const recipient = (overrides: Record<string, unknown> = {}) => ({
    userId: ME,
    email: 'me@tenant.test',
    fullName: 'Me',
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: null,
    ...overrides,
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    resolver = fx.moduleRef.get(PreferenceResolver);
    preferences = fx.moduleRef.get(PreferencesService);
    inApp = fx.moduleRef.get(InAppNotificationService);

    listPermissionHolders = jest.spyOn(
      fx.moduleRef.get(AuthReferenceService),
      'listPermissionHolders',
    );
    sendEmail = jest.spyOn(fx.moduleRef.get(EmailService), 'send');
  });

  beforeEach(async () => {
    await fx.reset();
    jest.clearAllMocks();

    listPermissionHolders.mockResolvedValue([recipient()]);
    sendEmail.mockResolvedValue({ messageId: '<sent@synapsedesk>' });
  });

  afterAll(async () => {
    await fx.close();
  });

  const criticalAlert = (overrides = {}) => ({
    organizationId: ORG,
    type: NOTIFICATION_TYPES.quotaThreshold,
    audience: {
      kind: 'permission' as const,
      permission: 'organization.update',
    },
    eventId: `quota:${ORG}:100`,
    title: 'AI budget 100% used',
    body: 'Every self-service question now routes to your agents.',
    priority: NotificationPriority.CRITICAL,
    occurredAt: new Date().toISOString(),
    ...overrides,
  });

  async function setPreference(
    type: string,
    channel: NotificationChannel,
    data: { isEnabled?: boolean; digest?: DigestMode } = {},
  ) {
    await fx.prisma.notificationPreference.create({
      data: {
        userId: ME,
        organizationId: ORG,
        type,
        channel,
        isEnabled: data.isEnabled ?? true,
        digest: data.digest ?? DigestMode.IMMEDIATE,
      },
    });
  }

  describe('resolution order — exact beats wildcard beats default', () => {
    it('1. A user with NO rows receives everything', async () => {
      // Defaults must be permissive: a missing row is not an opt-out, and the
      // opposite default would make the feature look broken to every new
      // account.
      const resolved = await resolver.resolveOne(
        ME,
        NOTIFICATION_TYPES.ticketAssigned,
        NotificationChannel.EMAIL,
      );

      expect(resolved).toMatchObject({
        isEnabled: true,
        digest: DigestMode.IMMEDIATE,
        source: PreferenceSource.DEFAULT,
      });
    });

    it('2. A WILDCARD row beats the default', async () => {
      await setPreference(PREFERENCE_WILDCARD_TYPE, NotificationChannel.EMAIL, {
        isEnabled: false,
      });

      const resolved = await resolver.resolveOne(
        ME,
        NOTIFICATION_TYPES.ticketAssigned,
        NotificationChannel.EMAIL,
      );

      expect(resolved).toMatchObject({
        isEnabled: false,
        source: PreferenceSource.WILDCARD,
      });
    });

    it('3. An EXACT row beats the wildcard', async () => {
      // The combination a user actually builds: "stop emailing me about
      // everything, except the budget."
      await setPreference(PREFERENCE_WILDCARD_TYPE, NotificationChannel.EMAIL, {
        isEnabled: false,
      });
      await setPreference(
        NOTIFICATION_TYPES.quotaThreshold,
        NotificationChannel.EMAIL,
        { isEnabled: true },
      );

      const specific = await resolver.resolveOne(
        ME,
        NOTIFICATION_TYPES.quotaThreshold,
        NotificationChannel.EMAIL,
      );
      const other = await resolver.resolveOne(
        ME,
        NOTIFICATION_TYPES.ticketAssigned,
        NotificationChannel.EMAIL,
      );

      expect(specific).toMatchObject({
        isEnabled: true,
        source: PreferenceSource.EXPLICIT,
      });
      expect(other).toMatchObject({
        isEnabled: false,
        source: PreferenceSource.WILDCARD,
      });
    });

    it('4. A preference on ONE channel does not affect another', async () => {
      await setPreference(PREFERENCE_WILDCARD_TYPE, NotificationChannel.EMAIL, {
        isEnabled: false,
      });

      const inAppChannel = await resolver.resolveOne(
        ME,
        NOTIFICATION_TYPES.ticketAssigned,
        NotificationChannel.IN_APP,
      );

      expect(inAppChannel).toMatchObject({
        isEnabled: true,
        source: PreferenceSource.DEFAULT,
      });
    });
  });

  describe('the settings catalogue', () => {
    it('5. Returns every (type, channel) pair RESOLVED, not the stored rows', async () => {
      // A settings screen built from stored rows shows a new user an empty
      // page, which reads as "notifications are off".
      const { items } = await preferences.list(me());

      expect(items.length).toBeGreaterThan(0);
      expect(
        items.every(
          (item) =>
            item.source === ProtoPreferenceSource.PREFERENCE_SOURCE_DEFAULT,
        ),
      ).toBe(true);
      // The wildcard is its own entry rather than folded away: it is the
      // control a user reaches for, and hiding it would leave them turning off
      // eighteen switches one at a time.
      expect(items.some((item) => item.type === PREFERENCE_WILDCARD_TYPE)).toBe(
        true,
      );
    });

    it('6. Marks an explicitly set pair as `explicit`, so the UI can say "inherited"', async () => {
      await setPreference(
        NOTIFICATION_TYPES.ticketAssigned,
        NotificationChannel.EMAIL,
        { isEnabled: false },
      );

      const { items } = await preferences.list(me());
      const row = items.find(
        (item) =>
          item.type === NOTIFICATION_TYPES.ticketAssigned &&
          item.channel === ProtoNotificationChannel.NOTIFICATION_CHANNEL_EMAIL,
      );

      expect(row).toMatchObject({
        isEnabled: false,
        source: ProtoPreferenceSource.PREFERENCE_SOURCE_EXPLICIT,
      });
    });

    it('7. UPSERTS rather than duplicating — `UNIQUE (user_id, type, channel)`', async () => {
      // A settings screen sends the same pair repeatedly: every toggle is a
      // PATCH, so an insert would collide on the second click.
      await preferences.update(
        {
          type: NOTIFICATION_TYPES.ticketAssigned,
          channel: ProtoNotificationChannel.NOTIFICATION_CHANNEL_EMAIL,
          digest: ProtoDigestMode.DIGEST_MODE_UNSPECIFIED,
          isEnabled: false,
        },
        me(),
      );
      await preferences.update(
        {
          type: NOTIFICATION_TYPES.ticketAssigned,
          channel: ProtoNotificationChannel.NOTIFICATION_CHANNEL_EMAIL,
          digest: ProtoDigestMode.DIGEST_MODE_UNSPECIFIED,
          isEnabled: true,
        },
        me(),
      );

      const rows = await fx.prisma.notificationPreference.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].isEnabled).toBe(true);
    });

    it('8. A PATCH carrying only `isEnabled` does not reset `digest`', async () => {
      // The classic PATCH bug: overwriting the field the request did not
      // mention. Here it would switch a user off a digest they had chosen.
      await preferences.update(
        {
          type: NOTIFICATION_TYPES.ticketAssigned,
          channel: ProtoNotificationChannel.NOTIFICATION_CHANNEL_EMAIL,
          digest: ProtoDigestMode.DIGEST_MODE_DAILY,
        },
        me(),
      );
      await preferences.update(
        {
          type: NOTIFICATION_TYPES.ticketAssigned,
          channel: ProtoNotificationChannel.NOTIFICATION_CHANNEL_EMAIL,
          digest: ProtoDigestMode.DIGEST_MODE_UNSPECIFIED,
          isEnabled: false,
        },
        me(),
      );

      const [row] = await fx.prisma.notificationPreference.findMany();
      expect(row.digest).toBe(DigestMode.DAILY);
      expect(row.isEnabled).toBe(false);
    });

    it('9. REFUSES an unknown type rather than storing it', async () => {
      // A typo'd type is a preference that silences nothing: the row exists,
      // the user believes they turned something off, and every notification
      // still arrives because nothing ever resolves against that string.
      await expectRpc(
        preferences.update(
          {
            type: 'ticket.assinged',
            channel: ProtoNotificationChannel.NOTIFICATION_CHANNEL_EMAIL,
            digest: ProtoDigestMode.DIGEST_MODE_UNSPECIFIED,
            isEnabled: false,
          },
          me(),
        ),
        status.INVALID_ARGUMENT,
      );

      await expect(fx.prisma.notificationPreference.count()).resolves.toBe(0);
    });

    it('10. REFUSES the WEBHOOK channel, which controls nothing', async () => {
      // In the enum for completeness and deliberately unimplemented (
      // It is deferred, so a preference for it would be a switch wired to nothing.
      await expectRpc(
        preferences.update(
          {
            type: PREFERENCE_WILDCARD_TYPE,
            channel: ProtoNotificationChannel.NOTIFICATION_CHANNEL_WEBHOOK,
            digest: ProtoDigestMode.DIGEST_MODE_UNSPECIFIED,
            isEnabled: false,
          },
          me(),
        ),
        status.INVALID_ARGUMENT,
      );
    });
  });

  describe('suppression is AUDITABLE, never silent', () => {
    it('11. A disabled (type, channel) writes SKIPPED with `user_preference`', async () => {
      await setPreference(
        NOTIFICATION_TYPES.quotaThreshold,
        NotificationChannel.EMAIL,
        { isEnabled: false },
      );

      await inApp.deliver(criticalAlert());

      const [delivery] = await fx.prisma.notificationDelivery.findMany({
        where: { channel: NotificationChannel.EMAIL },
      });

      expect(delivery.status).toBe(DeliveryStatus.SKIPPED);
      expect(delivery.skipReason).toBe(DeliverySkipReason.USER_PREFERENCE);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('12. QUIET HOURS suppress a NORMAL notification and write a reason', async () => {
      const decision = await resolver.resolve({
        userId: ME,
        organizationId: ORG,
        type: NOTIFICATION_TYPES.ticketAssigned,
        channel: NotificationChannel.EMAIL,
        priority: NotificationPriority.NORMAL,
        quietHours: {
          quietHoursStart: '22:00',
          quietHoursEnd: '07:00',
          timezone: 'UTC',
        },
        now: new Date('2026-08-06T03:00:00.000Z'),
      });

      expect(decision).toEqual({
        allowed: false,
        reason: DeliverySkipReason.QUIET_HOURS,
      });
    });

    it('13. **CRITICAL bypasses quiet hours**', async () => {
      // RDM §1.14: the 100% budget alert is `CRITICAL` precisely so a tenant
      // does not discover the cap from the queue at 9am.
      const decision = await resolver.resolve({
        userId: ME,
        organizationId: ORG,
        type: NOTIFICATION_TYPES.quotaThreshold,
        channel: NotificationChannel.EMAIL,
        priority: NotificationPriority.CRITICAL,
        quietHours: {
          quietHoursStart: '22:00',
          quietHoursEnd: '07:00',
          timezone: 'UTC',
        },
        now: new Date('2026-08-06T03:00:00.000Z'),
      });

      expect(decision.allowed).toBe(true);
    });

    it('14. CRITICAL does NOT bypass an explicit opt-out', async () => {
      // A user who turned a channel off chose that. Overriding it would make
      // the setting a suggestion, and a setting that is a suggestion is one
      // people stop trusting.
      await setPreference(
        NOTIFICATION_TYPES.quotaThreshold,
        NotificationChannel.EMAIL,
        { isEnabled: false },
      );

      const decision = await resolver.resolve({
        userId: ME,
        organizationId: ORG,
        type: NOTIFICATION_TYPES.quotaThreshold,
        channel: NotificationChannel.EMAIL,
        priority: NotificationPriority.CRITICAL,
      });

      expect(decision).toEqual({
        allowed: false,
        reason: DeliverySkipReason.USER_PREFERENCE,
      });
    });

    it('15. Quiet hours are evaluated in the USER’s timezone, not the server’s', async () => {
      // The bug that reaches production if the fixture only ever uses UTC. At
      // 18:00 UTC it is 01:00 for this user — inside their window — and the
      // middle of the afternoon for the server.
      const quietHours = {
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        timezone: 'Asia/Ho_Chi_Minh',
      };
      const now = new Date('2026-08-06T18:00:00.000Z');

      const theirs = await resolver.resolve({
        userId: ME,
        organizationId: ORG,
        type: NOTIFICATION_TYPES.ticketAssigned,
        channel: NotificationChannel.EMAIL,
        priority: NotificationPriority.NORMAL,
        quietHours,
        now,
      });
      const serverZone = await resolver.resolve({
        userId: ME,
        organizationId: ORG,
        type: NOTIFICATION_TYPES.ticketAssigned,
        channel: NotificationChannel.EMAIL,
        priority: NotificationPriority.NORMAL,
        quietHours: { ...quietHours, timezone: 'UTC' },
        now,
      });

      expect(theirs.allowed).toBe(false);
      expect(serverZone.allowed).toBe(true);
    });

    it('16. A user with no quiet hours configured receives everything', async () => {
      const decision = await resolver.resolve({
        userId: ME,
        organizationId: ORG,
        type: NOTIFICATION_TYPES.ticketAssigned,
        channel: NotificationChannel.EMAIL,
        priority: NotificationPriority.NORMAL,
        quietHours: {
          quietHoursStart: null,
          quietHoursEnd: null,
          timezone: null,
        },
        now: new Date('2026-08-06T03:00:00.000Z'),
      });

      expect(decision.allowed).toBe(true);
    });
  });
});
