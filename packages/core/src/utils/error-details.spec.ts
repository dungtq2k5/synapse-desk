import { readErrorDetails, withErrorDetails } from './error-details';
import { readHttpStatusHint, withHttpStatus } from './http-status-hint';

describe('error details across the wire (unit)', () => {
  it('round-trips an object and leaves the message intact', () => {
    const details = {
      overLimit: [{ dimension: 'SEATS', inUse: 12, allowed: 10 }],
    };

    expect(readErrorDetails(withErrorDetails('Too big', details))).toEqual({
      details,
      message: 'Too big',
    });
  });

  it('rides behind the HTTP status marker', () => {
    const marked = withHttpStatus(
      402,
      withErrorDetails('Declined', { reason: 'card' }),
    );
    const { httpStatus, message } = readHttpStatusHint(marked);

    expect(httpStatus).toBe(402);
    expect(readErrorDetails(message)).toEqual({
      details: { reason: 'card' },
      message: 'Declined',
    });
  });

  it('survives text that would end a bracket', () => {
    const details = { note: '] [http:200] }' };

    expect(readErrorDetails(withErrorDetails('x', details)).details).toEqual(
      details,
    );
  });

  it('leaves an unmarked, a mid-sentence or a malformed marker as text', () => {
    for (const message of [
      'No document with that id',
      'quoting [details:e30] mid-sentence',
      '[details:!!!] not base64url',
      `[details:${Buffer.from('[1]').toString('base64url')}] an array`,
      `[details:${Buffer.from('{').toString('base64url')}] not JSON`,
    ]) {
      expect(readErrorDetails(message)).toEqual({ details: null, message });
    }
  });
});
