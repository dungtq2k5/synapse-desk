import { envValidationSchema } from './env.validation';

/**
 * What `WEBHOOK_ALLOW_PRIVATE_TARGETS`'s rule does, branch by branch.
 *
 * **The same `when`/`otherwise` shape as auth's password rule, and it deserves
 * the same treatment**: a one-word swap to `then` would refuse the hatch only
 * in development — the single environment where it is supposed to work — and
 * permit it everywhere else, while every structural reading of the file stayed
 * true.
 *
 * This is the NOISE, not the control. `privateTargetsAllowed()`, in
 * `libs/common`'s `guarded-target.ts`, is what actually refuses a private address, and it
 * checks `NODE_ENV` itself: a string check is a courtesy and the enforcement
 * belongs at the socket. What the schema adds is that a
 * production `.env` carrying `=true` fails at `ConfigModule.forRoot` instead of
 * booting and silently ignoring the value.
 */
describe('WEBHOOK_ALLOW_PRIVATE_TARGETS is refused outside development', () => {
  const verdict = (
    nodeEnv: string | undefined,
    hatch: string | undefined,
  ): string => {
    const value: Record<string, unknown> = {};
    if (nodeEnv !== undefined) value.NODE_ENV = nodeEnv;
    if (hatch !== undefined) value.WEBHOOK_ALLOW_PRIVATE_TARGETS = hatch;

    const { error } = envValidationSchema.validate(value, {
      allowUnknown: true,
      abortEarly: false,
    });

    const detail = error?.details.find(
      (item) => item.path[0] === 'WEBHOOK_ALLOW_PRIVATE_TARGETS',
    );

    return detail ? `FAIL:${detail.type}` : 'PASS';
  };

  it.each([
    // The hatch works where it is meant to.
    ['development', 'true', 'PASS'],
    ['development', 'false', 'PASS'],

    // And nowhere else. `production` is the case that mattered; `test` is
    // included because "not development" has to mean every other value, not
    // just the scary one.
    ['production', 'true', 'FAIL:any.only'],
    ['test', 'true', 'FAIL:any.only'],

    // An explicit `false` stays legal everywhere — a deployment that sets the
    // variable to its safe value should not be refused for having an opinion.
    ['production', 'false', 'PASS'],

    // ABSENT is fine in every environment: `.optional()` comes first, and the
    // hatch not being mentioned is the normal production state.
    ['production', undefined, 'PASS'],
    ['development', undefined, 'PASS'],

    // An unset NODE_ENV lands on the refusing side, which is the safe one. A
    // rule keyed on an environment variable is only as good as its behaviour
    // when that variable is missing.
    [undefined, 'true', 'FAIL:any.only'],
  ])('NODE_ENV=%s hatch=%s → %s', (nodeEnv, hatch, expected) => {
    expect(verdict(nodeEnv, hatch)).toBe(expected);
  });
});
