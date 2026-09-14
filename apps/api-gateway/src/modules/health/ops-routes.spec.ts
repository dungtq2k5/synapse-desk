import {
  API_VERSION,
  API_VERSIONING,
  apiBasePath,
  resolveGlobalPrefix,
} from './ops-routes';

describe('resolveGlobalPrefix and apiBasePath (unit)', () => {
  it('1. both accepted spellings give the same bare prefix', () => {
    expect(resolveGlobalPrefix('api')).toBe('api');
    expect(resolveGlobalPrefix('/api')).toBe('api');
  });

  it('2. **a versioned value is NOT quietly repaired here**', () => {
    // Refusing it is the env schema's job, at boot, with the field named. A
    // resolver that stripped the version would let a stale value keep working
    // silently — the migration shim this replaced, left in place forever.
    expect(resolveGlobalPrefix('/api/v1')).toBe('api/v1');
  });

  it('3. the base path is the prefix plus the default version, with the slash', () => {
    expect(apiBasePath(resolveGlobalPrefix('api'))).toBe('/api/v1');
    expect(apiBasePath(resolveGlobalPrefix('/api'))).toBe('/api/v1');
    expect(API_VERSIONING.defaultVersion).toBe(API_VERSION);
  });
});
