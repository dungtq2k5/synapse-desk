import { Logger } from '@nestjs/common';
import { failOpenLines } from '@synapsedesk/testing/fail-open';
import { declaredFailOpen, resetFailOpen } from './utils/fail-open';

/**
 * Fails a row in which the gateway logged a fail-open line (`FAIL_OPEN_LINES`)
 * it did not declare (`allowFailOpen`).
 *
 * The stack's Redis is up during a run, so such a line means the store refused
 * a write and the gateway carried on without the protection or the cache. The
 * socket limits sat that way, unenforced, until a row read the log.
 *
 * Wraps `Logger.prototype` rather than spying with jest: a row that restores
 * its mocks would otherwise remove the guard without anyone noticing.
 */
const logged: string[] = [];
for (const level of ['warn', 'error'] as const) {
  const original = Logger.prototype[level];
  Logger.prototype[level] = function (
    this: Logger,
    message: unknown,
    ...rest: unknown[]
  ) {
    logged.push(String(message));
    return original.call(this, message, ...rest);
  } as (typeof Logger.prototype)[typeof level];
}

beforeEach(() => {
  logged.length = 0;
  resetFailOpen();
});

afterEach(() => {
  const lines = failOpenLines(logged.join('\n'), declaredFailOpen());
  if (lines.length > 0) {
    throw new Error(
      `The gateway failed open during "${expect.getState().currentTestName}":\n${lines.join('\n')}`,
    );
  }
});
