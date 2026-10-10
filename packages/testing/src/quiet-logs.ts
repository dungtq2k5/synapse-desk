import { Logger } from '@nestjs/common';

/**
 * Silences Nest's logger for every Jest project that extends
 * `jest.config.base.ts`, unit and e2e alike, so a run prints results and
 * failures rather than application logs.
 *
 * `TEST_LOGS=1` leaves logging on, for debugging a failure. A spy on `Logger`
 * still records its calls either way: this switches off the output, not the
 * calls.
 *
 * @example TEST_LOGS=1 npm run test:e2e:auth
 */
if (process.env.TEST_LOGS !== '1') {
  Logger.overrideLogger(false);
  // And it stays off. `Test.createTestingModule(...).compile()` installs Nest's
  // `TestingLogger` through this same method, and that logger still prints
  // errors; `app.useLogger()` goes through it too.
  Logger.overrideLogger = () => undefined;
}
