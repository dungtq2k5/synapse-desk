import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import type { Bucket } from '@google-cloud/storage';

/**
 * The ONLY holder of Storage credentials in this system.
 *
 * A separate Firebase service account from `auth-service`'s: that one is scoped
 * to Auth token verification with no Storage grant, this one to Storage
 * read/write with no Auth grant. Neither service can do the other's job with
 * its own key — so a compromised `ticket-service` cannot touch Storage
 * directly, because it never holds a key that could. It can only ask, over
 * gRPC.
 *
 * A PATH to the JSON key, not inline credentials: the private key is a
 * multi-line PEM, env files cannot hold real newlines, and getting the
 * un-escaping wrong produces an opaque crypto error rather than "bad config".
 *
 * V4 signing needs no extra IAM setup because of that key file — signing
 * requires either a local private key or the `iam.serviceAccountTokenCreator`
 * role, and the JSON provides the former.
 *
 * See `docs/decisions/0024-one-upload-mechanism.md`.
 */
@Injectable()
export class FirebaseStorageService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseStorageService.name);

  private app!: App;
  private bucketHandle!: Bucket;
  private keyPath = '';

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const keyPath = resolve(
      process.cwd(),
      this.configService.getOrThrow<string>(
        'FIREBASE_STORAGE_SERVICE_ACCOUNT_PATH',
      ),
    );
    // Retained for `isConfigured()`, so the readiness probe can notice a
    // credential that was rotated out from under a running process.
    this.keyPath = keyPath;
    const bucketName = this.configService.getOrThrow<string>(
      'FIREBASE_STORAGE_BUCKET',
    );

    if (!existsSync(keyPath)) {
      // Fail at BOOT, loudly. The alternative is a service that starts fine and
      // then fails every presign at request time with a stack trace from inside
      // the SDK, which reads as an outage rather than a misconfiguration.
      throw new Error(
        `Firebase Storage service account not found at '${keyPath}'. Set FIREBASE_STORAGE_SERVICE_ACCOUNT_PATH.`,
      );
    }

    // A NAMED app. `auth-service`'s FirebaseService initialises the default one
    // with a different credential, and in any process where both ran the second
    // `initializeApp()` would throw on the duplicate name — or worse, silently
    // reuse the first app's credential and quietly give Storage calls an
    // Auth-scoped key.
    const APP_NAME = 'storage';
    this.app =
      getApps().find((app) => app.name === APP_NAME) ??
      initializeApp(
        { credential: cert(keyPath), storageBucket: bucketName },
        APP_NAME,
      );

    this.bucketHandle = getStorage(this.app).bucket(bucketName);

    // The bucket itself is created ONCE by scripts/setup-firebase-bucket.mjs,
    // never here. GCS has no folders — a prefix exists the moment the first
    // object under it is written — so there is nothing per-tenant to create;
    // the bucket is the one real, billable, IAM-bearing resource, and
    // provisioning it at boot would be the same mistake as a service migrating
    // its own database into existence.
    this.logger.log(`Firebase Storage ready on bucket '${bucketName}'`);
  }

  get bucket(): Bucket {
    return this.bucketHandle;
  }

  /**
   * Readiness, WITHOUT a network call.
   *
   * The tempting probe is `bucket.exists()`, and it is wrong twice over: it
   * bills a GCS operation every five seconds per pod, and it makes Google's
   * availability decide whether this service is in rotation. A storage outage
   * is something to report on the request that hits it, not a reason to remove
   * an instance that would serve the next request perfectly well once GCS
   * returns.
   *
   * So this asserts what the SERVICE controls: that `onModuleInit` completed
   * and the credential is still on disk. The second half is not redundant — a
   * secret rotated out from under a running pod produces signing failures that
   * are otherwise invisible until a user reports a broken download.
   */
  isConfigured(): boolean {
    return Boolean(this.bucketHandle) && existsSync(this.keyPath);
  }
}
