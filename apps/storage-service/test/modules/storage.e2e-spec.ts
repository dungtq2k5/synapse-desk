import { ConfigService } from '@nestjs/config';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { faultInjector } from '@synapsedesk/common/testing/fault';
import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import { StoragePurpose as ProtoStoragePurpose } from '@synapsedesk/grpc-proto';
import {
  INGEST_TIMEOUT_MS,
  MAX_ATTACHMENT_BYTES,
  compareAlphabetically,
  organizationIdFromObjectPath,
} from '@synapsedesk/common';
import {
  DISGUISED_BYTES,
  E2eFixture,
  PDF_BYTES,
  PNG_BYTES,
  bootstrapE2eTest,
  bytesFor,
  memberContext,
  startSourceServer,
  type SourceServer,
} from '../utils';
import { RemoteSourceFetcher } from '../../src/modules/storage/remote-source.fetcher';
import { SIGNATURE_SAMPLE_BYTES } from '../../src/common/content-signature';
import { StorageService } from '../../src/modules/storage/storage.service';
import { PendingUploadStore } from '../../src/modules/storage/pending-upload.store';

/**
 * Presign, Confirm and batched read URLs.
 *
 * **The emulator does not honour signed URLs** (it answers 501 — pinned in
 * `bootstrap.e2e-spec.ts`), so the byte upload in these tests goes through the
 * Admin SDK rather than through the returned `uploadUrl`. That is a real gap
 * against the presign test, and it is worth being precise about what it costs: the
 * SIGNATURE is unproven end-to-end, but everything the signature protects is
 * not. The path construction, the tenant boundary, the PendingUpload lifecycle
 * and the confirm authorization are all exercised against real infra here, and
 * those are where the bugs would be.
 */
