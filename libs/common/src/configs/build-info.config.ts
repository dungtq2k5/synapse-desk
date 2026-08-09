/**
 * Which build is this? — 23-doc §3.
 *
 * **The endpoint exists for one question**, and it is the first one asked during
 * an incident: *did the fix actually roll out?* Every other way of answering it
 * is inference from deploy timestamps, and inference is what produces twenty
 * minutes of debugging a bug that was already fixed in an image that never
 * shipped.
 */
export type BuildInfo = {
  /** Semver, from `package.json` at build time. */
  version: string;
  /** The git commit the image was built from. */
  sha: string;
  /** ISO 8601, from the build, not from boot. */
  builtAt: string;
};

/**
 * The three variables an image must carry to be able to identify itself.
 *
 * Baked at BUILD time, never read from git at runtime: a container has no
 * `.git`, so a runtime `git rev-parse` returns nothing and the natural fallback
 * is `"unknown"` — which is the answer you get at exactly the moment you need
 * the real one.
 *
 * ```dockerfile
 * ARG GIT_SHA
 * RUN test -n "$GIT_SHA" || (echo 'GIT_SHA build arg is required' && false)
 * ENV BUILD_SHA=$GIT_SHA BUILD_TIME=... APP_VERSION=...
 * ```
 *
 * **Required rather than defaulted**, in every service's env schema. An image
 * that cannot say what it is fails to boot, which is loud and immediate — the
 * alternative is one that boots happily and lies about its identity to the
 * person trying to end an outage.
 */
export const BUILD_INFO_ENV_KEYS = [
  'APP_VERSION',
  'BUILD_SHA',
  'BUILD_TIME',
] as const;

/**
 * Reads the three, and nothing else.
 *
 * **The exact key set is the contract** — 23-doc §3 test 3. This is the endpoint
 * that accretes fields: the Node version, the dependency list and the
 * environment name all look harmless and helpful, and each one turns a support
 * aid into a reconnaissance endpoint on a route that is deliberately public.
 * None of them answer the question above.
 *
 * `getOrThrow` rather than a fallback, for the reason in {@link
 * BUILD_INFO_ENV_KEYS}.
 */
export function readBuildInfo(config: {
  getOrThrow: <T>(key: string) => T;
}): BuildInfo {
  return {
    version: config.getOrThrow<string>('APP_VERSION'),
    sha: config.getOrThrow<string>('BUILD_SHA'),
    builtAt: config.getOrThrow<string>('BUILD_TIME'),
  };
}
