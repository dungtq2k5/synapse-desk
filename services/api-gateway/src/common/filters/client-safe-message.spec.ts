import { BadRequestException, Logger } from '@nestjs/common';
import { status } from '@grpc/grpc-js';
import { withHttpStatus } from '@synapsedesk/common';
import { clientSafeError, clientSafeMessage } from './client-safe-message';

/** A gRPC `ServiceError` as grpc-js raises it: an `Error` with `code` and `details`. */
const grpc = (code: number, details: string) =>
  Object.assign(new Error(`${code} ${status[code]}: ${details}`), {
    code,
    details,
  });

const ADDRESS_DETAILS =
  'No connection established. Last error: Error: connect ECONNREFUSED 10.0.3.7:50051';

describe('clientSafeError', () => {
  const quiet = { warn: jest.fn(), error: jest.fn() } as unknown as Logger;
  const both = [true, false] as const;

  it.each([
    [
      status.UNAVAILABLE,
      503,
      'A service this request depends on is unavailable. Try again shortly!',
    ],
    [
      status.DEADLINE_EXCEEDED,
      504,
      'A service this request depends on took too long to answer. Try again shortly!',
    ],
    [
      status.CANCELLED,
      408,
      'The request was cancelled before a service answered. Try again!',
    ],
  ])(
    '**unmarked transport code %s → %s and the fixed message, never the details**',
    (code, statusCode, message) => {
      for (const isProduction of both) {
        expect(
          clientSafeError(grpc(code, ADDRESS_DETAILS), { isProduction }),
        ).toEqual({ statusCode, message });
      }
    },
  );

  it('**`isProduction` does not reach the transport rule** — the same text in both environments', () => {
    // Pins the rule against a later "helpful" debug branch: the e2e suites run
    // with the flag off, so a branch keyed on it would let them pass over a
    // path production never takes.
    const [production, development] = both.map((isProduction) =>
      clientSafeMessage(grpc(status.UNAVAILABLE, ADDRESS_DETAILS), {
        isProduction,
      }),
    );

    expect(production).toBe(development);
    expect(production).not.toMatch(/ECONNREFUSED|10\.0\.3\.7|50051/u);
  });

  it('**a MARKED transport message is forwarded**, with the marker stripped', () => {
    expect(
      clientSafeError(
        grpc(
          status.UNAVAILABLE,
          withHttpStatus(503, 'Billing is not configured on this deployment'),
        ),
        { isProduction: true },
      ),
    ).toEqual({
      statusCode: 503,
      message: 'Billing is not configured on this deployment!',
    });
  });

  it('the withheld details are logged, where a developer reads them', () => {
    clientSafeMessage(grpc(status.UNAVAILABLE, ADDRESS_DETAILS), {
      isProduction: true,
      logger: quiet,
      context: 'GET /api/v1/billing/subscription',
    });

    expect(quiet.warn).toHaveBeenCalledWith(
      expect.stringContaining('ECONNREFUSED 10.0.3.7:50051'),
    );
    expect(quiet.warn).toHaveBeenCalledWith(
      expect.stringContaining('GET /api/v1/billing/subscription'),
    );
  });

  it('a business code keeps the service’s text, marked or not', () => {
    expect(
      clientSafeError(grpc(status.NOT_FOUND, 'No such ticket'), {
        isProduction: true,
      }),
    ).toEqual({ statusCode: 404, message: 'No such ticket!' });
    expect(
      clientSafeError(
        grpc(
          status.RESOURCE_EXHAUSTED,
          withHttpStatus(402, 'This workspace has used its AI allowance'),
        ),
        { isProduction: true },
      ),
    ).toEqual({
      statusCode: 402,
      message: 'This workspace has used its AI allowance!',
    });
  });

  it('an HttpException passes through as itself', () => {
    expect(
      clientSafeError(new BadRequestException('email must be an email'), {
        isProduction: true,
      }),
    ).toEqual({ statusCode: 400, message: 'email must be an email!' });
  });

  it('`isProduction` keeps its one meaning: the text of an UNHANDLED error', () => {
    const bug = new TypeError(
      "Cannot read properties of undefined (reading 'id')",
    );

    expect(clientSafeError(bug, { isProduction: true, logger: quiet })).toEqual(
      { statusCode: 500, message: 'Internal server error' },
    );
    expect(
      clientSafeError(bug, { isProduction: false, logger: quiet }).message,
    ).toBe("Cannot read properties of undefined (reading 'id')!");
  });

  it('an unmapped gRPC code is a 500 like any other bug', () => {
    expect(
      clientSafeError(grpc(status.INTERNAL, ADDRESS_DETAILS), {
        isProduction: true,
        logger: quiet,
      }),
    ).toEqual({ statusCode: 500, message: 'Internal server error' });
  });
});
