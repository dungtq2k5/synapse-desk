/** Types for `web-build-check.cjs`; the behaviour and its reasons are documented there. */

export type RouteStats = {
  route: string;
  firstLoadUncompressedJsBytes: number;
};

export declare function budgetFor(bytes: number): number;
export declare function budgetsFrom(
  stats: RouteStats[],
): Record<string, number>;
export declare function overBudget(
  stats: RouteStats[],
  budgets: Record<string, number>,
): string[];
export declare function secretsIn(text: string, names: string[]): string[];
