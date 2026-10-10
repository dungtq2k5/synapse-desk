import { readHttpStatusHint, withHttpStatus } from './http-status-hint';

/**
 * The 402 carrier, tested for the property that made it necessary: only `code`
 * and `details` survive a gRPC hop, so the status has to live inside the
 * message or it does not arrive at all.
 */
describe('the HTTP status hint (unit)', () => {
  it('round-trips a status and leaves the message intact', () => {
    const marked = withHttpStatus(402, 'Out of AI allowance');

    expect(readHttpStatusHint(marked)).toEqual({
      httpStatus: 402,
      message: 'Out of AI allowance',
    });
  });

  it('leaves an UNMARKED message completely alone', () => {
    // Almost every message. A helper that mangled ordinary text would corrupt
    // every error in the system to serve one case.
    expect(readHttpStatusHint('No document with that id')).toEqual({
      httpStatus: null,
      message: 'No document with that id',
    });
  });

  it('does not let a message CHOOSE an implausible status', () => {
    // User-influenced text can reach an error message. A message beginning
    // "[http:999]" must be treated as text, not obeyed — otherwise a crafted
    // input picks its own response code.
    expect(readHttpStatusHint('[http:999] nice try')).toEqual({
      httpStatus: null,
      message: '[http:999] nice try',
    });
  });

  it('ignores a marker that is not at the START', () => {
    // Only a leading marker counts, so a message quoting one mid-sentence is
    // just a message.
    const message = 'the service returned [http:402] unexpectedly';

    expect(readHttpStatusHint(message)).toEqual({ httpStatus: null, message });
  });

  it('accepts the full plausible range and nothing outside it', () => {
    expect(readHttpStatusHint('[http:100] x').httpStatus).toBe(100);
    expect(readHttpStatusHint('[http:599] x').httpStatus).toBe(599);
    expect(readHttpStatusHint('[http:099] x').httpStatus).toBeNull();
    expect(readHttpStatusHint('[http:600] x').httpStatus).toBeNull();
  });

  it('tolerates an empty message after the marker', () => {
    expect(readHttpStatusHint('[http:402]')).toEqual({
      httpStatus: 402,
      message: '',
    });
  });
});
