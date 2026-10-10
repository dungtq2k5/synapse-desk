import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

/** The subset of a verified Google identity this system cares about. */
export type GoogleIdentity = {
  email: string;
  emailVerified: boolean;
  fullName: string | null;
  avatarUrl: string | null;
};

/**
 * Verifies Firebase ID tokens.
 *
 * The browser completes the Google flow with the Firebase client SDK and sends
 * us the resulting ID token. This service checks it against Google's public
 * signing keys — so the client's claims about who they are are never trusted,
 * only the signature is.
 */
@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private app!: App;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    // `getApps()` guard: initializeApp throws on a duplicate name, and Nest can
    // instantiate this more than once under --watch or in tests.
    const existing = getApps();

    // A PATH to the service-account JSON, not the credentials inline.
    //
    // Three env vars was the alternative, and the private key is why it is worse:
    // it is a multi-line PEM, env files cannot hold real newlines, so it has to
    // be stored with literal "\n" escapes and un-escaped at read time. Get that
    // wrong and the failure is an opaque crypto error rather than "bad config".
    // `cert()` accepts a path and parses the file Google gives you, verbatim.
    //
    // Resolved against cwd so it works in dev and from a built dist/ alike.
    const keyPath = resolve(
      process.cwd(),
      this.configService.getOrThrow<string>('FIREBASE_SERVICE_ACCOUNT_PATH'),
    );

    // Checked explicitly: `cert()` on a missing path throws something far less
    // actionable than naming the file it wanted.
    if (!existsSync(keyPath)) {
      throw new Error(
        `Firebase service account key not found at ${keyPath}. Download it from ` +
          'Firebase console > Project settings > Service accounts > Generate new key.',
      );
    }

    this.app = existing[0] ?? initializeApp({ credential: cert(keyPath) });

    this.logger.log('Firebase Admin initialized');
  }

  /**
   * Verifies the token and extracts the profile fields worth keeping.
   *
   * `checkRevoked: true` costs an extra lookup but means a session disabled in
   * the Firebase console stops working immediately rather than at token expiry.
   */
  async verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
    let decoded: DecodedIdToken;

    try {
      decoded = await getAuth(this.app).verifyIdToken(idToken, true);
    } catch (error) {
      this.logger.warn(
        `Rejected Firebase ID token: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Invalid or expired Google sign-in token',
      });
    }

    // A Google identity without an email cannot be mapped onto `users.email`,
    // which is the unique key this system identifies people by.
    if (!decoded.email) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Google account did not provide an email address',
      });
    }

    return {
      email: decoded.email.toLowerCase(),
      // Google has already verified the address, so the user never has to run
      // our own email OTP.
      emailVerified: decoded.email_verified === true,
      fullName: typeof decoded.name === 'string' ? decoded.name : null,
      avatarUrl: typeof decoded.picture === 'string' ? decoded.picture : null,
    };
  }
}
