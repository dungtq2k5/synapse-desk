import { envValidationSchema } from './env.validation';

/**
 * What `INGEST_ALLOW_PRIVATE_SOURCES`'s schema rule actually permits.
 *
 * This is the NOISE, not the control. `privateTargetsAllowed()`, in
 * `libs/common`'s `guarded-target.ts`, is what refuses a private source, and
 * it checks `NODE_ENV` itself. What the schema adds is that a production
 * `.env` carrying `=true` fails at `ConfigModule.forRoot` instead of booting
 * and silently ignoring the value.
 */
describe('INGEST_ALLOW_PRIVATE_SOURCES is refused outside development', () => {
  const verdict = (
    nodeEnv: string | undefined,
    hatch: string | undefined,
  ): string => {
    const value: Record<string, unknown> = {};
    if (nodeEnv !== undefined) value.NODE_ENV = nodeEnv;
    if (hatch !== undefined) value.INGEST_ALLOW_PRIVATE_SOURCES = hatch;

    const { error } = envValidationSchema.validate(value, {
      allowUnknown: true,
      abortEarly: false,
    });

    const detail = error?.details.find(
      (item) => item.path[0] === 'INGEST_ALLOW_PRIVATE_SOURCES',
    );

    return detail ? `FAIL:${detail.type}` : 'PASS';
  };

  it.each([
    ['development', 'true', 'PASS'],
    ['development', 'false', 'PASS'],
    // Every other environment — `test` included, which is why the e2e suite
    // opens the hatch per test rather than in `.env.test`.
    ['production', 'true', 'FAIL:any.only'],
    ['test', 'true', 'FAIL:any.only'],
    ['production', 'false', 'PASS'],
    ['production', undefined, 'PASS'],
    // An unset NODE_ENV lands on the refusing side.
    [undefined, 'true', 'FAIL:any.only'],
  ])('NODE_ENV=%s hatch=%s → %s', (nodeEnv, hatch, expected) => {
    expect(verdict(nodeEnv, hatch)).toBe(expected);
  });
});
