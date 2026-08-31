import { existsSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import {
  getMessaging,
  type BatchResponse,
  type Message,
  type Messaging,
} from 'firebase-admin/messaging';

/**
 * FCM, as one transport this service can live without.
 *
 * **A NAMED app**, copying `storage-service` rather than `auth-service`. That
 * one takes `getApps()[0]` — whatever app happens to exist — which is harmless
 * only because it runs alone; storage's own comment writes the hazard down: in
 * a process where both ran, the second `initializeApp()` would throw on the
 * duplicate name, or silently reuse the first app's credential and give calls a
 * key scoped to the wrong product. A third initializer must not add a third
 * pattern.
 *
 * **And it fails SOFT, unlike storage.** Storage refuses to boot without a
 * credential because every presign needs one. Push is one channel of four, and
 * a notification-service that will not start because FCM is unconfigured takes
 * the in-app feed and email down with it — the run-open rule ADR 0016 argues
 * for OCR.
 *
 * The model is `SmsService`, one module over, which already does exactly this:
 * *"Null when Twilio is unconfigured … the service must still start and serve
 * email — but a send attempt has to fail loudly rather than silently pretend to
 * have delivered."* Both halves matter. A channel that is off has to be
 * VISIBLY off in the table people read to answer "why didn't I get notified",
 * which is why an unconfigured send returns a failure the caller records rather
 * than a silent no-op.
 */
@Injectable()
export class FirebaseMessagingService {
  private readonly logger = new Logger(FirebaseMessagingService.name);

  /** Null when FCM is unconfigured — see the class docblock. */
  private readonly messaging: Messaging | null;

  constructor(private readonly configService: ConfigService) {
    const keyPath = this.configService.get<string>(
      'FIREBASE_MESSAGING_SERVICE_ACCOUNT_PATH',
    );

    if (!keyPath || !existsSync(keyPath)) {
      // ONCE, at boot, naming the variable. The alternative is a line per
      // notification, which is how a misconfiguration becomes log noise nobody
      // reads.
      this.logger.warn(
        `Push notifications are DISABLED: no service account at '${keyPath ?? '(FIREBASE_MESSAGING_SERVICE_ACCOUNT_PATH unset)'}'. Every other channel is unaffected.`,
      );
      this.messaging = null;

      return;
    }

    const APP_NAME = 'messaging';
    const app: App =
      getApps().find((existing) => existing.name === APP_NAME) ??
      initializeApp({ credential: cert(keyPath) }, APP_NAME);

    this.messaging = getMessaging(app);
    this.logger.log('Firebase Cloud Messaging ready');
  }

  /** Whether push can be attempted at all. */
  get isConfigured(): boolean {
    return this.messaging !== null;
  }

  /**
   * One multicast to every token a person has.
   *
   * Returns FCM's per-token responses in the ORDER the tokens were given, which
   * is what lets the caller map a failure back to the row to delete — the
   * responses carry no token of their own.
   *
   * @throws Error when push is unconfigured. Deliberate: the caller records a
   *   delivery row saying so, and a silent success would be a row claiming a
   *   notification was sent by a service holding no credential.
   */
  async sendEachForMulticast(
    tokens: string[],
    message: Omit<Message, 'token'>,
  ): Promise<BatchResponse> {
    if (!this.messaging) {
      throw new Error('Push is not configured on this deployment');
    }

    // **The deprecation on this overload does not apply to us**, and reading it
    // carefully is the difference between a comment and a migration. It says
    // *"use the overload accepting `FidMulticastMessage`"* — and that one takes
    // `fids: string[]`, Firebase Installation IDs, not registration tokens.
    // Taking the vendor's suggestion literally would change what
    // `device_tokens.token` holds and what the client registers, which is a
    // contract change rather than a call-site swap.
    //
    // `sendEach()` with one `Message` per token is the only other token-based
    // path and is the eventual target; it is deliberate rather than urgent, and
    // the assertion below is what makes moving safe to do quickly.
    const response = await this.messaging.sendEachForMulticast({
      ...message,
      tokens,
    });

    // **The invariant the caller's dead-token mapping rests on.** FCM's
    // responses carry no token of their own — they are positional — so the
    // caller maps `responses[i]` back to `tokens[i]`. A short or reordered
    // array would delete the wrong person's device, silently. Nothing in the
    // SDK's types states the guarantee, so it is checked here rather than
    // assumed at the index.
    if (response.responses.length !== tokens.length) {
      throw new Error(
        `FCM returned ${response.responses.length} responses for ${tokens.length} tokens; the positional mapping cannot be trusted`,
      );
    }

    return response;
  }
}