describe('Storage presign, confirm and read URLs (e2e)', () => {
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
   * `confirmUpload` reads the header and rejects a mismatch, so `'x'`
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

  // ------------------------------------------------------------- presign

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

    it('3. takes the tenant from the CONTEXT, never from the request', async () => {
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

    it('9. builds the ATTACHMENT path from both owner ids, under `pending/`', async () => {
      // **`pending/` is new**. A presigned object is
      // unreferenced until confirm moves it out, and keeping the two apart is
      // what makes a lifecycle rule over the prefix safe: before this, an
      // abandoned upload and a live attachment had identical path shapes.
      //
      // The owner ids are still both there and still in the same order — the
      // segment is inserted, not substituted, so the tenant check in
      // `organizationIdFromObjectPath` reads the same position it always did.
      const request = attachmentRequest();
      const result = await storage.presignUpload(request, caller());

      expect(result.objectPath).toContain(
        `organizations/${organizationId}/tickets/${request.ownerId}/attachments/pending/${request.secondaryOwnerId}/`,
      );
    });

    it('10. ACCEPTS an attachment with no secondary owner, and omits the segment', async () => {
      // **This test used to assert the opposite**. Requiring the
      // message id here is what made presign-before-the-message impossible, and
      // that is what left a first-turn screenshot unreadable by the answer to
      // the very message it was attached to.
      //
      // Inverted rather than deleted, because the path shape is the part worth
      // pinning: the segment is ABSENT, not blank. A placeholder would produce
      // `attachments//file` and a doubled separator is the kind of thing that
      // works everywhere until something splits on it.
      const request = attachmentRequest({ secondaryOwnerId: '' });
      const result = await storage.presignUpload(request, caller());

      expect(result.objectPath).toContain(
        `organizations/${organizationId}/tickets/${request.ownerId}/attachments/`,
      );
      expect(result.objectPath).not.toContain('//');
    });

    it('10b. refuses a secondary owner on a purpose with nowhere to put it', async () => {
      // The half of the old check that still means something. Accepting it
      // would discard the caller's id silently, which is worse than refusing:
      // they would believe it landed somewhere.
      await expectRpc(
        storage.presignUpload(
          avatarRequest({ secondaryOwnerId: faker.string.uuid() }),
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

  // ------------------------------------------------------------- confirm

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
      // PNG since content validation landed, so the size follows whatever that fixture is.
      expect(confirmed.sizeBytes).toBe(bytesFor('image/png').length);
    });

    it('2. answers NOT_FOUND for a path never presigned', async () => {
      await putBytes('organizations/x/avatars/y/rogue.png', 'image/png');

      await expectRpc(
        storage.confirmUpload(
          { objectPath: 'organizations/x/avatars/y/rogue.png' },
          caller(),
        ),
        status.NOT_FOUND,
      );
    });

    it('3. answers NOT_FOUND once the pending record has EXPIRED', async () => {
      // Expiry simulated by deleting the key rather than by sleeping ten
      // minutes. What is under test is the branch, not Redis's TTL clock.
      const presigned = await presignAndUpload();
      await fx.redis.del(`storage:pending:${presigned.objectPath}`);

      await expectRpc(
        storage.confirmUpload({ objectPath: presigned.objectPath }, caller()),
        status.NOT_FOUND,
      );
    });

    it('4. answers NOT_FOUND across TENANTS', async () => {
      // The actual authorization check the pending record exists for. NOT_FOUND rather than
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

    it('5. is NOT idempotent — a second confirm fails', async () => {
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

    it('6. FAILS when nothing was actually uploaded', async () => {
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

    // --------------------------------------------- content validation

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

  // ---------------------------------------------------------- read URLs

  describe('getSignedReadUrls', () => {
    const seedObject = async () => {
      const presigned = await storage.presignUpload(avatarRequest(), caller());
      await putBytes(presigned.objectPath, 'image/png');
      return presigned.objectPath;
    };

    it('1. returns a URL for every valid path in ONE call', async () => {
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

    it('2. OMITS a missing path rather than failing the batch', async () => {
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

    it('6. signs with an EXPIRY', async () => {
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

/**
 * Segregate at presign, move at confirm.
 *
 * **The prefix is the point, not the move.** `confirmUpload` never relocated
 * anything, so a live attachment on a real ticket had the same path shape as
 * one somebody uploaded and abandoned — and "add a bucket lifecycle rule",
 * which is the obvious answer to orphaned objects, would have deleted both.
 *
 * The rule itself is bucket configuration the emulator does not run, so it
 * cannot be tested here. **What can be tested is the invariant that makes it
 * safe to enable**: after a successful confirm, nothing is left under
 * `pending/`. Same shape as the OCR image checks — the deployment artifact
 * is not testable, so test the property it depends on.
 */
describe('Ticket attachments are segregated until confirmed (e2e)', () => {
  let fx: E2eFixture;
  let storage: StorageService;

  const organizationId = faker.string.uuid();
  const userId = faker.string.uuid();

  const caller = () => memberContext({ id: userId, organizationId });

  const presign = (overrides: Record<string, unknown> = {}) =>
    storage.presignUpload(
      {
        purpose: ProtoStoragePurpose.STORAGE_PURPOSE_TICKET_ATTACHMENT,
        ownerId: faker.string.uuid(),
        contentType: 'application/pdf',
        sizeBytes: 4096,
        originalFileName: 'invoice.pdf',
        secondaryOwnerId: '',
        ...overrides,
      },
      caller(),
    );

  const exists = async (objectPath: string) =>
    (await fx.firebase.bucket.file(objectPath).exists())[0];

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    storage = fx.moduleRef.get(StorageService);
  });

  beforeEach(() => fx.reset());
  afterAll(() => fx.close());

  it('presigns UNDER `pending/`, for both path shapes', async () => {
    // Both, because both are abandonable. The `:messageId` route's upload is
    // just as unreferenced between the PUT and the confirm as the one-shot
    // flow's is.
    const messageLess = await presign();
    const messageBound = await presign({
      secondaryOwnerId: faker.string.uuid(),
    });

    expect(messageLess.objectPath).toContain('/attachments/pending/');
    expect(messageBound.objectPath).toContain('/attachments/pending/');
  });

  it('1. **after confirm, nothing remains under `pending/`**', async () => {
    // The invariant the lifecycle rule depends on, and the reason the lifecycle rule is a
    // code change rather than a console change.
    const presigned = await presign();
    await fx.firebase.bucket
      .file(presigned.objectPath)
      .save(bytesFor('application/pdf'), {
        contentType: 'application/pdf',
        resumable: false,
      });

    const confirmed = await storage.confirmUpload(
      { objectPath: presigned.objectPath },
      caller(),
    );

    expect(confirmed.objectPath).not.toContain('/pending/');
    expect(confirmed.objectPath).toBe(
      presigned.objectPath.replace('/attachments/pending/', '/attachments/'),
    );
    // The object MOVED — it is not merely also somewhere else.
    await expect(exists(presigned.objectPath)).resolves.toBe(false);
    await expect(exists(confirmed.objectPath)).resolves.toBe(true);
  });

  it('3. **a confirm that FAILS leaves the object under `pending/`**', async () => {
    // So the named skip and the sweep agree on what "unconfirmed" means.
    // If a failed confirm moved the object anyway, a skipped attachment would
    // sit in the committed prefix forever with no row pointing at it — the
    // exact orphan class this section exists to make sweepable.
    const presigned = await presign();
    // Declared a PDF, uploaded as something else: the magic-byte check refuses.
    await fx.firebase.bucket
      .file(presigned.objectPath)
      .save(bytesFor('image/png'), {
        contentType: 'application/pdf',
        resumable: false,
      });

    await expectRpc(
      storage.confirmUpload({ objectPath: presigned.objectPath }, caller()),
      status.INVALID_ARGUMENT,
    );

    const committed = presigned.objectPath.replace(
      '/attachments/pending/',
      '/attachments/',
    );
    await expect(exists(committed)).resolves.toBe(false);
  });

  it('a confirm that never happens leaves it under `pending/` too', async () => {
    // The ordinary abandonment: presign, upload, change your mind, close the
    // tab. Under this prefix it is sweepable; under the committed one it would
    // be indistinguishable from a live attachment.
    const presigned = await presign();
    await fx.firebase.bucket
      .file(presigned.objectPath)
      .save(bytesFor('application/pdf'), {
        contentType: 'application/pdf',
        resumable: false,
      });

    await expect(exists(presigned.objectPath)).resolves.toBe(true);
    expect(presigned.objectPath).toContain('/attachments/pending/');
  });

  it('**the other purposes are NOT segregated**, and their paths are unchanged', async () => {
    // An avatar, a document and an export are each referenced by a row written
    // in the same call that confirms them, so there is no window in which one
    // exists unreferenced. Segregating them would be a move per upload for a
    // problem they do not have.
    const avatar = await storage.presignUpload(
      {
        purpose: ProtoStoragePurpose.STORAGE_PURPOSE_AVATAR,
        ownerId: userId,
        contentType: 'image/png',
        sizeBytes: 1024,
        originalFileName: 'me.png',
        secondaryOwnerId: '',
      },
      caller(),
    );

    expect(avatar.objectPath).not.toContain('pending');
  });

  it('**a crash between the move and the consume RESUMES on retry**', async () => {
    // V3. The move happens before the record is consumed, which is right for
    // the common failure — but a death in the gap between them leaves the
    // object at the COMMITTED path with the record still keyed to the pending
    // one.
    //
    // Refusing there would report the opposite of what happened: "no object was
    // uploaded" for an upload that landed and was committed. And the residue
    // sits OUTSIDE `pending/`, where the lifecycle rule can never reach it —
    // precisely the unsweepable orphan the lifecycle rule exists to prevent, arriving
    // through a narrower door.
    const presigned = await presign();
    await fx.firebase.bucket
      .file(presigned.objectPath)
      .save(bytesFor('application/pdf'), {
        contentType: 'application/pdf',
        resumable: false,
      });

    // The crash, reproduced exactly: move the object, leave the record.
    const committed = presigned.objectPath.replace(
      '/attachments/pending/',
      '/attachments/',
    );
    await fx.firebase.bucket.file(presigned.objectPath).move(committed);

    // The retry the caller would make.
    const confirmed = await storage.confirmUpload(
      { objectPath: presigned.objectPath },
      caller(),
    );

    expect(confirmed.objectPath).toBe(committed);
    expect(confirmed.contentType).toBe('application/pdf');
    await expect(exists(committed)).resolves.toBe(true);
  });

  it('a MISSING object is still refused, resumption or not', async () => {
    // The check above must not become "assume it worked". A presign whose
    // upload never happened has nothing at either path, and that is the case
    // FAILED_PRECONDITION exists for.
    const presigned = await presign();

    await expectRpc(
      storage.confirmUpload({ objectPath: presigned.objectPath }, caller()),
      status.FAILED_PRECONDITION,
    );
  });

  it('2. the TENANT still resolves from a `pending/` path', async () => {
    // `organizationIdFromObjectPath` gates every read and takes segment 2.
    // `pending/` is inserted far deeper — but that is exactly the kind of
    // assumption worth an assertion, because breaking it fails closed and
    // confusingly.
    const presigned = await presign();

    expect(organizationIdFromObjectPath(presigned.objectPath)).toBe(
      organizationId,
    );
  });
});

describe('Ingesting an object from a URL (e2e)', () => {
  const faults = faultInjector();

  let fx: E2eFixture;
  let storage: StorageService;
  let fetcher: RemoteSourceFetcher;
  let config: ConfigService;
  let source: SourceServer;

  const organizationId = faker.string.uuid();
  const userId = faker.string.uuid();
  const ticketId = faker.string.uuid();

  const caller = (org: string = organizationId) =>
    memberContext({ id: userId, organizationId: org });

  const ingest = (
    overrides: Record<string, unknown> = {},
    context = caller(),
  ) =>
    storage.ingestFromUrl(
      {
        purpose: ProtoStoragePurpose.STORAGE_PURPOSE_TICKET_ATTACHMENT,
        ownerId: ticketId,
        secondaryOwnerId: '',
        contentType: 'image/png',
        sizeBytes: PNG_BYTES.length,
        originalFileName: 'screenshot.png',
        sourceUrl: source.url('/file.png'),
        maxBytes: 0,
        ...overrides,
      },
      context,
    );

  /**
   * The documented hatch, opened the documented way — PER TEST. `.env.test`
   * says NODE_ENV=test, under which the hatch is ignored whatever the flag
   * says, so both halves are forced; the guard rows run with it CLOSED.
   */
  const openHatch = () => {
    const real = config.get.bind(config);
    faults.replace(config, 'get', ((key: string) => {
      if (key === 'NODE_ENV') return 'development';
      if (key === 'INGEST_ALLOW_PRIVATE_SOURCES') return 'true';
      return real(key);
    }) as never);
  };

  const objects = async () =>
    (await fx.firebase.bucket.getFiles())[0].map((file) => file.name);

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    storage = fx.moduleRef.get(StorageService);
    fetcher = fx.moduleRef.get(RemoteSourceFetcher);
    config = fx.moduleRef.get(ConfigService);
    source = await startSourceServer();
  });

  beforeEach(async () => {
    await fx.reset();
    source.reset();
    fetcher.resolver = undefined;
    fetcher.timeoutMs = INGEST_TIMEOUT_MS;
  });

  afterAll(async () => {
    await source.close();
    await fx.close();
  });

  // ------------------------------------------------------------ it lands

  describe('a source that is what it says', () => {
    it('**lands under `pending/` and confirms exactly like a client upload**', async () => {
      // The segregation invariant, reached through the new door: ingest writes
      // the same record presign does, so `confirmUpload` cannot tell who put
      // the bytes there — and moves them out of `pending/` the same way.
      openHatch();
      source.route('/file.png', {
        headers: { 'content-type': 'image/png' },
        body: PNG_BYTES,
      });

      const ingested = await ingest();

      expect(ingested.objectPath).toContain(
        `organizations/${organizationId}/tickets/${ticketId}/attachments/pending/`,
      );
      expect(ingested.sizeBytes).toBe(PNG_BYTES.length);

      const confirmed = await storage.confirmUpload(
        { objectPath: ingested.objectPath },
        caller(),
      );

      expect(confirmed.objectPath).not.toContain('/pending/');
      expect(confirmed.contentType).toBe('image/png');
      expect(await objects()).toEqual([confirmed.objectPath]);
    });

    it('**a 100-byte text file sniffs on END and lands**', async () => {
      // Shorter than the 4096-byte sample: a sniff that waited for a full
      // buffer would never run on it.
      openHatch();
      const text = Buffer.from('x'.repeat(99) + '\n');
      source.route('/note.txt', { body: text });

      const ingested = await ingest({
        contentType: 'text/plain',
        sizeBytes: text.length,
        sourceUrl: source.url('/note.txt'),
      });

      expect(ingested.sizeBytes).toBe(100);
      expect(await objects()).toEqual([ingested.objectPath]);
    });

    it('a body larger than the sample streams whole, and the COUNT is what is answered', async () => {
      openHatch();
      const big = Buffer.concat([PDF_BYTES, Buffer.alloc(300_000, 0x20)]);
      source.route('/big.pdf', { body: big });

      const ingested = await ingest({
        contentType: 'application/pdf',
        sizeBytes: 1,
        sourceUrl: source.url('/big.pdf'),
      });

      // The request CLAIMED one byte; the answer is what arrived.
      expect(ingested.sizeBytes).toBe(big.length);
      const [metadata] = await fx.firebase.bucket
        .file(ingested.objectPath)
        .getMetadata();
      expect(Number(metadata.size)).toBe(big.length);
    });

    it('**a 302 to the same server is followed**, and a second one too', async () => {
      openHatch();
      source.route('/one', { status: 302, headers: { location: '/two' } });
      source.route('/two', {
        status: 302,
        headers: { location: source.url('/file.png') },
      });
      source.route('/file.png', { body: PNG_BYTES });

      const ingested = await ingest({ sourceUrl: source.url('/one') });

      expect(source.requests).toEqual(['/one', '/two', '/file.png']);
      expect(await objects()).toEqual([ingested.objectPath]);
    });
  });

  // ------------------------------------------------------ nothing is written

  describe('a source that is refused writes nothing and leaves no record', () => {
    const refused = async (
      attempt: Promise<unknown>,
      code: status,
    ): Promise<void> => {
      await expectRpc(attempt, code);
      expect(await objects()).toEqual([]);
      // `reset()` flushed Redis before the test, so any surviving key is the
      // record this attempt wrote and failed to consume.
      expect(await fx.redis.dbsize()).toBe(0);
    };

    it('**a PNG declared `image/jpeg` is refused before any write**', async () => {
      openHatch();
      source.route('/file.png', { body: PNG_BYTES });

      await refused(
        ingest({ contentType: 'image/jpeg' }),
        status.INVALID_ARGUMENT,
      );
    });

    it('an empty body is refused', async () => {
      openHatch();
      source.route('/empty.txt', { body: '' });

      await refused(
        ingest({
          contentType: 'text/plain',
          sourceUrl: source.url('/empty.txt'),
        }),
        status.INVALID_ARGUMENT,
      );
    });

    it('**a body over `maxBytes` is cut, the partial deleted, the record consumed**', async () => {
      // No Content-Length: the server streams, so only the COUNT can catch it.
      //
      // **The head arrives ALONE, and under the ceiling.** Sent in one write, the
      // whole body lands as one chunk and the sniff's own buffer check refuses
      // it — so the test would pass with the streaming count deleted (measured,
      // by sabotage). Pausing between writes puts the overflow after the sniff,
      // on the path the count guards.
      openHatch();
      const head = Buffer.concat([
        PDF_BYTES,
        Buffer.alloc(SIGNATURE_SAMPLE_BYTES - PDF_BYTES.length, 0x20),
      ]);
      source.route('/huge.pdf', (_request, response) => {
        response.writeHead(200);
        response.write(head);
        setTimeout(() => response.write(Buffer.alloc(8_000, 0x20)), 150);
        setTimeout(() => response.end(Buffer.alloc(8_000, 0x20)), 300);
      });

      await refused(
        ingest({
          contentType: 'application/pdf',
          sizeBytes: 100,
          maxBytes: 6_000,
          sourceUrl: source.url('/huge.pdf'),
        }),
        status.FAILED_PRECONDITION,
      );
    });

    it('**a `Content-Length` over the ceiling short-circuits before the body is read**', async () => {
      openHatch();
      let bodyWritten = false;
      source.route('/declared.pdf', (_request, response) => {
        response.writeHead(200, { 'content-length': '999999' });
        response.flushHeaders();
        setTimeout(() => {
          bodyWritten = !response.destroyed && response.write(PDF_BYTES);
          response.destroy();
        }, 200);
      });

      await refused(
        ingest({
          contentType: 'application/pdf',
          sizeBytes: 100,
          maxBytes: 1_000,
          sourceUrl: source.url('/declared.pdf'),
        }),
        status.FAILED_PRECONDITION,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      // The refusal came from the header: the ingest settled before the body
      // was ever sent.
      expect(bodyWritten).toBe(false);
    });

    it('the claimed size over the ceiling is refused before any socket', async () => {
      openHatch();
      source.route('/file.png', { body: PNG_BYTES });

      await refused(
        ingest({ sizeBytes: 5_000, maxBytes: 1_000 }),
        status.INVALID_ARGUMENT,
      );
      expect(source.requests).toEqual([]);
    });

    it('**`maxBytes` narrows the policy cap and can never widen it**', async () => {
      openHatch();
      source.route('/file.png', { body: PNG_BYTES });

      await refused(
        ingest({
          sizeBytes: MAX_ATTACHMENT_BYTES + 1,
          maxBytes: MAX_ATTACHMENT_BYTES * 10,
        }),
        status.INVALID_ARGUMENT,
      );
      expect(source.requests).toEqual([]);
    });

    it('a 404 source is FAILED_PRECONDITION', async () => {
      openHatch();

      await refused(
        ingest({ sourceUrl: source.url('/missing.png') }),
        status.FAILED_PRECONDITION,
      );
    });

    it('**a third redirect fails**', async () => {
      openHatch();
      source.route('/a', { status: 302, headers: { location: '/b' } });
      source.route('/b', { status: 302, headers: { location: '/c' } });
      source.route('/c', { status: 302, headers: { location: '/file.png' } });
      source.route('/file.png', { body: PNG_BYTES });

      await refused(
        ingest({ sourceUrl: source.url('/a') }),
        status.FAILED_PRECONDITION,
      );
      expect(source.requests).toEqual(['/a', '/b', '/c']);
    });

    it('**a redirect to `http:` is refused at that hop** — every hop is re-judged', async () => {
      openHatch();
      source.route('/a', {
        status: 302,
        headers: { location: `http://localhost:${source.port}/file.png` },
      });

      await refused(
        ingest({ sourceUrl: source.url('/a') }),
        status.INVALID_ARGUMENT,
      );
      expect(source.requests).toEqual(['/a']);
    });

    it('**a source idle past the timeout consumes the record and writes nothing**', async () => {
      openHatch();
      fetcher.timeoutMs = 300;
      source.route('/slow.pdf', (_request, response) => {
        response.writeHead(200);
        response.write(PDF_BYTES);
        // …and then nothing, until the fetcher gives up.
        setTimeout(() => response.destroy(), 2_000);
      });

      await refused(
        ingest({
          contentType: 'application/pdf',
          sizeBytes: 100,
          sourceUrl: source.url('/slow.pdf'),
        }),
        status.DEADLINE_EXCEEDED,
      );
    });
  });

  // ------------------------------------------------------------- the guard

  describe('the SSRF guard, with the hatch CLOSED', () => {
    it.each([
      ['an `http:` URL', () => `http://localhost:${source.port}/file.png`],
      [
        'a `127.0.0.1` literal',
        () => `https://127.0.0.1:${source.port}/file.png`,
      ],
      ['a `[::1]` literal', () => `https://[::1]:${source.port}/file.png`],
    ])('**%s is refused before any socket**', async (_, url) => {
      source.route('/file.png', { body: PNG_BYTES });

      await expectRpc(ingest({ sourceUrl: url() }), status.INVALID_ARGUMENT);

      expect(source.requests).toEqual([]);
      expect(await fx.redis.dbsize()).toBe(0);
    });

    it('**a hostname resolving to a private address is refused before connecting**', async () => {
      // The resolver seam: the hostname is judged inside the socket's own
      // lookup, so the refusal lands before a connection exists.
      source.route('/file.png', { body: PNG_BYTES });
      fetcher.resolver = ((_host: string, _options: unknown, callback: never) =>
        (
          callback as (
            e: null,
            a: { address: string; family: number }[],
          ) => void
        )(null, [{ address: '127.0.0.1', family: 4 }])) as never;

      await expectRpc(
        ingest({
          sourceUrl: `https://attachments.example.test:${source.port}/file.png`,
        }),
        status.INVALID_ARGUMENT,
      );

      expect(source.requests).toEqual([]);
      expect(await objects()).toEqual([]);
      expect(await fx.redis.dbsize()).toBe(0);
    });
  });

  describe('the preamble presign runs', () => {
    it('refuses a type outside the purpose allowlist before any socket', async () => {
      openHatch();

      await expectRpc(
        ingest({ contentType: 'application/x-msdownload' }),
        status.INVALID_ARGUMENT,
      );
      expect(source.requests).toEqual([]);
    });

    it('the tenant comes from the CONTEXT: the object lands under the caller’s organization', async () => {
      openHatch();
      source.route('/file.png', { body: PNG_BYTES });
      const other = faker.string.uuid();

      const ingested = await ingest({}, caller(other));

      expect(organizationIdFromObjectPath(ingested.objectPath)).toBe(other);
      await expectRpc(
        storage.confirmUpload({ objectPath: ingested.objectPath }, caller()),
        status.NOT_FOUND,
      );
    });
  });
});
