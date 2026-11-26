import { GatewayTimeoutException, Logger } from '@nestjs/common';
import { status } from '@grpc/grpc-js';
import { grpcCodeOf } from './base-grpc.client';

describe('grpcCodeOf', () => {
  it.each([
    ['a peer status', { code: status.NOT_FOUND }, 'NOT_FOUND'],
    ['OK', { code: status.OK }, 'OK'],
    [
      'the gateway’s own timeout',
      new GatewayTimeoutException(),
      'DEADLINE_EXCEEDED',
    ],
  ])('labels %s by name', (_title, error, label) => {
    expect(grpcCodeOf(error)).toBe(label);
  });

  it.each([
    [
      'a number outside the enum',
      Object.assign(new Error('x'), { code: 99 }),
      'Error (code 99)',
    ],
    ['an error with no code', new TypeError('x'), 'TypeError'],
  ])('labels %s UNKNOWN and logs its type', (_title, error, type) => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const label = grpcCodeOf(error);
    const lines = log.mock.calls.map(([message]) => String(message));
    log.mockRestore();

    expect(label).toBe('UNKNOWN');
    expect(lines).toEqual([expect.stringContaining(type)]);
  });
});
