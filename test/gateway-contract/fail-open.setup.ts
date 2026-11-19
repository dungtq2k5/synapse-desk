import { failOpenLines } from '@synapsedesk/testing/fail-open';
import { declaredFailOpen, resetFailOpen } from './fail-open';
import { unreadOutput } from './gateway';

/**
 * Fails a row in which a gateway printed a fail-open line (`FAIL_OPEN_LINES`)
 * it did not declare (`allowFailOpen`), naming the line and the row.
 *
 * The run's Redis is up, so such a line means the store refused a write and the
 * gateway carried on without the protection or the cache. A line printed while
 * a gateway booted, before any row, is charged to the file's first row.
 */
beforeEach(() => resetFailOpen());

afterEach(() => {
  const lines = failOpenLines(unreadOutput(), declaredFailOpen());
  if (lines.length > 0) {
    throw new Error(
      `The gateway failed open during "${expect.getState().currentTestName}":\n${lines.join('\n')}`,
    );
  }
});
