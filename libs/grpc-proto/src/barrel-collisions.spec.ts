import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `export *` in `index.ts` silently DROPS any name two generated modules both
 * export. No error, no warning — the symbol is simply absent from the public
 * API, and the first sign is an import that resolves to `undefined` at runtime.
 *
 * **This is not hypothetical.** `buf.gen.yaml` sets `exportCommonSymbols=false`
 * precisely because six modules emitted `protobufPackage` and it vanished; the
 * proto comment on `AiRateValue` records a `RateValue` that collided across two
 * packages; and adding `AnswerStatus` to `synapsedesk.ticket` — where
 * `synapsedesk.rag` already had one — deleted rag's from the barrel with
 * nothing anywhere saying so. That last one is why this file exists: the
 * collision was found by a throwaway script, and a throwaway script does not
 * run on the next person's branch.
 *
 * Read out of the files rather than restated, following `mime.spec.ts` and
 * `column-bounds.spec.ts`: a list of known-good names hard-coded here would
 * agree with a barrel that had already lost something.
 */
describe('the generated barrel exports every name it re-exports', () => {
  const root = __dirname;

  const modulePaths = readFileSync(join(root, 'index.ts'), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith("export * from './generated"))
    .map((line) => /'([^']+)'/.exec(line)![1]);

  const exportsOf = (modulePath: string): string[] => {
    const source = readFileSync(
      join(root, `${modulePath.replace(/^\.\//, '')}.ts`),
      'utf8',
    );

    return [
      ...source.matchAll(
        /^export (?:declare )?(?:const|enum|interface|type|function|class) (\w+)/gm,
      ),
    ].map((match) => match[1]);
  };

  it('lists modules that exist and export something', () => {
    // Guards the guard: a renamed generated file, or a regex that stopped
    // matching ts-proto's output, would make the assertion below vacuously
    // true of an empty set.
    expect(modulePaths.length).toBeGreaterThan(15);
    expect(exportsOf(modulePaths[0]).length).toBeGreaterThan(0);
  });

  it('**no two modules export the same name**', () => {
    const owner = new Map<string, string>();
    const collisions: string[] = [];

    for (const modulePath of modulePaths) {
      for (const name of exportsOf(modulePath)) {
        const previous = owner.get(name);
        if (previous) {
          collisions.push(`${name}: ${previous} <-> ${modulePath}`);
        } else {
          owner.set(name, modulePath);
        }
      }
    }

    // Prefix the NEWER one in the .proto, as `AiRateValue` and
    // `MessageAnswerStatus` both do. Renaming in `index.ts` is not an option —
    // `export *` has no rename form.
    expect(collisions).toEqual([]);
  });
});
