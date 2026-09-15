import type { IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { status } from '@grpc/grpc-js';
import {
  DeniedTargetError,
  INGEST_TIMEOUT_MS,
  buildGuardedLookup,
  deniedLiteral,
  privateTargetsAllowed,
} from '@synapsedesk/common';

/** Redirect hops followed before a source is refused; the next one fails. */
export const INGEST_MAX_REDIRECTS = 2;

/** A refusal with the gRPC status the caller should see. */
export class RemoteSourceError extends Error {
  constructor(
    readonly code: status,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Opens a URL somebody else chose, for storage-service to read an object from.
 *
 * The SSRF control is `libs/common`'s `guarded-target.ts`, applied the way the
 * outbound webhook sender applies it, on **every hop**:
 *
 * - `https:` only;
 * - an IP-literal host judged by `deniedLiteral` before a socket exists (Node
 *   never calls `lookup` for a literal);
 * - a hostname judged inside the socket's own `lookup`, which also pins the
 *   connection to the address that was checked;
 * - no happy-eyeballs, so the socket connects to that one address.
 *
 * **Redirects are followed, at most {@link INGEST_MAX_REDIRECTS} times**, each
 * `Location` re-parsed and re-judged exactly like the first URL — a source
 * behind a CDN redirect still works, and a redirect into private space is
 * refused at the hop that tries it.
 *
 * The development hatch (`INGEST_ALLOW_PRIVATE_SOURCES` under
 * `NODE_ENV=development`) is read through `ConfigService` on every call, so a
 * test can open it per case; under it, a self-signed local certificate is
 * accepted too, because a localhost source is self-signed by nature.
 */
@Injectable()
export class RemoteSourceFetcher {
  /** Overridable resolver — the DNS seam `buildGuardedLookup` promises. */
  resolver: Parameters<typeof buildGuardedLookup>[0]['resolve'] = undefined;

  /** The idle socket timeout — `INGEST_TIMEOUT_MS`, overridable so a test need not wait it out. */
  timeoutMs = INGEST_TIMEOUT_MS;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Refuses a URL that must never be opened, before any I/O.
   *
   * @throws RemoteSourceError `INVALID_ARGUMENT` for an unparseable URL, a
   * scheme other than `https:`, or a private IP literal.
   */
  judge(raw: string | URL): URL {
    let url: URL;
    try {
      url = raw instanceof URL ? raw : new URL(raw);
    } catch {
      throw new RemoteSourceError(
        status.INVALID_ARGUMENT,
        'The source is not a URL',
      );
    }

    if (url.protocol !== 'https:') {
      throw new RemoteSourceError(
        status.INVALID_ARGUMENT,
        'Only https sources are fetched',
      );
    }

    const denied = this.allowPrivate() ? null : deniedLiteral(url.hostname);
    if (denied) {
      throw new RemoteSourceError(
        status.INVALID_ARGUMENT,
        new DeniedTargetError(url.hostname, denied).message,
      );
    }

    return url;
  }

  /**
   * The response body of the source, after following its redirects.
   *
   * The caller owns the returned stream and must consume or destroy it.
   *
   * @throws RemoteSourceError `INVALID_ARGUMENT` for a hop refused by the
   * guard, `FAILED_PRECONDITION` for a non-2xx answer or one redirect too many,
   * `DEADLINE_EXCEEDED` for an idle socket past `INGEST_TIMEOUT_MS`, and
   * `UNAVAILABLE` for any other network failure.
   */
  async open(source: URL): Promise<IncomingMessage> {
    let url = this.judge(source);

    for (let redirects = 0; ; redirects += 1) {
      const response = await this.requestHop(url);
      const code = response.statusCode ?? 0;

      if (code >= 300 && code < 400 && response.headers.location) {
        response.resume();

        if (redirects >= INGEST_MAX_REDIRECTS) {
          throw new RemoteSourceError(
            status.FAILED_PRECONDITION,
            `The source redirected more than ${INGEST_MAX_REDIRECTS} times`,
          );
        }

        url = this.judge(new URL(response.headers.location, url));
        continue;
      }

      if (code < 200 || code >= 300) {
        response.resume();

        throw new RemoteSourceError(
          status.FAILED_PRECONDITION,
          `The source answered ${code}`,
        );
      }

      return response;
    }
  }

  /**
   * One request, one hop — the guarded socket, never a redirect follow.
   *
   * A method rather than inline so a unit spec can stand in for ONE hop and let
   * the next one reach the real guarded lookup.
   */
  requestHop(url: URL): Promise<IncomingMessage> {
    const allowPrivate = this.allowPrivate();

    return new Promise((resolve, reject) => {
      let timedOut = false;
      let body: IncomingMessage | undefined;

      const request = httpsRequest(
        url,
        {
          method: 'GET',
          // The spread-cast is a typings gap: the option reaches
          // `net.connect` at runtime but `https.RequestOptions` omits it.
          ...({ autoSelectFamily: false } as object),
          lookup: buildGuardedLookup({ allowPrivate, resolve: this.resolver }),
          ...(allowPrivate ? { rejectUnauthorized: false } : {}),
          timeout: this.timeoutMs,
          headers: { 'user-agent': 'SynapseDesk-Ingest/1' },
        },
        (response) => {
          body = response;
          resolve(response);
        },
      );

      // An IDLE timeout, so it keeps applying while the body streams: a stall
      // mid-file destroys the body with the same diagnosis, which is what the
      // reader sees as the error it iterates into.
      request.on('timeout', () => {
        timedOut = true;
        const error = new RemoteSourceError(
          status.DEADLINE_EXCEEDED,
          `The source was idle for ${this.timeoutMs} ms`,
        );
        body?.destroy(error);
        request.destroy(error);
      });

      request.on('error', (error) => {
        if (error instanceof RemoteSourceError) {
          reject(error);
        } else if (error instanceof DeniedTargetError) {
          reject(new RemoteSourceError(status.INVALID_ARGUMENT, error.message));
        } else {
          reject(
            new RemoteSourceError(
              timedOut ? status.DEADLINE_EXCEEDED : status.UNAVAILABLE,
              `The source could not be reached: ${error.message}`,
            ),
          );
        }
      });

      request.end();
    });
  }

  private allowPrivate(): boolean {
    return privateTargetsAllowed({
      NODE_ENV: this.configService.get<string>('NODE_ENV'),
      flag: this.configService.get<string>('INGEST_ALLOW_PRIVATE_SOURCES'),
    });
  }
}
