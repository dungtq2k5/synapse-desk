/**
 * Which `apps/<service>` directories are SERVICES with an environment of their own.
 *
 * Several guards enumerate services the same way — every
 * `apps/<service>/package.json` — because deriving the list beats maintaining one: a service added without
 * a `.env.example`, a probe or a ConfigMap then fails loudly instead of being
 * quietly uncovered. That derivation has one exception, and it needs to be
 * stated once rather than spelled differently in each guard.
 */

/**
 * Workspaces that deliberately have no environment of their own, and the
 * service whose environment they share.
 *
 * `api-gateway-java` is the SAME gateway, in a second language: the two
 * implementations read the same variables, from one `.env.example` and one
 * ConfigMap, and only one of them serves at a time (the implementation lease).
 * A second `.env.example` would be a second source of truth for one set of
 * values — and the one that drifts is whichever implementation is standing by,
 * so the drift would surface at a switch rather than at a deploy.
 *
 * **This is an exclusion from the env corpus, not from coverage.** The Java
 * module's binding is checked against the SHARED file on the Java side, where
 * the bound keys actually are; a guard here could only compare a file to
 * itself.
 */
export const SHARES_ENVIRONMENT_WITH: Readonly<Record<string, string>> = {
  'api-gateway-java': 'api-gateway',
};

/** Drops the workspaces that have no environment of their own. */
export function withOwnEnvironment(services: string[]): string[] {
  return services.filter((service) => !(service in SHARES_ENVIRONMENT_WITH));
}
