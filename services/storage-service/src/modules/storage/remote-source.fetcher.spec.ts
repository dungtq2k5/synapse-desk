import type { IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import { status } from '@grpc/grpc-js';
import {
  RemoteSourceError,
  RemoteSourceFetcher,
} from './remote-source.fetcher';

/**
 * A redirect INTO private space, refused at the hop that tries it.
 *
 * **Why a unit spec and not an e2e row.** With the hatch closed nothing local
 * is reachable, so no real first hop can answer the 302; with it open, private
 * addresses are allowed on every hop and the refusal cannot be seen. So the
 * first hop alone is stood in for — a 302 — and the second goes through the
 * real `judge` and the real guarded `https.request`. Nothing here touches the
 * network: a literal is refused before a socket exists, and a hostname is
 * refused inside the lookup, before a connection does.
 */
describe('RemoteSourceFetcher — every redirect hop is re-judged', () => {
  const fetcher = new RemoteSourceFetcher({
    get: (key: string) => (key === 'NODE_ENV' ? 'production' : undefined),
  } as unknown as ConfigService);

  /** A 302 pointing at `location`, standing in for one real response. */
  const redirectTo = (location: string): IncomingMessage =>
    Object.assign(new PassThrough(), {
      statusCode: 302,
      headers: { location },
    }) as unknown as IncomingMessage;

  const refusal = async (attempt: Promise<unknown>) => {
    const error = await attempt.then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(RemoteSourceError);
    return error as RemoteSourceError;
  };

  afterEach(() => {
    jest.restoreAllMocks();
    fetcher.resolver = undefined;
  });

  it('**a 302 to a private IP literal is refused before a second request**', async () => {
    const hop = jest
      .spyOn(fetcher, 'requestHop')
      .mockResolvedValueOnce(redirectTo('https://10.0.0.5/object'));

    const error = await refusal(
      fetcher.open(new URL('https://attachments.example.test/object')),
    );

    expect(error.code).toBe(status.INVALID_ARGUMENT);
    expect(error.message).toContain('10.0.0.5');
    // The first hop only: the literal never got a request of its own.
    expect(hop).toHaveBeenCalledTimes(1);
  });

  it('**a 302 to a hostname RESOLVING private is refused inside the lookup**', async () => {
    // The second hop is the real request, so the refusal comes from the
    // guarded lookup the socket would have connected through.
    jest
      .spyOn(fetcher, 'requestHop')
      .mockResolvedValueOnce(
        redirectTo('https://internal.example.test/object'),
      );
    fetcher.resolver = ((
      _host: string,
      _options: unknown,
      callback: (
        error: null,
        addresses: { address: string; family: number }[],
      ) => void,
    ) => callback(null, [{ address: '169.254.169.254', family: 4 }])) as never;

    const error = await refusal(
      fetcher.open(new URL('https://attachments.example.test/object')),
    );

    expect(error.code).toBe(status.INVALID_ARGUMENT);
    expect(error.message).toContain('169.254.169.254');
  });
});
