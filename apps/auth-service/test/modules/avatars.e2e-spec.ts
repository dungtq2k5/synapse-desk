import {
  avatarObjectPath,
  compareAlphabetically,
  isStorageObjectPath,
  SupersededReason,
} from '@synapsedesk/common';
import { randomUUID } from 'node:crypto';
import {
  E2eFixture,
  bootstrapE2eTest,
  requestOrigin,
  signedUrlFor,
  superuser,
} from '../utils';
import { seedTenantWithUser } from '../factories';
import { UsersService } from '../../src/modules/users/users.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { FirebaseService } from '../../src/modules/firebase/firebase.service';

/**
 * §2.1–§2.3 of the storage validation checklist — `users.avatar_url` end to end.
 *
 * This file exists because the checklist found the avatar path had ONE
 * incidental test reference against the attachment path's fifty-eight, and that
 * asymmetry is precisely why two defects survived in it: the wire value was a
 * raw object path nothing ever resolved, and Google sign-in wrote a foreign CDN
 * URL into the same column.
 *
 * The storage boundary is stubbed in the bootstrap (see `E2eFixture.storage`),
 * so these assert auth-service's USE of storage — which is where both defects
 * were. storage-service's own suite proves the storage layer itself.
 */
describe('§2 avatar_url end to end (e2e)', () => {
  let fx: E2eFixture;
  let users: UsersService;
  let auth: AuthService;

  /** A stored avatar for `userId`, in the shape storage-service would produce. */
  const storedAvatar = (organizationId: string, userId: string) =>
    avatarObjectPath(organizationId, userId, `${randomUUID()}.png`);

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    users = fx.moduleRef.get(UsersService);
    auth = fx.moduleRef.get(AuthService);
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  // --------------------------------------------------------------- read path

  describe('the read path resolves paths into URLs — §2.1', () => {
    it('1. getCurrentUser returns a SIGNED URL, never the object path', async () => {
      // The headline defect: `resolveAvatarUrls` existed and nothing called it,
      // so every response carrying a user shipped `organizations/{org}/...`
      // verbatim. A client cannot render that, and it publishes the internal
      // path scheme to every API consumer.
      const t = await seedTenantWithUser(fx.prisma);
      const path = storedAvatar(t.org.id, t.user.id);
      await fx.prisma.user.update({
        where: { id: t.user.id },
        data: { avatarUrl: path },
      });

      const result = await users.getCurrentUser(t.user.id);

      expect(result.user!.avatarUrl).toBe(signedUrlFor(path));
      expect(result.user!.avatarUrl).not.toBe(path);
      expect(isStorageObjectPath(result.user!.avatarUrl!)).toBe(false);
    });

    it('2. listUsers resolves a whole page in ONE batched storage call', async () => {
      // The N+1 that `getSignedReadUrls` taking a LIST exists to prevent. A
      // per-row resolve would still produce correct output, so only the call
      // count can catch it.
      const t = await seedTenantWithUser(fx.prisma);
      const paths: string[] = [];
      for (let i = 0; i < 3; i++) {
        const other = await fx.prisma.user.create({
          data: {
            organizationId: t.org.id,
            email: `avatar-${i}@example.com`,
            fullName: `Avatar ${i}`,
          },
          select: { id: true },
        });
        const path = storedAvatar(t.org.id, other.id);
        paths.push(path);
        await fx.prisma.user.update({
          where: { id: other.id },
          data: { avatarUrl: path },
        });
      }
      fx.storage.resolveReadUrls.mockClear();

      const { items } = await users.listUsers(
        { page: undefined, includeDeleted: false },
        superuser(t),
      );

      expect(fx.storage.resolveReadUrls).toHaveBeenCalledTimes(1);
      // Every stored path went into that single call...
      const [requested] = fx.storage.resolveReadUrls.mock.calls[0] as [
        string[],
      ];
      expect([...requested].sort(compareAlphabetically)).toEqual(
        [...paths].sort(compareAlphabetically),
      );
      // ...and every rendered row carries a URL, not a path.
      const rendered = items
        .map((item) => item.user!.avatarUrl)
        .filter((url): url is string => !!url);
      expect(rendered).toHaveLength(3);
      expect(rendered.every((url) => url.startsWith('https://'))).toBe(true);
    });

    it('3. a user with NO avatar returns undefined, not a signing attempt', async () => {
      // The zero state. Asking storage to sign an empty path is both wasteful
      // and a way to turn "no picture" into an error.
      const t = await seedTenantWithUser(fx.prisma);
      fx.storage.resolveReadUrls.mockClear();

      const result = await users.getCurrentUser(t.user.id);

      expect(result.user!.avatarUrl).toBeUndefined();
      const askedFor = fx.storage.resolveReadUrls.mock.calls.flatMap(
        ([paths]) => paths as string[],
      );
      expect(askedFor).toEqual([]);
    });

    it('4. a path whose object has VANISHED renders absent, never the path', async () => {
      // Graceful degradation, and the property that makes the default-`{}`
      // parameter safe: an unresolved avatar must fail to a missing picture,
      // never to a leaked internal string and never to a 500.
      const t = await seedTenantWithUser(fx.prisma);
      await fx.prisma.user.update({
        where: { id: t.user.id },
        data: { avatarUrl: storedAvatar(t.org.id, t.user.id) },
      });
      // Storage answers with no entry for the path — a deleted object.
      fx.storage.resolveReadUrls.mockResolvedValueOnce({});

      const result = await users.getCurrentUser(t.user.id);

      expect(result.user!.avatarUrl).toBeUndefined();
    });
  });

  // -------------------------------------------------------------- write path

  describe('the write path supersedes exactly once — §1.3', () => {
    it('5. a SECOND confirm supersedes the OLD path, exactly once', async () => {
      // The ordering bug the service comments guard against: reading the column
      // AFTER overwriting it would supersede the avatar just uploaded.
      const t = await seedTenantWithUser(fx.prisma);
      const first = storedAvatar(t.org.id, t.user.id);
      const second = storedAvatar(t.org.id, t.user.id);
      const context = superuser(t);

      await users.confirmAvatarUpload({ objectPath: first }, context);
      fx.storage.emitSuperseded.mockClear();

      await users.confirmAvatarUpload({ objectPath: second }, context);

      expect(fx.storage.emitSuperseded).toHaveBeenCalledTimes(1);
      expect(fx.storage.emitSuperseded).toHaveBeenCalledWith(
        first,
        SupersededReason.REPLACED,
      );
      const row = await fx.prisma.user.findUniqueOrThrow({
        where: { id: t.user.id },
        select: { avatarUrl: true },
      });
      expect(row.avatarUrl).toBe(second);
    });

    it('6. a FIRST-EVER upload supersedes nothing', async () => {
      // The empty-path guard. Emitting here would ask storage-service to delete
      // whatever an empty string resolves to.
      const t = await seedTenantWithUser(fx.prisma);
      fx.storage.emitSuperseded.mockClear();

      await users.confirmAvatarUpload(
        { objectPath: storedAvatar(t.org.id, t.user.id) },
        superuser(t),
      );

      expect(fx.storage.emitSuperseded).not.toHaveBeenCalled();
    });

    it('7. deleteAvatar nulls the column and emits RECORD_DELETED', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const path = storedAvatar(t.org.id, t.user.id);
      const context = superuser(t);
      await users.confirmAvatarUpload({ objectPath: path }, context);
      fx.storage.emitSuperseded.mockClear();

      await users.deleteAvatar(context);

      expect(fx.storage.emitSuperseded).toHaveBeenCalledWith(
        path,
        SupersededReason.RECORD_DELETED,
      );
      const row = await fx.prisma.user.findUniqueOrThrow({
        where: { id: t.user.id },
        select: { avatarUrl: true },
      });
      expect(row.avatarUrl).toBeNull();
    });
  });

  // ------------------------------------------------- the column's ONE meaning

  describe('avatar_url holds an object path and nothing else — §2.2', () => {
    it('8. Google sign-in does NOT store the provider’s CDN URL', async () => {
      // Pins the §2.2(a) decision so it cannot silently revert. Storing
      // `https://lh3.googleusercontent.com/...` here made the column mean two
      // things: `organizationIdFromObjectPath` returns null for it, so the
      // tenant check silently passes nothing, and replacing such an avatar sent
      // an external URL to storage-service's delete path.
      const email = 'avatar-check@google-signin.test';
      const firebase = fx.moduleRef.get<{
        verifyGoogleIdToken: (t: string) => Promise<unknown>;
      }>(FirebaseService);
      jest.spyOn(firebase, 'verifyGoogleIdToken').mockResolvedValue({
        email,
        fullName: 'Google User',
        // The provider offers one, and we decline to store it.
        avatarUrl: 'https://lh3.googleusercontent.com/a/whatever',
        emailVerified: true,
      });

      await auth.googleSignIn({ idToken: 'stub' }, requestOrigin());

      const created = await fx.prisma.user.findFirstOrThrow({
        where: { email },
        select: { avatarUrl: true },
      });
      expect(created.avatarUrl).toBeNull();
    });

    it('9. EVERY value the service writes to avatar_url is an object path', async () => {
      // The permanent version of test 8. Exercises every path that can write
      // the column and asserts the invariant over the table, so a future writer
      // — a new provider, a bulk import — is caught without needing its own
      // test.
      const t = await seedTenantWithUser(fx.prisma);
      const context = superuser(t);

      await users.confirmAvatarUpload(
        { objectPath: storedAvatar(t.org.id, t.user.id) },
        context,
      );
      await users.updateOwnProfile({ fullName: 'Renamed' }, context);
      await users.updateUser(
        { id: t.user.id, fullName: 'Renamed Again' },
        context,
      );

      // Both Google paths too — account CREATION and the backfill on a
      // subsequent sign-in are separate writers, and each was a way in for a
      // CDN URL. Without these the sweep would silently not cover §2.2.
      const firebase = fx.moduleRef.get<{
        verifyGoogleIdToken: (token: string) => Promise<unknown>;
      }>(FirebaseService);
      jest.spyOn(firebase, 'verifyGoogleIdToken').mockResolvedValue({
        email: 'sweep@google-signin.test',
        fullName: 'Sweep User',
        avatarUrl: 'https://lh3.googleusercontent.com/a/sweep',
        emailVerified: true,
      });
      await auth.googleSignIn({ idToken: 'stub' }, requestOrigin());
      // Second sign-in: the account now exists, so this takes the backfill path.
      await auth.googleSignIn({ idToken: 'stub' }, requestOrigin());

      const stored = await fx.prisma.user.findMany({
        where: { avatarUrl: { not: null } },
        select: { avatarUrl: true },
      });

      expect(stored.length).toBeGreaterThan(0);
      expect(
        stored.filter((row) => !isStorageObjectPath(row.avatarUrl!)),
      ).toEqual([]);
    });
  });
});
