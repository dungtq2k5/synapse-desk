/**
 * @file Writes `src/styles/tokens.css` from the designer's DTCG export in
 * `design-tokens/` (copied from Figma, never hand-edited): the primitives and
 * the Light semantics on `:root`, the Dark semantics on `.dark`.
 *
 * **Names come from each token's Figma code syntax**
 * (`$extensions["com.figma"].codeSyntax.WEB`), never from its path: the
 * designer's rule maps `color.primary.default` to `--primary`, and a status keeps
 * the enum's underscore. A token that becomes a CSS variable and has no code
 * syntax fails the build. Typography composites are Figma text styles built from
 * variables that do have one, so they're not emitted.
 *
 *   node scripts/build-tokens.mjs
 */
import StyleDictionary from 'style-dictionary';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(HERE, '../design-tokens');
const OUTPUT = join(HERE, '../src/styles/');

/** The CSS variable a token's Figma code syntax names: `var(--x)` → `x`. */
function webName(token) {
  const web = token.$extensions?.['com.figma']?.codeSyntax?.WEB;
  const match = typeof web === 'string' && /^var\(--([\w-]+)\)$/.exec(web);
  if (!match) {
    throw new Error(
      `Token ${token.path.join('.')} has no Figma WEB code syntax; ` +
        'every token emitted as a CSS variable needs one.',
    );
  }
  return match[1];
}

StyleDictionary.registerTransform({
  name: 'name/figma-web',
  type: 'name',
  transform: (token) => webName(token),
});

const emitted = (token) => token.$type !== 'typography';
const isSemantic = (token) => !token.filePath.endsWith('primitives.json');

/** One mode: the primitives plus that mode's semantics, as CSS variables. */
function mode(semanticFile, selector, filter, destination) {
  return new StyleDictionary({
    usesDtcg: true,
    log: { verbosity: 'silent', warnings: 'disabled' },
    source: [join(TOKENS, 'primitives.json'), join(TOKENS, semanticFile)],
    platforms: {
      css: {
        transformGroup: 'css',
        transforms: [
          'attribute/cti',
          'name/figma-web',
          'color/css',
          'size/pxToRem',
          'cubicBezier/css',
          'shadow/css/shorthand',
        ],
        buildPath: OUTPUT,
        files: [
          {
            destination,
            format: 'css/variables',
            filter,
            options: {
              selector,
              outputReferences: true,
              fileHeader: undefined,
            },
          },
        ],
      },
    },
  });
}

await mode(
  'semantic.light.json',
  ':root',
  emitted,
  'tokens.light.css',
).buildAllPlatforms();
await mode(
  'semantic.dark.json',
  '.dark',
  (token) => emitted(token) && isSemantic(token),
  'tokens.dark.css',
).buildAllPlatforms();
// One generated file, as the stylesheet imports it: Light on `:root`, then Dark.
const parts = ['tokens.light.css', 'tokens.dark.css'].map((file) =>
  join(OUTPUT, file),
);
writeFileSync(
  join(OUTPUT, 'tokens.css'),
  parts.map((part) => readFileSync(part, 'utf8')).join('\n'),
);
parts.forEach((part) => rmSync(part));
console.log(`Wrote ${join(OUTPUT, 'tokens.css')}`);
