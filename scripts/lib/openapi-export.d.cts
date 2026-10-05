/** Types for `openapi-export.cjs`; the behaviour and its reasons are documented there. */

export declare const OPENAPI_OUTPUT: 'docs/reference/openapi.json';
export declare const EXPORT_COMMAND: 'npm run openapi:export';
export declare function firstDifferingLine(
  expected: string,
  actual: string,
): number | null;

export declare function openapiViolations(document: unknown): string[];
