import { envValidationSchema } from './env.validation';

/**
 * `FIREBASE_STORAGE_EMULATOR_HOST` is refused under NODE_ENV=production: set,
 * presigning hands out the emulator's unsigned upload endpoint instead of a
 * signed URL, so a copied `.env` must stop the boot rather than reach users.
 */
describe('FIREBASE_STORAGE_EMULATOR_HOST is refused in production', () => {
  const verdict = (nodeEnv: string, host: string | undefined): string => {
    const value: Record<string, unknown> = { NODE_ENV: nodeEnv };
    if (host !== undefined) value.FIREBASE_STORAGE_EMULATOR_HOST = host;

    const { error } = envValidationSchema.validate(value, {
      allowUnknown: true,
      abortEarly: false,
    });
    const detail = error?.details.find(
      (item) => item.path[0] === 'FIREBASE_STORAGE_EMULATOR_HOST',
    );

    return detail ? `FAIL:${detail.type}` : 'PASS';
  };

  it.each([
    ['production', 'localhost:9199', 'FAIL:any.unknown'],
    ['production', undefined, 'PASS'],
    ['development', 'localhost:9199', 'PASS'],
    ['test', 'localhost:9199', 'PASS'],
  ])('NODE_ENV=%s host=%s → %s', (nodeEnv, host, expected) => {
    expect(verdict(nodeEnv, host)).toBe(expected);
  });
});
