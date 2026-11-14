/**
 * @file `ai:reembed`'s arguments and its guard, apart from the script: the
 * script builds a Nest context whose config validates the whole environment
 * as it loads, so these are importable without one.
 */

import { AI_PROVIDERS, AiProvider } from '@synapsedesk/contracts';

export type Args = {
  model?: AiProvider;
  drop?: AiProvider;
  /** The operator says rag-service and ingestion-service have exited. */
  servicesStopped?: boolean;
};

/** `--model ollama` / `--drop gemini`, and `--services-stopped`. */
export function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--services-stopped') {
      args.servicesStopped = true;
      continue;
    }
    if (flag !== '--model' && flag !== '--drop') continue;
    const value = argv[++i] as AiProvider;
    if (!AI_PROVIDERS.includes(value)) {
      throw new Error(
        `${flag} takes ${AI_PROVIDERS.join(' or ')}, not '${value}'.`,
      );
    }
    args[flag === '--model' ? 'model' : 'drop'] = value;
  }
  if (Boolean(args.model) === Boolean(args.drop)) {
    throw new Error(
      'Usage: npm run ai:reembed -- --model <gemini|ollama>  (or --drop <gemini|ollama>)',
    );
  }
  return args;
}

/**
 * Refuses a run against the ACTIVE collection, unless the operator says the
 * services have exited.
 *
 * The active collection is the one ingestion-service writes to while it runs.
 * A run against it races ingestion: a chunk written during the run has a point
 * the run's snapshot never saw, so the run deletes it. The switch never needs
 * that (its catch-up runs against the NEW model, with the services stopped),
 * so only a deliberate repair does, and `--services-stopped` says so.
 *
 * Reads the environment this script runs with: it catches the common mistake,
 * not one made with another environment's switch.
 *
 * @example
 * refuseActive('ollama', 'ollama', false) // throws
 * refuseActive('ollama', 'gemini', false) // the switch's pre-fill: allowed
 */
export function refuseActive(
  target: AiProvider,
  configured: AiProvider,
  servicesStopped: boolean,
): void {
  if (target !== configured || servicesStopped) return;
  throw new Error(
    `AI_EMBEDDING_PROVIDER is ${configured}, so --model ${target} is the ACTIVE ` +
      'collection. Never run ai:reembed against the active collection while ' +
      'the services run: it can delete points ingestion is writing. Stop ' +
      'rag-service and ingestion-service, check they have exited, then run ' +
      'it again with --services-stopped.',
  );
}
