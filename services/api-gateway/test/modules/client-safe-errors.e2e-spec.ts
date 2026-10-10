import { status } from '@grpc/grpc-js';
import { withHttpStatus } from '@synapsedesk/common';
import { throwError } from 'rxjs';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
} from '../utils';
import { grpcError, transportFailure } from '../fixtures/wire';

/**
 * What a client is told when a gRPC call fails — the HTTP half.
 *
 * **The gap**: a peer that was down produced a 503 whose `error` was grpc-js's
 * own text, `No connection established. Last error: … connect ECONNREFUSED
 * <host>:<port>`, in every environment. The rule now is who vouched for the
 * text: a service marks what it writes for a user (`withHttpStatus`), and an
 * unmarked transport-class failure gets a fixed message, with the details
 * logged instead.
 *
 * The socket half is in `realtime.e2e-spec.ts` (the `message:send` ack and
 * `ai:stream:error`) and in `ws-exception.filter.spec.ts`.
 */
describe('Client-safe gRPC errors — HTTP (e2e)', () => {
  let fx: E2eFixture;

  const FIXED =
    'A service this request depends on is unavailable. Try again shortly!';

  const subscription = () =>
    authenticatedAgent(fx.app, { permissionCodes: ['organization.read'] }).get(
      `${API}/billing/subscription`,
    );

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  afterAll(async () => {
    await fx.close();
  });

  it('**a REAL transport failure reaches the client as the fixed message, with no address**', async () => {
    // A genuine grpc-js error from a call to a closed port — the library's own
    // text, which names the host and port it could not reach.
    const failure = await transportFailure();
    expect(failure.code).toBe(status.UNAVAILABLE);
    expect(failure.details).toMatch(/127\.0\.0\.1:\d+/u);

    fx.stubs.billing.getSubscription.mockReturnValue(throwError(() => failure));

    const response = await subscription();

    expect(response.status).toBe(503);
    expect(response.body.error).toBe(FIXED);
    expect(response.body.error).not.toMatch(
      /ECONNREFUSED|127\.0\.0\.1|:\d{2,5}/u,
    );
  });

  it('**text a service MARKED reaches the client verbatim** — same status, same words', async () => {
    fx.stubs.billing.getSubscription.mockReturnValue(
      throwError(() =>
        grpcError(
          status.UNAVAILABLE,
          withHttpStatus(503, 'Billing is not configured on this deployment'),
        ),
      ),
    );

    const response = await subscription();

    expect(response.status).toBe(503);
    expect(response.body.error).toBe(
      'Billing is not configured on this deployment!',
    );
  });

  it('**the same text UNMARKED gets the fixed message** — the marker is the switch', async () => {
    fx.stubs.billing.getSubscription.mockReturnValue(
      throwError(() =>
        grpcError(
          status.UNAVAILABLE,
          'Billing is not configured on this deployment',
        ),
      ),
    );

    const response = await subscription();

    expect(response.status).toBe(503);
    expect(response.body.error).toBe(FIXED);
  });

  it('a business error keeps its own text — only the transport-class codes changed', async () => {
    fx.stubs.billing.getSubscription.mockReturnValue(
      throwError(() =>
        grpcError(status.NOT_FOUND, 'No subscription for this organization'),
      ),
    );

    const response = await subscription();

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('No subscription for this organization!');
  });
});
