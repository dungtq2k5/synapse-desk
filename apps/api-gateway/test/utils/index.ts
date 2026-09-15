/**
 * The test-utility barrel.
 *
 * Specs import from `../utils` rather than naming each file, which is what
 * lets a helper move between files here without touching every suite that
 * uses it.
 */

export * from './auth';
export * from './bootstrap';

// `dto-contract` is deliberately NOT re-exported. It is the one helper here
// used by UNIT specs, and this barrel also exports `bootstrap`, which pulls in
// `AppModule` and its config validation — so reaching it through the barrel
// makes a spec that touches no Nest container die with `"PORT" is required`.
// Import it by path: `from '../../../../../test/utils/dto-contract'`.
export * from './grpc-stub';
export * from './realtime';
export * from './tokens';
export * from './standard-webhooks';
