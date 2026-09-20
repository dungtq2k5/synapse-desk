import type { ArgumentsHost } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { status } from '@grpc/grpc-js';
import { AllWsExceptionsFilter } from './ws-exception.filter';

/**
 * The socket `exception` frame.
 *
 * A unit test rather than an e2e row because no handler today lets a gRPC error
 * reach this filter: `message:send`, `presence:update` and `ai:stream:cancel`
 * answer through their ack, and `ticket:join` turns a failed lookup into its
 * own refusal. The filter is the backstop for the handler that does not exist
 * yet, and a backstop is exactly what a suite built from today's handlers
 * cannot reach.
 */
describe('AllWsExceptionsFilter', () => {
  const frameFor = (exception: unknown) => {
    const client = { emit: jest.fn(), nsp: { name: '/ws' } };
    const host = {
      switchToWs: () => ({ getClient: () => client }),
    } as unknown as ArgumentsHost;

    new AllWsExceptionsFilter().catch(exception, host);

    const [[event, frame]] = client.emit.mock.calls as [
      [string, { error: string; statusCode: number }],
    ];
    expect(event).toBe('exception');

    return frame;
  };

  it('**a gRPC transport failure becomes the fixed message, with no address**', () => {
    const failure = Object.assign(
      new Error('14 UNAVAILABLE: No connection established'),
      {
        code: status.UNAVAILABLE,
        details:
          'No connection established. Last error: Error: connect ECONNREFUSED 10.0.3.7:50051',
      },
    );

    const frame = frameFor(failure);

    expect(frame.error).toBe(
      'A service this request depends on is unavailable. Try again shortly!',
    );
    expect(frame.error).not.toMatch(/ECONNREFUSED|10\.0\.3\.7/u);
  });

  it('a WsException and an HttpException keep their own text', () => {
    expect(frameFor(new WsException('No ticket with that id')).error).toBe(
      'No ticket with that id!',
    );
    expect(frameFor(new NotFoundException('Gone')).error).toBe('Gone!');
  });
});
