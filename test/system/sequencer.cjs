const Sequencer = require('@jest/test-sequencer').default;

/**
 * Runs spec files in PATH order.
 *
 * **Jest's default sequencer sorts by file SIZE**, largest first — so naming a
 * file `zz-` guarantees nothing, and the harness check that stops
 * `notification-service` ran before the smoke test that asserts every service
 * holds its port. Smoke then failed on 5005 being free, describing a fleet the
 * suite itself had dismantled.
 *
 * The `zz-` prefix is the intent; this is what makes it true. One file in this
 * suite is destructive by design and it has to be last.
 */
class PathOrderSequencer extends Sequencer {
  sort(tests) {
    return [...tests].sort((a, b) => a.path.localeCompare(b.path));
  }
}

module.exports = PathOrderSequencer;
