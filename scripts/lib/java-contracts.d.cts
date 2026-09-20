/** Types for `java-contracts.cjs`; the behaviour and its reasons are documented there. */

export declare const GROUPS: readonly {
  className: string;
  purpose: string;
  exports: readonly string[];
}[];
export declare const PATTERNS_NOT_EXPORTED: Readonly<Record<string, string>>;

export declare function constantName(key: string): string;
export declare function renderAll(
  common: Record<string, unknown>,
): Record<string, string>;
export declare function renderClass(
  group: { className: string; purpose: string; exports: readonly string[] },
  common: Record<string, unknown>,
): string;
export declare function unexportedPatterns(
  common: Record<string, unknown>,
): string[];
