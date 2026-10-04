/** Types for `openapi-export.cjs`; the behaviour and its reasons are documented there. */

export declare const OPENAPI_OUTPUT: 'docs/reference/openapi.json';
export declare const EXPORT_COMMAND: 'npm run openapi:export';
export declare const BUILD_COMMAND: 'turbo run build --filter=@synapsedesk/api-gateway...';
export declare const RUNTIME_OUTPUTS: readonly string[];

export declare function missingOutputs(
  root: string,
  outputs?: readonly string[],
): string[];
export declare function firstDifferingLine(
  expected: string,
  actual: string,
): number | null;

export declare function openapiViolations(document: unknown): string[];
