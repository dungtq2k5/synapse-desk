import {
  CLIENT_ERROR_PATH_MAX,
  CLIENT_ERROR_STACK_KEPT,
} from '@synapsedesk/contracts';
import { stubApi } from '@/test/api';
import {
  installClientErrorReporting,
  MAX_REPORTS,
  reportClientError,
  resetClientErrorReports,
} from './client-errors';

const ROUTE = 'POST /api/v1/client-errors';

describe('client errors', () => {
  beforeEach(() => {
    resetClientErrorReports();
    window.history.replaceState(null, '', '/tickets/42?q=secret#reply');
  });

  it('reports an error once, with the path but not its query or fragment', () => {
    const calls = stubApi({ [ROUTE]: { status: 204 } });
    const error = new Error('Cannot read properties of undefined');

    reportClientError('boundary', error);
    reportClientError('boundary', error);

    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/api/v1/client-errors',
        body: expect.objectContaining({
          kind: 'boundary',
          message: 'Cannot read properties of undefined',
          path: '/tickets/42',
        }),
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain('secret');
  });

  it('**cuts a path one character over the cap**, so the report is still taken', () => {
    const calls = stubApi({ [ROUTE]: { status: 204 } });
    const path = `/${'a'.repeat(CLIENT_ERROR_PATH_MAX)}`;
    window.history.replaceState(null, '', path);

    reportClientError('error', new Error('long path'));

    expect(calls[0].body).toMatchObject({
      path: path.slice(0, CLIENT_ERROR_PATH_MAX),
    });
  });

  it('sends no more stack than the gateway keeps', () => {
    const calls = stubApi({ [ROUTE]: { status: 204 } });
    const error = new Error('deep');
    error.stack = 'x'.repeat(CLIENT_ERROR_STACK_KEPT * 2);

    reportClientError('error', error);

    expect(calls[0].body).toMatchObject({
      stack: 'x'.repeat(CLIENT_ERROR_STACK_KEPT),
    });
  });

  it(`sends at most ${MAX_REPORTS} a page load`, () => {
    const calls = stubApi({ [ROUTE]: { status: 204 } });

    for (let n = 0; n < MAX_REPORTS + 3; n++) {
      reportClientError('error', new Error(`boom ${n}`));
    }

    expect(calls).toHaveLength(MAX_REPORTS);
  });

  it('never throws, whatever the network does', () => {
    stubApi({});

    expect(() => reportClientError('error', 'a string thrown')).not.toThrow();
  });

  it('reports uncaught errors and unhandled rejections once installed', () => {
    const calls = stubApi({ [ROUTE]: { status: 204 } });
    const uninstall = installClientErrorReporting();

    window.dispatchEvent(
      new ErrorEvent('error', { error: new Error('uncaught') }),
    );
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.assign(rejection, { reason: new Error('unhandled') });
    window.dispatchEvent(rejection);
    uninstall();
    // jsdom fails a test on an error event nothing handles; this one is.
    const swallow = (event: Event) => event.preventDefault();
    window.addEventListener('error', swallow);
    window.dispatchEvent(
      new ErrorEvent('error', {
        error: new Error('after uninstall'),
        cancelable: true,
      }),
    );
    window.removeEventListener('error', swallow);

    expect(
      calls.map(({ body }) => [
        (body as { kind: string }).kind,
        (body as { message: string }).message,
      ]),
    ).toEqual([
      ['error', 'uncaught'],
      ['rejection', 'unhandled'],
    ]);
  });
});
