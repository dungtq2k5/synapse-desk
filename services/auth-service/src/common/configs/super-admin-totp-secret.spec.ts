import { envValidationSchema } from './env.validation';

/** `SUPER_ADMIN_TOTP_SECRET`: a base32 secret, never under production. */
describe('SUPER_ADMIN_TOTP_SECRET', () => {
  const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

  /** The whole object, so the `when()` can read `NODE_ENV`. */
  const verdict = (nodeEnv: string, secret: string) => {
    const { error } = envValidationSchema.validate(
      { NODE_ENV: nodeEnv, SUPER_ADMIN_TOTP_SECRET: secret },
      { allowUnknown: true, abortEarly: false },
    );
    const detail = error?.details.find(
      (item) => item.path[0] === 'SUPER_ADMIN_TOTP_SECRET',
    );
    return detail ? `FAIL:${detail.type}` : 'PASS';
  };

  it.each([
    ['development', SECRET, 'PASS'],
    ['test', SECRET, 'PASS'],
    ['production', SECRET, 'FAIL:any.unknown'],
    ['development', 'not-base32!', 'FAIL:string.pattern.base'],
    ['development', 'JBSWY3DP', 'FAIL:string.pattern.base'],
  ])('under %s, %s is %s', (nodeEnv, secret, expected) => {
    expect(verdict(nodeEnv, secret)).toBe(expected);
  });
});
