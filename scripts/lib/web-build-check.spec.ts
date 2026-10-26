import {
  budgetFor,
  budgetsFrom,
  overBudget,
  secretsIn,
} from './web-build-check.cjs';

describe('web-build-check', () => {
  const stats = [
    { route: '/tickets', firstLoadUncompressedJsBytes: 1_000_000 },
    { route: '/login', firstLoadUncompressedJsBytes: 500_000 },
  ];

  it('budgets today’s size plus 10%, rounded up to a KiB', () => {
    expect(budgetFor(1_000_000)).toBe(1_100_800);
    expect(budgetsFrom(stats)).toEqual({
      '/login': budgetFor(500_000),
      '/tickets': budgetFor(1_000_000),
    });
  });

  it('passes every route within its budget', () => {
    expect(overBudget(stats, budgetsFrom(stats))).toEqual([]);
  });

  it('fails a route over its budget, with both numbers', () => {
    const budgets = { ...budgetsFrom(stats), '/tickets': 999_000 };

    expect(overBudget(stats, budgets)).toEqual([
      '/tickets: 1000000 bytes of first-load JavaScript, over its budget of 999000 by 1000',
    ]);
  });

  it('fails a route with no budget, and a budget with no route', () => {
    expect(
      overBudget(stats, { '/tickets': 2_000_000, '/gone': 1 }).map(
        (problem) => problem.split(':')[0],
      ),
    ).toEqual(['/login', '/gone']);
  });

  it.each([
    ['a credential variable’s name', 'process.env.STRIPE_SECRET_KEY'],
    ['a private key', '-----BEGIN PRIVATE KEY-----\nMIIE'],
    ['a Stripe secret key', 'const k="sk_test_51ABCDEFGHIJKLMNOPQRSTUV"'],
    ['a webhook secret', '"whsec_ABCDEFGHIJKLMNOPQRSTUV"'],
    ['a database URL with a password', '"postgresql://app:hunter2@db:5432/x"'],
    ['a postgres:// URL with a password', '"postgres://app:hunter2@db/x"'],
    ['a Redis URL with a password', '"redis://default:hunter2@cache:6379"'],
    ['a Redis URL with a password only', '"redis://:hunter2@cache:6379"'],
  ])('finds %s in a client file', (_what, text) => {
    expect(secretsIn(text, ['STRIPE_SECRET_KEY'])).not.toEqual([]);
  });

  it.each([
    ['a database URL without a password', '"postgresql://db:5432/x"'],
    ['a Redis URL without a password', '"redis://cache:6379"'],
  ])('finds nothing in %s', (_what, text) => {
    expect(secretsIn(text, [])).toEqual([]);
  });

  it.each([
    ['postgres', `postgres://${':'.repeat(100_000)}`],
    ['redis', `redis://${':'.repeat(100_000)}`],
  ])('**finishes at once on a long %s URL with no `@`**', (_what, text) => {
    const start = performance.now();
    secretsIn(text, []);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('finds nothing in ordinary client code', () => {
    expect(
      secretsIn('fetch("/api/v1/tickets");const STRIPE="pk";const key="sk_";', [
        'STRIPE_SECRET_KEY',
        'GEMINI_API_KEY',
      ]),
    ).toEqual([]);
  });
});
