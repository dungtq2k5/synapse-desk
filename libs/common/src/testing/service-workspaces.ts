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
 * `api-gateway-java` reads `apps/api-gateway/.env.example` and its ConfigMap:
 * `generate-k8s-config.mjs` names the ConfigMap and Secret after the directory
 * that holds `.env.example`, and the Deployment mounts them by those names.
 *
 * The guards read such a workspace as its owner, so the shared file is checked
 * once; the Java module's binding of it is checked on the Java side
 * (`EnvBindingContractTest`), where the bound keys actually are.
 */
export const SHARES_ENVIRONMENT_WITH: Readonly<Record<string, string>> = {
  'api-gateway-java': 'api-gateway',
};

/**
 * The services whose environments the guards check: each workspace, with one that
 * shares an environment standing for that environment's owner.
 */
export function withOwnEnvironment(services: string[]): string[] {
  return [
    ...new Set(
      services.map((service) => SHARES_ENVIRONMENT_WITH[service] ?? service),
    ),
  ];
}
