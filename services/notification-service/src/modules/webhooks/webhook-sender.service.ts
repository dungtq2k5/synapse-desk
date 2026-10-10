import { request as httpsRequest } from 'node:https';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeniedTargetError,
  WEBHOOK_MAX_RESPONSE_BYTES,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMEOUT_MS,
  buildGuardedLookup,
  deniedLiteral,
  privateTargetsAllowed,
  signWebhook,
  type WebhookEventPayload,
} from '@synapsedesk/common';

/** One attempt's outcome — the row's fields, not an exception. */
export type SendOutcome =
  | { delivered: true; statusCode: number }
  | { delivered: false; statusCode?: number; error: string };

/** What the sender needs to know about an endpoint to sign for it. */
export type SigningEndpoint = {
  url: string;
  secret: string;
  previousSecret: string | null;
  previousSecretExpiresAt: Date | null;
};

/**
 * One POST to one tenant endpoint, with every SSRF control attached.
 *
 * **`node:https.request`, not `fetch`, and the departure is the point.**
 * `fetch` is the right default everywhere in this repository except the one
 * place where the destination is chosen by somebody else: undici exposes no
 * seam to pin the connection to the address that was checked, and its redirect
 * handling is a flag somebody can flip back. `https.request`
 *
 * - takes the guarded `lookup`, so resolve-check-pin is one act with no second
 *   resolution and no rebinding window;
 * - **does not follow redirects at all** — a `302` to
 *   `http://169.254.169.254/` is not a hop here, it is a failed delivery,
 *   asserted rather than configured;
 * - and `https.` is the scheme control: there is no code path that speaks
 *   plaintext.
 */
@Injectable()
export class WebhookSenderService {
  constructor(private readonly configService: ConfigService) {}

  /** Overridable resolver — the test seam the guard's design promises. */
  resolver: Parameters<typeof buildGuardedLookup>[0]['resolve'] = undefined;

  async send(
    endpoint: SigningEndpoint,
    payload: WebhookEventPayload,
  ): Promise<SendOutcome> {
    let url: URL;

    try {
      url = new URL(endpoint.url);
    } catch {
      return { delivered: false, error: 'The endpoint URL does not parse' };
    }

    if (url.protocol !== 'https:') {
      // Checked at save time too; checked again here because the row predates
      // the rule the day the rule tightens.
      return {
        delivered: false,
        error: 'Only https receivers are delivered to',
      };
    }

    const allowPrivate = privateTargetsAllowed({
      NODE_ENV: this.configService.get<string>('NODE_ENV'),
      flag: this.configService.get<string>('WEBHOOK_ALLOW_PRIVATE_TARGETS'),
    });

    // **An IP-literal host never reaches the guarded `lookup`** — Node skips
    // resolution and connects — so literals are judged here, before any socket
    // exists. On `url.hostname`, never the raw string: `new URL()` has already
    // canonicalized the spelling games (octal, integer, dotted-in-v6) into a
    // literal `addressIsDenied` can judge.
    const denied = allowPrivate ? null : deniedLiteral(url.hostname);
    if (denied) {
      return {
        delivered: false,
        error: new DeniedTargetError(url.hostname, denied).message,
      };
    }

    // **Serialize ONCE — these bytes are signed and these bytes are sent.**
    // The discipline `constructEvent` verifies with, reversed: a body
    // stringified twice re-serializes with different key order and fails
    // verification forever.
    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);

    const signatures = [
      `v1=${signWebhook(endpoint.secret, timestamp, rawBody)}`,
    ];

    // Rotation's overlap: while the previous secret is still valid, BOTH
    // signatures ride the header — new first — so a customer mid-roll verifies
    // with whichever key they hold.
    if (
      endpoint.previousSecret &&
      endpoint.previousSecretExpiresAt &&
      endpoint.previousSecretExpiresAt > new Date()
    ) {
      signatures.push(
        `v1=${signWebhook(endpoint.previousSecret, timestamp, rawBody)}`,
      );
    }

    return new Promise<SendOutcome>((resolve) => {
      const settle = (outcome: SendOutcome) => {
        // `request` can report multiple failures (an error after a timeout);
        // the first one is the diagnosis and the rest are its echoes.
        if (!settled) {
          settled = true;
          resolve(outcome);
        }
      };
      let settled = false;

      const request = httpsRequest(
        url,
        {
          method: 'POST',
          // **No happy-eyeballs.** `autoSelectFamily` (default ON since Node
          // 20) races connection attempts across the resolved family list, and
          // under it one webhook attempt was observed delivering TWO identical
          // POSTs to the receiver — same timestamp, same signature. Off, the
          // socket connects to exactly the single checked address the guarded
          // lookup returns, which is also the stricter reading of "pin".
          //
          // The spread-cast is a typings gap, not a hack: the option flows
          // through to `net.connect` at runtime but `https.RequestOptions`
          // does not declare it.
          ...({ autoSelectFamily: false } as object),
          lookup: buildGuardedLookup({
            allowPrivate,
            resolve: this.resolver,
          }),
          // **Only under the development hatch.** A localhost receiver is
          // self-signed by nature, so a hatch that allowed the address and
          // still refused the certificate would remove none of the friction it
          // exists for. In every other environment this option is absent and
          // the platform default — verify — stands.
          ...(allowPrivate ? { rejectUnauthorized: false } : {}),
          timeout: WEBHOOK_TIMEOUT_MS,
          headers: {
            'content-type': 'application/json',
            'user-agent': 'SynapseDesk-Webhooks/1',
            [WEBHOOK_SIGNATURE_HEADER]: `t=${timestamp},${signatures.join(',')}`,
          },
        },
        (response) => {
          const statusCode = response.statusCode ?? 0;

          // The body is not wanted — only the status — but the socket has to
          // be drained or destroyed, and a receiver that streams forever is
          // holding a worker. A small cap, then the connection is ours again.
          let received = 0;
          response.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > WEBHOOK_MAX_RESPONSE_BYTES) response.destroy();
          });

          response.on('close', () => {
            if (statusCode >= 200 && statusCode < 300) {
              settle({ delivered: true, statusCode });
            } else if (statusCode >= 300 && statusCode < 400) {
              // **A redirect is a failure, and that is control 4.** Every
              // other guard checks the URL the tenant gave; a redirect is a
              // URL the RECEIVER gives, after those checks have run.
              settle({
                delivered: false,
                statusCode,
                error: `The receiver redirected (${statusCode}); redirects are never followed`,
              });
            } else {
              settle({
                delivered: false,
                statusCode,
                error: `The receiver answered ${statusCode}`,
              });
            }
          });
        },
      );

      request.on('timeout', () => {
        request.destroy(new Error('timed out'));
      });

      request.on('error', (error) => {
        settle({ delivered: false, error: error.message });
      });

      request.end(rawBody);
    });
  }
}
