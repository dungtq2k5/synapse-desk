/** Types for `lcov-merge.cjs`; the behaviour and its reasons are documented there. */

export type LcovFile = {
  lines: Map<number, number>;
  branches: Map<number, Map<string, number>>;
};

export declare function parse(
  text: string,
  root: string,
): Map<string, LcovFile>;
export declare function merge(input: {
  same: string[];
  other: string[];
  root: string;
}): string;
