import { avatarObjectPath } from '@synapsedesk/contracts';
import * as bcrypt from 'bcrypt';
import { E2eFixture, bootstrapE2eTest, superAdminContext } from '../utils';
import {
  TEST_PASSWORD,
  createDeviceSession,
  createTrustedDeviceSession,
  createUserWithPassword,
} from '../factories';
import { AuthService } from '../../src/modules/auth/auth.service';
import { SessionsService } from '../../src/modules/sessions/sessions.service';
import { UsersService } from '../../src/modules/users/users.service';

/**
 * A Super Admin's own account: the `/profile` and `/security` pages.
 *
 * A Super Admin has no tenant, so a scoped client refuses them; each of these
 * reads and writes only the caller's own rows, through
 * `unscoped('own account')`. One row per method, so a method left on the
 * scoped client fails its own row.
 */
describe('a Super Admin’s own account (e2e)', () => {
  let fx: E2eFixture;
  let auth: AuthService;
  let sessions: SessionsService;
  let users: UsersService;
  let superAdminId: string;
  const asSuperAdmin = () => superAdminContext(superAdminId);

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    auth = fx.moduleRef.get(AuthService);
    sessions = fx.moduleRef.get(SessionsService);
    users = fx.moduleRef.get(UsersService);
  });

  beforeEach(async () => {
    await fx.reset();
    // Minted here, not the seeded one: `reset` keeps the two seeded accounts as
    // they are, so a change made to one would outlive this file.
    superAdminId = (
      await createUserWithPassword(fx.prisma, {
        organizationId: null,
        isSuperAdmin: true,
      })
    ).id;
  });

  afterAll(() => fx.close());

  const ownRow = () =>
    fx.prisma.user.findUniqueOrThrow({ where: { id: superAdminId } });

  it('changes their password', async () => {
    await auth.changePassword(
      { currentPassword: TEST_PASSWORD, newPassword: 'BrandNew1!x' }, // NOSONAR
      asSuperAdmin(),
    );

    const { passwordHash } = await ownRow();
    expect(await bcrypt.compare('BrandNew1!x', passwordHash!)).toBe(true);
  });

  it('lists their sessions', async () => {
    const { session } = await createDeviceSession(fx.prisma, superAdminId);

    const list = await sessions.listSessions(
      { refreshToken: '' },
      asSuperAdmin(),
    );

    expect(list.items.map((item) => item.id)).toEqual([session.id]);
  });

  it('revokes a session', async () => {
    const { session } = await createDeviceSession(fx.prisma, superAdminId);

    await sessions.revokeSession({ sessionId: session.id }, asSuperAdmin());

    expect(
      await fx.prisma.deviceSession.count({ where: { id: session.id } }),
    ).toBe(0);
  });

  it('drops trust on one device', async () => {
    const { session } = await createTrustedDeviceSession(
      fx.prisma,
      superAdminId,
    );

    await sessions.revokeSessionTrust(
      { sessionId: session.id },
      asSuperAdmin(),
    );

    const row = await fx.prisma.deviceSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(row.isTrusted).toBe(false);
  });

  it('drops trust on every device', async () => {
    await createTrustedDeviceSession(fx.prisma, superAdminId);

    const { untrustedCount } = await sessions.revokeAllTrust(asSuperAdmin());

    expect(untrustedCount).toBe(1);
  });

  it('updates their profile', async () => {
    await users.updateOwnProfile(
      { fullName: 'Platform Owner' },
      asSuperAdmin(),
    );

    expect((await ownRow()).fullName).toBe('Platform Owner');
  });

  const avatar = () => avatarObjectPath('platform', superAdminId, 'face.png');

  it('sets their avatar', async () => {
    await users.confirmAvatarUpload({ objectPath: avatar() }, asSuperAdmin());

    expect((await ownRow()).avatarUrl).toBe(avatar());
  });

  it('removes their avatar', async () => {
    await fx.prisma.user.update({
      where: { id: superAdminId },
      data: { avatarUrl: avatar() },
    });

    await users.deleteAvatar(asSuperAdmin());

    expect((await ownRow()).avatarUrl).toBeNull();
  });
});
