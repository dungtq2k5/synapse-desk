/**
 * @file Remove what this run started, and FAIL if anything survived.
 *
 * "Nothing left running afterwards" is an acceptance row; asserting it here
 * makes the run that leaked a container the run that reports it, rather than
 * the next developer wondering whose Redis is on a random port.
 */

import { stillRunning, stopInfra } from './infra';
import { readRunState, removeRunState } from './run-state';

export default function globalTeardown(): void {
  const { containers } = readRunState();

  stopInfra(containers);
  const survivors = stillRunning(containers);
  removeRunState();

  if (survivors.length > 0) {
    throw new Error(
      `The harness leaked ${survivors.length} container(s): ${survivors.join(', ')}`,
    );
  }
}
