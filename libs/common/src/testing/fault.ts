/**
 * Fault injection that cleans up after itself.
 *
 * ```ts
 * const faults = faultInjector();
 *
 * it('leaves the document over-restricted when `documents` fails', async () => {
 *   faults.failOnce(fx.prisma.document, 'update', new Error('injected failure'));
 *   // …no restore here, and none needed even if this line throws.
 * });
 * ```
 *
 * **Never restore in the test body.** A test that throws never reaches its last
 * statement, and a `mockRejectedValueOnce` that was never called stays armed and
 * detonates inside a later test — the "fails in the suite, passes alone" shape.
 * `faultInjector()` registers one `afterEach` and restores unconditionally.
 *
 * **Test-only**: excluded from this library's build.
 */

/**
 * Anything Jest can spy on.
 *
 * Deliberately `object` rather than `Record<string, unknown>`: a class instance
 * (`PrismaService`, a Prisma delegate, `QdrantService`) has no string index
 * signature and is rejected by the stricter type — which would have meant
 * casting at every call site, and a cast at every call site is a helper nobody
 * uses. `K extends keyof T` still keeps the method name checked, which is the
 * part that catches a typo or a rename.
 */
type Spyable = object;

/** The accessor overload of `jest.spyOn`, which its generics hide from us. */
type SpyOnAccessor = (
  target: object,
  property: string,
  accessType: 'get' | 'set',
) => jest.SpyInstance;

export type FaultInjector = {
  /**
   * Replaces a method for THIS TEST ONLY.
   *
   * The escape hatch for a fault that is not a rejection — an ordering probe, a
   * value the caller must cope with, a call that hangs.
   */
  replace: <T extends Spyable, K extends keyof T & string>(
    target: T,
    method: K,
    implementation: T[K],
  ) => jest.SpyInstance;

  /**
   * Observes a method or accessor WITHOUT changing it.
   *
   * Not a fault, but it has the identical teardown hazard: a `jest.spyOn`
   * left un-restored keeps recording into a stale mock across tests, and
   * `clearAllMocks` wipes the call record while leaving the spy attached.
   * Same registry, same `afterEach`.
   */
  spy: <T extends Spyable, K extends keyof T & string>(
    target: T,
    method: K,
    accessType?: 'get' | 'set',
  ) => jest.SpyInstance;

  /**
   * Fails EVERY call until the test ends.
   *
   * Prefer this over `failOnce` unless the test genuinely needs the second call
   * to succeed: "always fails" cannot be left armed, because there is nothing
   * to consume.
   */
  fail: <T extends Spyable, K extends keyof T & string>(
    target: T,
    method: K,
    error: Error,
  ) => jest.SpyInstance;

  /**
   * Fails the FIRST call only.
   *
   * Kept because some assertions need the retry to work — but note this is the
   * shape that leaked: if the path never reaches the method, the rejection is
   * still armed when the test ends. Safe here only because the `afterEach`
   * restores it whether it fired or not.
   */
  failOnce: <T extends Spyable, K extends keyof T & string>(
    target: T,
    method: K,
    error: Error,
  ) => jest.SpyInstance;
};

/**
 * Call at the TOP of a `describe`, not inside a test.
 *
 * It registers the `afterEach` immediately, which Jest only permits during
 * collection — and that constraint is the useful part: the cleanup is attached
 * before any test can run, so it cannot be skipped by an early return.
 */
export function faultInjector(): FaultInjector {
  const spies: jest.SpyInstance[] = [];

  afterEach(() => {
    // `while` rather than `for`, so the list is empty even if a restore throws
    // — a half-drained list would leak the remainder into the next test, which
    // is the exact failure this file exists to prevent.
    while (spies.length > 0) {
      spies.pop()?.mockRestore();
    }
  });

  function track(spy: jest.SpyInstance): jest.SpyInstance {
    spies.push(spy);

    return spy;
  }

  return {
    replace: (target, method, implementation) =>
      track(
        jest
          .spyOn(target, method as never)
          .mockImplementation(implementation as never),
      ),

    spy: (target, method, accessType) =>
      track(
        accessType
          ? // Jest overloads `spyOn` on the accessor argument, and the generic
            // `T`/`K` here narrow the third parameter to `never`. The cast is
            // on the CALL, not on the exported signature — callers still get a
            // checked method name.
            (jest.spyOn as unknown as SpyOnAccessor)(target, method, accessType)
          : jest.spyOn(target, method as never),
      ),

    fail: (target, method, error) =>
      track(
        jest.spyOn(target, method as never).mockRejectedValue(error as never),
      ),

    failOnce: (target, method, error) =>
      track(
        jest
          .spyOn(target, method as never)
          .mockRejectedValueOnce(error as never),
      ),
  };
}
