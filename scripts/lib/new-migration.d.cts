/** Types for `new-migration.cjs`; the behavior and its reasons are documented there. */

export declare function migrationFolder(
  name: string | undefined,
  now?: Date,
  cwd?: string,
): string;
export declare function hasChanges(sql: string): boolean;
