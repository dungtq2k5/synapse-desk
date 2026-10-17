import { envValidationSchema } from './env.validation';

/** The offline switch: honoured off production, refused on it. */
describe('INGESTION_OFFLINE_MODEL (unit)', () => {
  /** Which keys the schema refuses, the other required ones aside. */
  const refused = (env: Record<string, unknown>) => {
    const { error, value } = envValidationSchema.validate(env, {
      allowUnknown: true,
      abortEarly: false,
    });
    return {
      keys: (error?.details ?? []).map((detail) => detail.path.join('.')),
      value: value as Record<string, unknown>,
    };
  };

  it('needs no Gemini key in development, and reads as true', () => {
    const { keys, value } = refused({
      NODE_ENV: 'development',
      INGESTION_OFFLINE_MODEL: 'true',
    });

    expect(keys).not.toContain('GEMINI_API_KEY');
    expect(keys).not.toContain('INGESTION_OFFLINE_MODEL');
    expect(value.INGESTION_OFFLINE_MODEL).toBe(true);
  });

  it('is refused under production', () => {
    const { keys } = refused({
      NODE_ENV: 'production',
      INGESTION_OFFLINE_MODEL: 'true',
      GEMINI_API_KEY: 'key',
    });

    expect(keys).toContain('INGESTION_OFFLINE_MODEL');
  });

  it('still asks for the key without it', () => {
    const { keys, value } = refused({ NODE_ENV: 'development' });

    expect(keys).toContain('GEMINI_API_KEY');
    expect(value.INGESTION_OFFLINE_MODEL).toBe(false);
  });
});
