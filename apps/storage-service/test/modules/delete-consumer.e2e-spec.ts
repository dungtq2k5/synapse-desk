import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import {
  ClientProxy,
  ClientProxyFactory,
  MicroserviceOptions,
} from '@nestjs/microservices';
import { faker } from '@faker-js/faker';
import {
  createNatsTransport,
  STORAGE_PATTERNS,
  SupersededReason,
} from '@synapsedesk/common';
import { AppModule } from '../../src/app.module';
import { bytesFor } from '../utils';
import { waitUntil } from '@synapsedesk/common/testing/wait';
import { FirebaseStorageService } from '../../src/modules/firebase/firebase-storage.service';

/**
 * §2.5 The async delete consumer, driven over a REAL NATS connection.
 *
 * Calling `consumer.handle(event)` directly would prove the bucket call and
 * nothing else — and the bucket call is the part least likely to be wrong. What
 * this suite is for is the WIRE: that an event published by a process which is
 * not this one is decoded into the shape the handler expects. That is exactly
 * what a direct method call cannot tell you, and exactly what stayed broken for
 * the whole of Domain A while nothing was subscribed.
 */
describe('§2.5 storage delete consumer over NATS (e2e)', () => {
  let app: INestApplication;
  let firebase: FirebaseStorageService;
  let client: ClientProxy;

  /**
   * Publishes the way the owning services actually do — through a Nest
   * `ClientProxy`, which wraps the payload as `{ pattern, data }`. Publishing
   * raw would take a different branch of Nest's deserializer and would prove
   * something other than the production path.
   */
  const publish = (
    objectPath: string,
    reason: SupersededReason,
  ): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      client
        .emit(STORAGE_PATTERNS.objectSuperseded, { objectPath, reason })
        .subscribe({
          error: (error: Error) => reject(error),
          complete: () => resolve(),
        });
    });

  const seed = async (objectPath: string): Promise<string> => {
    await firebase.bucket.file(objectPath).save(bytesFor('image/png'), {
      contentType: 'image/png',
      resumable: false,
    });
    return objectPath;
  };

  const exists = async (objectPath: string): Promise<boolean> => {
    const [found] = await firebase.bucket.file(objectPath).exists();
    return found;
  };

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    const configService = app.get(ConfigService);
    firebase = app.get(FirebaseStorageService);

    app.connectMicroservice<MicroserviceOptions>(
      createNatsTransport(configService),
    );
    await app.startAllMicroservices();
    await app.init();

    client = ClientProxyFactory.create(createNatsTransport(configService));
    await client.connect();
  }, 30_000);

  beforeEach(async () => {
    const [files] = await firebase.bucket.getFiles();
    await Promise.all(
      files.map((file) => file.delete({ ignoreNotFound: true })),
    );
  });

  afterAll(async () => {
    await client?.close();
    await app?.close();
  });

  it('1. DELETES an existing object — §2.5 test 1', async () => {
    const path = await seed(
      `organizations/${faker.string.uuid()}/avatars/${faker.string.uuid()}/old.png`,
    );

    await publish(path, SupersededReason.REPLACED);

    expect(await waitUntil(async () => !(await exists(path)))).toBe(true);
  });

  it('2. is a silent NO-OP for a path that never existed — §2.5 test 2', async () => {
    // `ignoreNotFound`, proven. The event is at-most-once and NATS core can
    // redeliver, so a delete-of-already-deleted MUST be a no-op — otherwise the
    // first redelivery turns a successful cleanup into a permanent error in the
    // log, and anyone reading that log learns to ignore it.
    const path = `organizations/${faker.string.uuid()}/avatars/x/never.png`;

    await expect(
      publish(path, SupersededReason.RECORD_DELETED),
    ).resolves.toBeUndefined();

    // And the consumer is still alive: a real delete after the no-op works.
    const live = await seed(
      `organizations/${faker.string.uuid()}/avatars/y/live.png`,
    );
    await publish(live, SupersededReason.REPLACED);
    expect(await waitUntil(async () => !(await exists(live)))).toBe(true);
  });

  it('3. survives a REDELIVERY of the same event', async () => {
    const path = await seed(
      `organizations/${faker.string.uuid()}/avatars/z/twice.png`,
    );

    await publish(path, SupersededReason.REPLACED);
    await waitUntil(async () => !(await exists(path)));
    await publish(path, SupersededReason.REPLACED);

    // Still gone, and nothing threw. Idempotency is what makes at-most-once
    // delivery safe to build on.
    expect(await exists(path)).toBe(false);
  });

  it('4. handles BOTH reasons identically', async () => {
    // The reason is recorded for whoever audits storage later; it must not
    // change what the consumer does.
    const replaced = await seed(
      `organizations/${faker.string.uuid()}/avatars/a/replaced.png`,
    );
    const removed = await seed(
      `organizations/${faker.string.uuid()}/avatars/b/removed.png`,
    );

    await publish(replaced, SupersededReason.REPLACED);
    await publish(removed, SupersededReason.RECORD_DELETED);

    expect(
      await waitUntil(
        async () => !(await exists(replaced)) && !(await exists(removed)),
      ),
    ).toBe(true);
  });

  it('5. IGNORES an event with no objectPath rather than deleting something', async () => {
    // A missing path is a producer bug. "Delete whatever the empty string
    // resolves to" is the one outcome worth being paranoid about here.
    const survivor = await seed(
      `organizations/${faker.string.uuid()}/avatars/c/keepme.png`,
    );

    await publish('', SupersededReason.REPLACED);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await exists(survivor)).toBe(true);
  });

  it('6. deletes ONLY the named object', async () => {
    // A prefix-delete instead of an object-delete would take the whole tenant's
    // avatars with it, and the event would look identical.
    const organizationId = faker.string.uuid();
    const userId = faker.string.uuid();
    const doomed = await seed(
      `organizations/${organizationId}/avatars/${userId}/old.png`,
    );
    const sibling = await seed(
      `organizations/${organizationId}/avatars/${userId}/new.png`,
    );

    await publish(doomed, SupersededReason.REPLACED);
    await waitUntil(async () => !(await exists(doomed)));

    expect(await exists(sibling)).toBe(true);
  });
});
