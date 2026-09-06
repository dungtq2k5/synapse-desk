import {
  PUBLISHED_SUPER_ADMIN_PASSWORDS as PUBLISHED,
  envValidationSchema,
} from './env.validation';

/**
 * What `SUPER_ADMIN_PASSWORD`'s rule actually does, branch by branch.
 *
 * **The structural check in `schema-contract.spec.ts` cannot see the failure
 * that matters.** It asserts both published passwords appear in this file and
 * that the constant is referenced near the field — all of which stays true of a
 * rule with `then` where `otherwise` belongs, which refuses the published
 * passwords ONLY in tests and permits them everywhere else. Measured: that
 * one-word inversion passes the structural check unchanged. Behaviour is the
 * only thing that separates them.
 *
 * Two of these rows are subtle rather than obvious:
 *
 *   - **`min(12)` must survive the branch.** Joi concatenates rather than
 *     replaces, so the base constraint holds on both sides — but a future
 *     rewrite that replaced it would silently drop the length rule in every
 *     non-test environment while the `invalid()` list looked like a
 *     tightening.
 *   - **An UNSET `NODE_ENV` must land on the refusing side.** A rule keyed on
 *     an environment variable is only as good as its behaviour when that
 *     variable is missing.
 */
describe('SUPER_ADMIN_PASSWORD refuses the passwords this repo publishes', () => {
  /**
   * Validates the WHOLE object, never an extracted field.
   *
   * `envValidationSchema.extract('SUPER_ADMIN_PASSWORD').validate(…)` is the
   * tidier-looking way to write this and it throws — `Invalid reference exceeds
   * the schema root: ref:NODE_ENV` — because the `when()` reads a sibling that
   * does not exist once the field is lifted out. Inside a `try` that reads like
   * a pass, which is how a table like this ends up asserting nothing.
   */
  const verdict = (nodeEnv: string | undefined, password: string) => {
    const value: Record<string, unknown> = { SUPER_ADMIN_PASSWORD: password };
    if (nodeEnv !== undefined) value.NODE_ENV = nodeEnv;

    const { error } = envValidationSchema.validate(value, {
      allowUnknown: true,
      abortEarly: false,
    });

    const detail = error?.details.find(
      (item) => item.path[0] === 'SUPER_ADMIN_PASSWORD',
    );

    return detail ? `FAIL:${detail.type}` : 'PASS';
  };

  it('the published list is the two values this repo ships', () => {
    // The floor: an empty list would make every FAIL row below pass for the
    // wrong reason — `min(12)` would carry the short-password rows and the
    // published ones would quietly become acceptable.
    expect(PUBLISHED).toHaveLength(2);
  });

  it('**the refusal says what to do about it**', () => {
    // **The rule fired correctly and still cost a debugging session.** Joi's
    // default is `"SUPER_ADMIN_PASSWORD" contains an invalid value`, which
    // names neither the reason nor the remedy — so a developer whose `.env`
    // was written BEFORE this list landed reads a correct refusal as a broken
    // build. The `db:push` path made that worse by surfacing it late: nothing
    // on it validated the environment until `db:schema` was chained on.
    //
    // Asserted rather than trusted, because a `.messages()` block is exactly
    // what a rewrite that moves the `invalid()` call drops in silence — the
    // rows below would all still pass, since the TYPE is unchanged.
    const { error } = envValidationSchema.validate(
      { NODE_ENV: 'development', SUPER_ADMIN_PASSWORD: PUBLISHED[1] },
      { allowUnknown: true, abortEarly: false },
    );

    const message =
      error?.details.find((item) => item.path[0] === 'SUPER_ADMIN_PASSWORD')
        ?.message ?? '';

    expect(message).not.toContain('contains an invalid value');
    // The three things a reader needs: which file, which escape hatch does
    // NOT apply, and that the value is readable by anyone.
    expect(message).toContain('apps/auth-service/.env');
    expect(message).toContain('NODE_ENV=test');
    expect(message).toContain('PUBLISHED');
  });

  it.each([
    ['test', PUBLISHED[1], 'PASS'],
    ['production', PUBLISHED[1], 'FAIL:any.invalid'],
    ['production', PUBLISHED[0], 'FAIL:any.invalid'],
    ['development', PUBLISHED[1], 'FAIL:any.invalid'],
    ['production', 'short', 'FAIL:string.min'],
    ['test', 'short', 'FAIL:string.min'],
    [undefined, PUBLISHED[1], 'FAIL:any.invalid'],
  ])('NODE_ENV=%s password=%s → %s', (nodeEnv, password, expected) => {
    expect(verdict(nodeEnv, password)).toBe(expected);
  });
});
