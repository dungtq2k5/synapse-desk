import { RpcException } from '@nestjs/microservices';
import { rpcCode } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import { StoragePurpose as ProtoStoragePurpose } from '@synapsedesk/grpc-proto';
import {
  organizationIdFromObjectPath,
  StoragePurpose,
} from '@synapsedesk/common';
import {
  E2eFixture,
  bootstrapE2eTest,
  bytesFor,
  memberContext,
} from '../utils';
import { StorageService } from '../../src/modules/storage/storage.service';
import { PURPOSE_POLICY } from '../../src/common/purpose-registry';
import { VALIDATED_MIME_TYPES } from '../../src/common/content-signature';

/**
 * §4 The cross-cutting storage sweeps.
 *
 * Three of the four §4 suites are here, parametrized over every real purpose
 * rather than spot-checked on one:
 *
 *   - the tenant boundary on every presigned path
 *   - confirm authorization across tenants
 *   - the policy table's own consistency
 *
 * The fourth (async-delete idempotency) lives in `delete-consumer.e2e-spec.ts`,
 * where the NATS wiring already is — a second copy here would prove the same
 * thing twice with one of the copies eventually rotting.
 */
describe('§4 storage boundary sweeps (e2e)', () => {
  let fx: E2eFixture;
  let storage: StorageService;

  const organizationId = faker.string.uuid();
  const userId = faker.string.uuid();

  const caller = (org: string = organizationId) =>
    memberContext({ id: userId, organizationId: org });

  /**
   * The purposes with a real caller today. DOCUMENT is reserved for Domain C
   * and has no producer, so sweeping it would assert about a path nothing
   * builds — and would have to be revisited the moment ingestion-service picks
   * its own conventions.
   */
  const LIVE_PURPOSES = [
    {
      name: StoragePurpose.AVATAR,
      proto: ProtoStoragePurpose.STORAGE_PURPOSE_AVATAR,
      contentType: 'image/png',
      request: () => ({
        ownerId: userId,
        secondaryOwnerId: '',
      }),
    },
    {
      name: StoragePurpose.TICKET_ATTACHMENT,
      proto: ProtoStoragePurpose.STORAGE_PURPOSE_TICKET_ATTACHMENT,
      contentType: 'application/pdf',
      request: () => ({
        ownerId: faker.string.uuid(),
        secondaryOwnerId: faker.string.uuid(),
      }),
    },
  ] as const;

  const presign = (
    purpose: (typeof LIVE_PURPOSES)[number],
    context = caller(),
  ) =>
    storage.presignUpload(
      {
        purpose: purpose.proto,
        contentType: purpose.contentType,
        sizeBytes: 1024,
        originalFileName: 'file',
        ...purpose.request(),
      },
      context,
    );

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    storage = fx.moduleRef.get(StorageService);
  });

  beforeEach(() => fx.reset());
  afterAll(() => fx.close());

  // ----------------------------------------------------- tenant-boundary sweep

  describe('tenant-boundary sweep', () => {
    it.each(LIVE_PURPOSES.map((p) => [p.name, p] as const))(
      '%s puts the CALLER’S tenant in the path, never a request value',
      async (_name, purpose) => {
        const result = await presign(purpose);

        expect(organizationIdFromObjectPath(result.objectPath)).toBe(
          organizationId,
        );
      },
    );

    it.each(LIVE_PURPOSES.map((p) => [p.name, p] as const))(
      '%s never signs another tenant’s path for reading',
      async (_name, purpose) => {
        const theirs = await presign(purpose);
        await fx.firebase.bucket
          .file(theirs.objectPath)
          .save(bytesFor(purpose.contentType), {
            contentType: purpose.contentType,
            resumable: false,
          });

        const { urlsByPath } = await storage.getSignedReadUrls(
          { objectPaths: [theirs.objectPath] },
          caller(faker.string.uuid()),
        );

        expect(urlsByPath).toEqual({});
      },
    );

    it('two tenants presigning the same owner id get DIFFERENT prefixes', async () => {
      // The sharpest version: only the tenant differs. If the path were built
      // from the request rather than the context, these would collide.
      const sharedOwner = faker.string.uuid();
      const other = faker.string.uuid();

      const mine = await storage.presignUpload(
        {
          purpose: ProtoStoragePurpose.STORAGE_PURPOSE_AVATAR,
          ownerId: sharedOwner,
          secondaryOwnerId: '',
          contentType: 'image/png',
          sizeBytes: 1024,
          originalFileName: 'me.png',
        },
        caller(),
      );
      const theirs = await storage.presignUpload(
        {
          purpose: ProtoStoragePurpose.STORAGE_PURPOSE_AVATAR,
          ownerId: sharedOwner,
          secondaryOwnerId: '',
          contentType: 'image/png',
          sizeBytes: 1024,
          originalFileName: 'me.png',
        },
        caller(other),
      );

      expect(organizationIdFromObjectPath(mine.objectPath)).toBe(
        organizationId,
      );
      expect(organizationIdFromObjectPath(theirs.objectPath)).toBe(other);
    });
  });

  // ------------------------------------------------ confirm-authorization sweep

  describe('confirm-authorization sweep', () => {
    it.each(LIVE_PURPOSES.map((p) => [p.name, p] as const))(
      '%s answers NOT_FOUND when confirmed by another tenant',
      async (_name, purpose) => {
        const presigned = await presign(purpose);
        await fx.firebase.bucket
          .file(presigned.objectPath)
          .save(bytesFor(purpose.contentType), {
            contentType: purpose.contentType,
            resumable: false,
          });

        const attempt = storage.confirmUpload(
          { objectPath: presigned.objectPath },
          caller(faker.string.uuid()),
        );

        await expect(attempt).rejects.toBeInstanceOf(RpcException);
        await attempt.catch((error: unknown) =>
          expect(rpcCode(error)).toBe(status.NOT_FOUND),
        );
      },
    );

    it.each(LIVE_PURPOSES.map((p) => [p.name, p] as const))(
      '%s answers NOT_FOUND on a SECOND confirm',
      async (_name, purpose) => {
        const presigned = await presign(purpose);
        await fx.firebase.bucket
          .file(presigned.objectPath)
          .save(bytesFor(purpose.contentType), {
            contentType: purpose.contentType,
            resumable: false,
          });
        await storage.confirmUpload(
          { objectPath: presigned.objectPath },
          caller(),
        );

        const attempt = storage.confirmUpload(
          { objectPath: presigned.objectPath },
          caller(),
        );

        await attempt.catch((error: unknown) =>
          expect(rpcCode(error)).toBe(status.NOT_FOUND),
        );
      },
    );

    it('a cross-tenant confirm and a nonexistent path are INDISTINGUISHABLE', async () => {
      // The property that makes NOT_FOUND the right answer for both. If they
      // differed, the difference itself would tell a stranger which paths are
      // real.
      const presigned = await presign(LIVE_PURPOSES[0]);
      await fx.firebase.bucket
        .file(presigned.objectPath)
        .save(bytesFor(LIVE_PURPOSES[0].contentType), {
          contentType: LIVE_PURPOSES[0].contentType,
          resumable: false,
        });

      const codes: (number | undefined)[] = [];
      for (const path of [
        presigned.objectPath,
        'organizations/x/avatars/y/z.png',
      ]) {
        await storage
          .confirmUpload({ objectPath: path }, caller(faker.string.uuid()))
          .catch((error: unknown) => codes.push(rpcCode(error)));
      }

      expect(codes).toEqual([status.NOT_FOUND, status.NOT_FOUND]);
    });
  });

  // ------------------------------------------------------ policy-table sweep

  describe('the purpose policy table', () => {
    it('covers EVERY purpose in the enum', () => {
      // `Record<StoragePurpose, …>` makes this a compile error too, but the
      // runtime check catches a widened type or an entry present-but-undefined.
      for (const purpose of Object.values(StoragePurpose)) {
        expect([purpose, PURPOSE_POLICY[purpose]]).toEqual([
          purpose,
          expect.objectContaining({ prefix: expect.any(String) }),
        ]);
      }
    });

    it('gives every purpose a NON-EMPTY allowlist', () => {
      // An empty allowlist silently disables a purpose entirely — every upload
      // refused, with a message that reads like the client's fault.
      for (const [purpose, policy] of Object.entries(PURPOSE_POLICY)) {
        expect([purpose, policy.mimeAllowlist.length > 0]).toEqual([
          purpose,
          true,
        ]);
      }
    });

    it('gives every purpose a POSITIVE cap', () => {
      for (const [purpose, policy] of Object.entries(PURPOSE_POLICY)) {
        expect([purpose, policy.maxSizeBytes > 0]).toEqual([purpose, true]);
      }
    });

    it('never allows SVG anywhere', () => {
      // An SVG is a document that can carry script — the one image type that
      // behaves like an executable when served. Swept across every purpose so a
      // future widening has to notice this.
      for (const [purpose, policy] of Object.entries(PURPOSE_POLICY)) {
        expect([
          purpose,
          // Deliberately outside the vocabulary — that IS the assertion, so
          // the comparison widens rather than the type admitting an SVG.
          (policy.mimeAllowlist as readonly string[]).includes('image/svg+xml'),
        ]).toEqual([purpose, false]);
      }
    });

    it('has a CONTENT MATCHER for every allowlisted type — §2.4a', () => {
      // `matchesDeclaredType` fails closed on a type it does not know, so a
      // type added to an allowlist without a matcher would reject every upload
      // of it — at confirm, after the bytes are already in the bucket, which is
      // a confusing place to discover the omission. The literal union makes it
      // a compile error too; this catches a widened type.
      const allowed = new Set(
        Object.values(PURPOSE_POLICY).flatMap((p) => p.mimeAllowlist),
      );

      expect(
        [...allowed].filter(
          (mime) => !(VALIDATED_MIME_TYPES as readonly string[]).includes(mime),
        ),
      ).toEqual([]);
    });

    it('gives every purpose a DISTINCT prefix', () => {
      // Two purposes sharing a prefix would put an attachment where an avatar's
      // ACL governs it.
      const prefixes = Object.values(PURPOSE_POLICY).map((p) => p.prefix);

      expect(new Set(prefixes).size).toBe(prefixes.length);
    });

    it.each(LIVE_PURPOSES.map((p) => [p.name, p] as const))(
      '%s enforces its OWN cap, not a shared one',
      async (name, purpose) => {
        const policy = PURPOSE_POLICY[name];

        const attempt = storage.presignUpload(
          {
            purpose: purpose.proto,
            contentType: purpose.contentType,
            sizeBytes: policy.maxSizeBytes + 1,
            originalFileName: 'file',
            ...purpose.request(),
          },
          caller(),
        );

        await attempt.catch((error: unknown) =>
          expect([name, rpcCode(error)]).toEqual([
            name,
            status.INVALID_ARGUMENT,
          ]),
        );
      },
    );
  });
});
