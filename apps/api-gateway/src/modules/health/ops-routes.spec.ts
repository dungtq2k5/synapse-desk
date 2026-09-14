import {
  API_VERSION,
  API_VERSIONING,
  apiBasePath,
  resolveGlobalPrefix,
} from './ops-routes';

describe('resolveGlobalPrefix (unit)', () => {
  it('1. the LEGACY form and the bare form resolve to the same prefix', () => {
    // The whole of release 1's safety: a ConfigMap, a `.env.test` and every
    // developer's `.env` still say `/api/v1`, and a rollback runs code that
    // expects them to. Both must render the same paths.
    expect(resolveGlobalPrefix('/api/v1')).toBe('api');
    expect(resolveGlobalPrefix('api')).toBe('api');
    expect(resolveGlobalPrefix('/api')).toBe('api');
    expect(resolveGlobalPrefix('api/v1/')).toBe('api');
  });

  it('2. ONLY the legacy form reports itself', () => {
    const legacy = jest.fn();
    const bare = jest.fn();

    resolveGlobalPrefix('/api/v1', legacy);
    resolveGlobalPrefix('api', bare);

    expect(legacy).toHaveBeenCalledTimes(1);
    expect(legacy.mock.calls[0][0]).toContain('GLOBAL_PREFIX = /api/v1');
    expect(bare).not.toHaveBeenCalled();
  });

  it('3. strips only a WHOLE trailing version segment', () => {
    // `/api/v10` is not version 1, and a prefix that merely ends in the letter
    // `v` followed by the digit is not a version at all.
    expect(resolveGlobalPrefix('/api/v10')).toBe('api/v10');
    expect(resolveGlobalPrefix('/apiv1')).toBe('apiv1');
    expect(resolveGlobalPrefix('/gateway/api/v1')).toBe('gateway/api');
  });

  it('4. the base path is the prefix plus the default version, with the slash', () => {
    expect(apiBasePath(resolveGlobalPrefix('/api/v1'))).toBe('/api/v1');
    expect(apiBasePath(resolveGlobalPrefix('api'))).toBe('/api/v1');
    expect(API_VERSIONING.defaultVersion).toBe(API_VERSION);
  });
});
