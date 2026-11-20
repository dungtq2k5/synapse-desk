import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A handler that returns data publishes it: `@ApiWrappedResponse()` with no
 * type documents an envelope whose `data` is empty (`ApiResponseVoid`), so it
 * belongs only on a handler that returns `void`. Seven routes returned data
 * under it (the presigned uploads, a download, two session revokes, the two
 * webhook acknowledgements) and a generated client typed their data as
 * nothing.
 *
 * Read from the source, from each untyped decorator to the return type of the
 * handler it sits on.
 */
describe('@ApiWrappedResponse() with no type', () => {
  const root = join(__dirname, '../../modules');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return full.endsWith('.controller.ts') ? [full] : [];
    });

  const untyped = walk(root).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return [
      ...source.matchAll(/@ApiWrappedResponse\(\s*(?:undefined\s*,[^)]*)?\)/g),
    ].map((match) => {
      // The handler's signature closes with `): <return type> {`; a parameter
      // decorator's `)` is never followed by `:`.
      const rest = source.slice(match.index + match[0].length);
      const returns = /\):\s*(?:Promise<)?([^{;]+?)>?\s*\{/.exec(rest)?.[1];
      const line = source.slice(0, match.index).split('\n').length;
      return {
        at: `${relative(root, file)}:${line}`,
        returns: returns?.trim(),
      };
    });
  });

  it('**sits only on a handler that returns `void`**', () => {
    expect(untyped.length).toBeGreaterThan(0);
    expect(untyped.filter(({ returns }) => returns !== 'void')).toEqual([]);
  });
});
