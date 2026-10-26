import { clientErrorsControllerReportV1 } from '@synapsedesk/api-client';

/** What reported the error: the window, a promise, or an error boundary. */
export type ClientErrorKind = 'error' | 'rejection' | 'boundary';

/** The most a page load reports; a loop of errors sends no more than this. */
export const MAX_REPORTS = 5;

const MESSAGE_MAX = 1000;
const STACK_MAX = 4000;

const reported = new Set<string>();

/**
 * Reports a browser error to the gateway (`POST /api/v1/client-errors`), which
 * logs it and stores nothing. At most {@link MAX_REPORTS} a page load, and
 * the same error once. The path goes without its query or fragment, and
 * nothing from the page is sent. Never throws, and never waits.
 *
 * `fetch` with `keepalive` rather than `navigator.sendBeacon`: it carries
 * JSON, which the gateway requires, and still survives the page unloading.
 *
 * @example reportClientError('boundary', error)
 */
export function reportClientError(kind: ClientErrorKind, error: unknown): void {
  const { message, stack } = describe(error);
  const key = `${kind}|${message}|${stack?.split('\n', 2)[1] ?? ''}`;
  if (reported.has(key) || reported.size >= MAX_REPORTS) return;
  reported.add(key);

  try {
    clientErrorsControllerReportV1(
      {
        kind,
        message: message.slice(0, MESSAGE_MAX),
        stack: stack?.slice(0, STACK_MAX),
        path: globalThis.location?.pathname ?? '/',
        buildId: process.env.NEXT_PUBLIC_BUILD_ID,
      },
      { keepalive: true },
    ).catch(() => undefined);
  } catch {
    // Reporting must never be the second error.
  }
}

/**
 * Reports what nothing else catches: uncaught errors and unhandled
 * rejections. Returns the uninstall, for an effect's cleanup.
 */
export function installClientErrorReporting(): () => void {
  const onError = (event: ErrorEvent) =>
    reportClientError('error', event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) =>
    reportClientError('rejection', event.reason);

  globalThis.addEventListener('error', onError);
  globalThis.addEventListener('unhandledrejection', onRejection);
  return () => {
    globalThis.removeEventListener('error', onError);
    globalThis.removeEventListener('unhandledrejection', onRejection);
  };
}

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack };
  }
  return { message: typeof error === 'string' ? error : String(error) };
}

/** Forgets what was reported, as a new page load does. For tests. */
export function resetClientErrorReports(): void {
  reported.clear();
}
