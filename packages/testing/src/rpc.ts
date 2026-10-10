/**
 * The gRPC assertion helpers every service's e2e suite needs.
 *
 * These were copied into 22 spec files — `rpcCode` 22 times and `expectRpc` 18,
 * byte-identical in every one, across four services. That is not merely
 * repetitive: an assertion helper is the thing a suite trusts to tell it what
 * failed, so a copy that drifted would weaken the suite that held it while
 * every other suite kept reporting correctly.
 *
 * **Test-only, and kept out of the shipped build**: `libs/common`'s
 * `tsconfig.build.json` excludes `src/testing`, so nothing here reaches `dist`.
 * `expectRpc` uses jest's `expect`, which exists only under a test runner —
 * this file must never be imported by service code.
 */

import { RpcException } from '@nestjs/microservices';

/**
 * The gRPC status code carried by an `RpcException`, or undefined.
 *
 * Undefined rather than throwing for a non-RpcException: the caller is usually
 * asserting on a code, and "some other error was thrown" should surface as a
 * failed comparison naming both values, not as a second error that buries the
 * first.
 */
export function rpcCode(error: unknown): number | undefined {
  if (!(error instanceof RpcException)) return undefined;

  return (error.getError() as { code?: number }).code;
}

/**
 * Asserts a promise rejects with an `RpcException` carrying `code`.
 *
 * Both halves matter. The first proves the rejection is an RpcException at all
 * — a plain `Error` would otherwise satisfy a code check by yielding
 * `undefined` on both sides if the expected code were also absent. The second
 * pins the specific code, which is what distinguishes "not allowed" from "not
 * found" from "wrong state" at the REST edge.
 */
export async function expectRpc(
  promise: Promise<unknown>,
  code: number,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(RpcException);
  await promise.catch((error: unknown) => expect(rpcCode(error)).toBe(code));
}
