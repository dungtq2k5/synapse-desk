import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import { StoragePurpose as ProtoStoragePurpose } from '@synapsedesk/grpc-proto';
import {
  compareAlphabetically,
  organizationIdFromObjectPath,
} from '@synapsedesk/common';
import {
  DISGUISED_BYTES,
  E2eFixture,
  bootstrapE2eTest,
  bytesFor,
  memberContext,
} from '../utils';
import { StorageService } from '../../src/modules/storage/storage.service';
import { PendingUploadStore } from '../../src/modules/storage/pending-upload.store';

/**
 * §2.2–2.4 Presign, Confirm and batched read URLs.
 *
 * **The emulator does not honour signed URLs** (it answers 501 — pinned in
 * `bootstrap.e2e-spec.ts`), so the byte upload in these tests goes through the
 * Admin SDK rather than through the returned `uploadUrl`. That is a real gap
 * against §2.2 test 4, and it is worth being precise about what it costs: the
 * SIGNATURE is unproven end-to-end, but everything the signature protects is
 * not. The path construction, the tenant boundary, the PendingUpload lifecycle
 * and the confirm authorization are all exercised against real infra here, and
 * those are where the bugs would be.
 */
describe('§2.2–2.4 Storage presign, confirm and read URLs (e2e)', () => {
  let fx: E2eFixture;
  let storage: StorageService;
  let pendingStore: PendingUploadStore;

  const organizationId = faker.string.uuid();
  const userId = faker.string.uuid();

  const caller = (org: string = organizationId, sub: string = userId) =>
    memberContext({ id: sub, organizationId: org });

  const avatarRequest = (overrides: Record<string, unknown> = {}) => ({
    purpose: ProtoStoragePurpose.STORAGE_PURPOSE_AVATAR,
    ownerId: userId,
    contentType: 'image/png',
    sizeBytes: 1024,
    originalFileName: 'me.png',
    secondaryOwnerId: '',
    ...overrides,
  });

  const attachmentRequest = (overrides: Record<string, unknown> = {}) => ({
    purpose: ProtoStoragePurpose.STORAGE_PURPOSE_TICKET_ATTACHMENT,
    ownerId: faker.string.uuid(),
    contentType: 'application/pdf',
    sizeBytes: 4096,
    originalFileName: 'invoice.pdf',
    secondaryOwnerId: faker.string.uuid(),
    ...overrides,
  });

  /**
   * Puts real bytes at a path, standing in for the client's PUT.
   *
   * The body defaults to content that genuinely IS `contentType` — since
   * §2.4a, `confirmUpload` reads the header and rejects a mismatch, so `'x'`
   * declared as a PNG is now an INVALID_ARGUMENT rather than a valid fixture.
   */
  const putBytes = (
    objectPath: string,
    contentType: string,
    body: Buffer | string = bytesFor(contentType),
  ) =>
    fx.firebase.bucket
      .file(objectPath)
      .save(body, { contentType, resumable: false });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    storage = fx.moduleRef.get(StorageService);
    pendingStore = fx.moduleRef.get(PendingUploadStore);
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  // ------------------------------------------------------------- §2.2 presign

  describe('presignUpload', () => {
    it('1. returns a URL, a scoped path and an expiry, and records the pending upload', async () => {
      const result = await storage.presignUpload(avatarRequest(), caller());

      expect(result.uploadUrl).toContain('X-Goog-Signature=');
      expect(result.objectPath).toMatch(
        new RegExp(`^organizations/${organizationId}/avatars/${userId}/`),
      );
      expect(result.expiresAt).toBeDefined();

      const pending = await pendingStore.get(result.objectPath);
      expect(pending?.organizationId).toBe(organizationId);
      expect(pending?.actorId).toBe(userId);
    });

    it('2. gives the pending record a TTL matching the URL', async () => {
      // The TTL *is* the cleanup — there is no pruning job — so a record
      // written without one would leak forever, and one written with a shorter
      // TTL than the URL would make a legitimate late confirm fail.
      const result = await storage.presignUpload(avatarRequest(), caller());

      const ttl = await fx.redis.ttl(`storage:pending:${result.objectPath}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600);
    });

    it('3. takes the tenant from the CONTEXT, never from the request — §2.2 test 5', async () => {
      // The tenant-boundary assertion, stated as a test rather than only as a
      // rule. A request body is something a caller asserts; the tenant boundary
      // is not theirs to assert.
      const result = await storage.presignUpload(
        avatarRequest({ ownerId: faker.string.uuid() }),
        caller(),
      );

      expect(organizationIdFromObjectPath(result.objectPath)).toBe(
        organizationId,
      );
    });

    it('4. REFUSES a contentType outside the allowlist, writing nothing', async () => {
      await expectRpc(
        storage.presignUpload(
          avatarRequest({ contentType: 'application/x-httpd-php' }),
          caller(),
        ),
        status.INVALID_ARGUMENT,
      );

      expect(await fx.redis.keys('storage:pending:*')).toHaveLength(0);
    });

    it('5. REFUSES a size over the purpose cap', async () => {
      await expectRpc(
        storage.presignUpload(
          avatarRequest({ sizeBytes: 3 * 1024 * 1024 }),
          caller(),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('6. ACCEPTS a size exactly at the cap', async () => {
      // The boundary. Off-by-one here rejects a legal file and nobody notices
      // until a user with a 2 MB avatar complains.
      const result = await storage.presignUpload(
        avatarRequest({ sizeBytes: 2 * 1024 * 1024 }),
        caller(),
      );

      expect(result.objectPath).toBeTruthy();
    });

    it('7. REFUSES a zero-byte upload', async () => {
      await expectRpc(
        storage.presignUpload(avatarRequest({ sizeBytes: 0 }), caller()),
        status.INVALID_ARGUMENT,
      );
    });

    it('8. applies a DIFFERENT policy per purpose', async () => {
      // A pdf is fine as an attachment and not as an avatar. One shared
      // allowlist would make one of those wrong.
      const attachment = await storage.presignUpload(
        attachmentRequest(),
        caller(),
      );
      expect(attachment.objectPath).toContain('/tickets/');

      await expectRpc(
        storage.presignUpload(
          avatarRequest({ contentType: 'application/pdf' }),
          caller(),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('9. builds the ATTACHMENT path from both owner ids', async () => {
      const request = attachmentRequest();
      const result = await storage.presignUpload(request, caller());

      expect(result.objectPath).toContain(
        `organizations/${organizationId}/tickets/${request.ownerId}/attachments/${request.secondaryOwnerId}/`,
      );
    });

    it('10. REFUSES an attachment with no secondary owner', async () => {
      await expectRpc(
        storage.presignUpload(
          attachmentRequest({ secondaryOwnerId: '' }),
          caller(),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('11. derives the extension from the MIME TYPE, not the filename', async () => {
      // `invoice.pdf.php` is a perfectly plausible upload. Taking the extension
      // from the name is how it becomes a `.php` object in a bucket.
      const result = await storage.presignUpload(
        avatarRequest({
          originalFileName: 'evil.php',
          contentType: 'image/png',
        }),
        caller(),
      );

      expect(result.objectPath.endsWith('.png')).toBe(true);
      expect(result.objectPath).not.toContain('php');
    });

    it('12. names the object a UUID, never the original filename', async () => {
      // So the path carries nothing worth protecting, and two people uploading
      // `screenshot.png` on the same day cannot collide.
      const result = await storage.presignUpload(
        avatarRequest({ originalFileName: 'screenshot.png' }),
        caller(),
      );

      expect(result.objectPath).not.toContain('screenshot');
    });

    it('13. produces a DIFFERENT path for two identical requests', async () => {
      const first = await storage.presignUpload(avatarRequest(), caller());
      const second = await storage.presignUpload(avatarRequest(), caller());

      expect(first.objectPath).not.toBe(second.objectPath);
    });

    it('14. REFUSES a caller with no tenant', async () => {
      await expectRpc(
        storage.presignUpload(
          avatarRequest(),
          memberContext({ id: userId, organizationId: null }),
        ),
        status.FAILED_PRECONDITION,
      );
    });
  });

  // ------------------------------------------------------------- §2.3 confirm

  describe('confirmUpload', () => {
    /** Presigns and actually puts the bytes, so confirm has something to find. */
    const presignAndUpload = async (context = caller()) => {
      const presigned = await storage.presignUpload(avatarRequest(), context);
      await putBytes(presigned.objectPath, 'image/png');
      return presigned;
    };

    it('1. returns the REAL size and type from the object metadata', async () => {
      // Not the values the client declared at presign — those were a hint for
      // the policy check. These are what is actually stored, and the caller
      // writes them into its own row.
      const presigned = await presignAndUpload();

      const confirmed = await storage.confirmUpload(
        { objectPath: presigned.objectPath },
        caller(),
      );

      expect(confirmed.objectPath).toBe(presigned.objectPath);
      expect(confirmed.contentType).toBe('image/png');
      // From the fixture, not a literal: the uploaded bytes must be a genuine
      // PNG since §2.4a, so the size follows whatever that fixture is.
      expect(confirmed.sizeBytes).toBe(bytesFor('image/png').length);
    });

    it('2. answers NOT_FOUND for a path never presigned — §2.3 test 2', async () => {
      await putBytes('organizations/x/avatars/y/rogue.png', 'image/png');

      await expectRpc(
        storage.confirmUpload(
          { objectPath: 'organizations/x/avatars/y/rogue.png' },
          caller(),
        ),
        status.NOT_FOUND,
      );
    });

    it('3. answers NOT_FOUND once the pending record has EXPIRED — §2.3 test 3', async () => {
      // Expiry simulated by deleting the key rather than by sleeping ten
      // minutes. What is under test is the branch, not Redis's TTL clock.
      const presigned = await presignAndUpload();
      await fx.redis.del(`storage:pending:${presigned.objectPath}`);

      await expectRpc(
        storage.confirmUpload({ objectPath: presigned.objectPath }, caller()),
        status.NOT_FOUND,
      );
    });

    it('4. answers NOT_FOUND across TENANTS — §2.3 test 4', async () => {
      // The actual authorization check §1.2 exists for. NOT_FOUND rather than
      // PERMISSION_DENIED: confirming that the path exists is itself the leak.
      const presigned = await presignAndUpload();

      await expectRpc(
        storage.confirmUpload(
          { objectPath: presigned.objectPath },
          caller(faker.string.uuid()),
        ),
        status.NOT_FOUND,
      );
    });

    it('5. is NOT idempotent — a second confirm fails — §2.3 test 5', async () => {
      // By design. A second confirm of the same path is suspicious rather than
      // a retry to shrug off: the legitimate client already has its success
      // response from the first call.
      const presigned = await presignAndUpload();
      await storage.confirmUpload(
        { objectPath: presigned.objectPath },
        caller(),
      );

      await expectRpc(
        storage.confirmUpload({ objectPath: presigned.objectPath }, caller()),
        status.NOT_FOUND,
      );
    });

    it('6. FAILS when nothing was actually uploaded — §2.3 test 6', async () => {
      // The client skipped step 4 of the flow. FAILED_PRECONDITION rather than
      // NOT_FOUND: the authorization passed, and "your upload never landed" is
      // actionable in a way a 404 would not be.
      const presigned = await storage.presignUpload(avatarRequest(), caller());

      await expectRpc(
        storage.confirmUpload({ objectPath: presigned.objectPath }, caller()),
        status.FAILED_PRECONDITION,
      );
    });

    it('7. KEEPS the pending record when the object is missing', async () => {
      // So a client that PUTs late can still confirm. Consuming on failure
      // would turn a recoverable ordering mistake into a permanent one.
      const presigned = await storage.presignUpload(avatarRequest(), caller());
      await storage
        .confirmUpload({ objectPath: presigned.objectPath }, caller())
        .catch(() => undefined);

      expect(await pendingStore.get(presigned.objectPath)).not.toBeNull();

      await putBytes(presigned.objectPath, 'image/png');
      await expect(
        storage.confirmUpload({ objectPath: presigned.objectPath }, caller()),
      ).resolves.toBeDefined();
    });

    // --------------------------------------------- §2.4a content validation

    it('8. REJECTS content that is not what it claims, and DELETES it', async () => {
      // The gap the presign design leaves open: `contentType` is pinned into
      // the signature, so a client cannot upload a type it did not declare —
      // but the client picks the declaration. Declare `text/plain`, upload a
      // binary. Confirm is the first and only moment the server sees bytes.
      //
      // The deletion is half the assertion. The object is already in the bucket
      // by the time confirm runs, so refusing without deleting would leave an
      // unreferenced file nothing will ever clean up.
      const presigned = await storage.presignUpload(
        attachmentRequest({ contentType: 'text/plain' }),
        caller(),
      );
      await putBytes(presigned.objectPath, 'text/plain', DISGUISED_BYTES);

      await expectRpc(
        storage.confirmUpload({ objectPath: presigned.objectPath }, caller()),
        status.INVALID_ARGUMENT,
      );

      const [stillThere] = await fx.firebase.bucket
        .file(presigned.objectPath)
        .exists();
      expect(stillThere).toBe(false);
    });

    it('9. ACCEPTS a genuine file of the declared type', async () => {
      // The regression half: a check that rejects real files is worse than no
      // check. Swept across every allowlisted type rather than spot-checked,
      // because each has its own matcher and only one of them is exercised by
      // the tests above.
      for (const contentType of [
        'image/png',
        'image/jpeg',
        'image/webp',
        'application/pdf',
        'text/plain',
      ]) {
        const presigned = await storage.presignUpload(
          attachmentRequest({ contentType }),
          caller(),
        );
        await putBytes(presigned.objectPath, contentType);

        await expect(
          storage.confirmUpload({ objectPath: presigned.objectPath }, caller()),
        ).resolves.toEqual(expect.objectContaining({ contentType }));
      }
    });

    it('10. lets the caller RETRY with a valid file after a rejection', async () => {
      // The PendingUpload is deliberately not consumed on a content mismatch:
      // uploading the wrong file is a correctable mistake, and burning the
      // record would force a fresh presign for a legitimate retry.
      const presigned = await storage.presignUpload(
        attachmentRequest({ contentType: 'text/plain' }),
        caller(),
      );
      await putBytes(presigned.objectPath, 'text/plain', DISGUISED_BYTES);
      await storage
        .confirmUpload({ objectPath: presigned.objectPath }, caller())
        .catch(() => undefined);

      expect(await pendingStore.get(presigned.objectPath)).not.toBeNull();

      // Same path, correct bytes this time.
      await putBytes(presigned.objectPath, 'text/plain');
      await expect(
        storage.confirmUpload({ objectPath: presigned.objectPath }, caller()),
      ).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------- §2.4 read URLs

  describe('getSignedReadUrls', () => {
    const seedObject = async () => {
      const presigned = await storage.presignUpload(avatarRequest(), caller());
      await putBytes(presigned.objectPath, 'image/png');
      return presigned.objectPath;
    };

    it('1. returns a URL for every valid path in ONE call — §2.4 test 1', async () => {
      const paths = [
        await seedObject(),
        await seedObject(),
        await seedObject(),
      ];

      const { urlsByPath } = await storage.getSignedReadUrls(
        { objectPaths: paths },
        caller(),
      );

      expect(Object.keys(urlsByPath).sort(compareAlphabetically)).toEqual(
        [...paths].sort(compareAlphabetically),
      );
      for (const url of Object.values(urlsByPath)) {
        expect(url).toContain('X-Goog-Signature=');
      }
    });

    it('2. OMITS a missing path rather than failing the batch — §2.4 test 2', async () => {
      // Partial success. One deleted file must not blank a whole page, and the
      // caller decides how to render a missing avatar.
      const live = await seedObject();
      const gone = `organizations/${organizationId}/avatars/${userId}/deleted.png`;

      const { urlsByPath } = await storage.getSignedReadUrls(
        { objectPaths: [live, gone] },
        caller(),
      );

      expect(Object.keys(urlsByPath)).toEqual([live]);
    });

    it('3. REFUSES to sign another tenant’s path', async () => {
      // The one boundary storage-service itself owns. It cannot know a ticket's
      // ACL — the owning service checks that — but it can refuse a path whose
      // tenant segment is not the caller's.
      const theirs = await seedObject();

      const { urlsByPath } = await storage.getSignedReadUrls(
        { objectPaths: [theirs] },
        caller(faker.string.uuid()),
      );

      expect(urlsByPath).toEqual({});
    });

    it('4. DEDUPLICATES repeated paths', async () => {
      // The same avatar on twenty rows of a list is one signing call, not
      // twenty.
      const path = await seedObject();

      const { urlsByPath } = await storage.getSignedReadUrls(
        { objectPaths: [path, path, path] },
        caller(),
      );

      expect(Object.keys(urlsByPath)).toHaveLength(1);
    });

    it('5. returns an EMPTY map for an empty request', async () => {
      const { urlsByPath } = await storage.getSignedReadUrls(
        { objectPaths: [] },
        caller(),
      );

      expect(urlsByPath).toEqual({});
    });

    it('6. signs with an EXPIRY — §2.4 test 3, as far as the emulator allows', async () => {
      // The emulator will not honour a signed URL at all (501), so "it 403s
      // after the TTL" cannot be observed here. What IS observable is that the
      // URL carries a bounded expiry rather than none — a URL signed without
      // one would be permanent, which is the failure that actually matters.
      const path = await seedObject();

      const { urlsByPath } = await storage.getSignedReadUrls(
        { objectPaths: [path] },
        caller(),
      );

      // Asserted before parsing: a missing key would otherwise surface as an
      // opaque `Invalid URL` from the URL constructor rather than as the
      // absent-signature failure it actually is.
      //
      // `toContain` on the keys rather than `toHaveProperty`, which reads dots
      // in its argument as nesting — and every object path here ends in `.png`.
      expect(Object.keys(urlsByPath)).toContain(path);
      const expires = new URL(urlsByPath[path]).searchParams.get(
        'X-Goog-Expires',
      );
      expect(Number(expires)).toBe(900);
    });
  });
});
