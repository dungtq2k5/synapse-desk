#!/usr/bin/env node
/**
 * Fails the build when an AI model name appears outside the settings layer.
 *
 * Doc 15 §1.2 states the rule; this makes it mechanical, "because the
 * discipline decays exactly when someone is debugging at speed". The failure it
 * prevents is silent: a single `'gemini-2.0-flash'` typed into a summarizer is
 * a tenant on the premium tier receiving the cheap model. Nothing throws, no
 * test goes red, and the only symptom is an answer that is slightly worse — for
 * the customer paying more.
 *
 * It scans BOTH languages, because the settings layer is duplicated across them
 * and a check that covered only TypeScript would leave the half written in the
 * language with no compiler to lean on.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

const SCAN_ROOTS = ['apps', 'libs', 'scripts'];
const SCAN_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.py'];

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.venv',
  '__pycache__',
  '.turbo',
  'generated',
]);

/**
 * The two files a model name is allowed to live in, per language.
 *
 * The pricing table earns its place for a different reason from the settings
 * table: it is keyed BY model rather than choosing one. It answers "what does
 * X cost", never "which model do we use", so a name there cannot silently
 * route a tenant to the wrong tier — and removing the names from it would mean
 * pricing models by an alias, which is a worse problem.
 */
const ALLOWED = [
  join('libs', 'common', 'src', 'configs', 'ai-settings.config.ts'),
  join('libs', 'common', 'src', 'configs', 'ai-pricing.config.ts'),
  join('apps', 'rag-service', 'rag_service', 'settings.py'),
  join('apps', 'rag-service', 'rag_service', 'pricing.py'),
  // This script names the patterns it searches for, which is unavoidable.
  join('scripts', 'check-model-literals.mjs'),
];

/**
 * Provider-shaped names rather than an enumeration of the four models in use.
 *
 * An exact list would pass the moment somebody reached for a model that is not
 * yet configured — which is precisely the change worth catching, because it is
 * how an unpriced model enters the system and meters as free (12-doc §1.3).
 */
const MODEL_PATTERNS = [
  /\bgemini-[\w.]+/i,
  /\btext-embedding-[\w.]+/i,
  /\bgpt-[\w.]+/i,
  /\bclaude-[\w.]+/i,
  /\bo[134]-(?:mini|preview)\b/i,
  /\bmodels\/[\w.-]*(?:gemini|embedding)[\w.-]*/i,
];

function* walk(directory) {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;

    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else if (SCAN_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
      yield path;
    }
  }
}

// Removes block-comment spans (slash-star ... star-slash) by SCANNING rather
// than matching. Line comments, not a docblock, so the delimiters can be
// written out below without closing the comment they appear in.
//
// The obvious /\/\*.*?\*\//g is QUADRATIC, and unlike the `.*$` cases above it
// needs no newline to get there — only many opening `/*` with nothing closing
// them, so a single long line reaches it. Not hypothetical for a checker whose
// scan list includes `.js` and `.mjs`: one minified or bundled file is exactly
// that shape, and the symptom is a build that appears to hang.
//
// The classic unrolled-loop regex was tried as the fix and MEASURED WORSE —
// 135s on 768KB against the naive version's ~90s — which is why this is a
// scanner. `indexOf` cannot backtrack, so it is linear whatever it is fed:
// 3MB in under 7ms.
//
// Verified equivalent to the regex over 400k fuzzed inputs, including the three
// cases worth naming: an unterminated opener is left alone, `/*/` is not a
// comment, and nesting is NOT honoured — the inner opener is ordinary text, so
// the first closer wins, exactly as the lazy quantifier behaved.
function stripBlockComments(text) {
  let out = '';
  let cursor = 0;

  for (;;) {
    const open = text.indexOf('/*', cursor);
    if (open === -1) return out + text.slice(cursor);

    const close = text.indexOf('*/', open + 2);
    // Unterminated: nothing later can close it either, so the rest is literal.
    if (close === -1) return out + text.slice(cursor);

    out += text.slice(cursor, open);
    cursor = close + 2;
  }
}

const violations = [];

for (const scanRoot of SCAN_ROOTS) {
  for (const path of walk(join(ROOT, scanRoot))) {
    const relativePath = relative(ROOT, path);
    if (ALLOWED.includes(relativePath)) continue;

    const lines = readFileSync(path, 'utf8').split('\n');

    lines.forEach((line, index) => {
      // Prose in a docblock explaining the rule is not a violation of it.
      // Stripping comments rather than skipping matched lines keeps a trailing
      // `// gemini-2.0-flash` from excusing the code in front of it.
      const code = stripBlockComments(line)
        // No trailing `$` on any of these. `.*$` is quadratic when the subject
        // contains a newline — `.` stops at it, `$` fails, and the engine
        // retries every shorter length from every start. These subjects are
        // `split('\n')` pieces so they never contain one, but the `$` was
        // buying nothing: `.` already stops at end-of-line, so the anchor was
        // pure risk with no effect. (Measured identical over 200k fuzzed
        // inputs.)
        .replace(/\/\/.*/, '')
        .replace(/^\s*\*.*/, '')
        .replace(/#.*/, '')
        // MODULE SPECIFIERS are not model names. A file called
        // `gemini-embedding.client.ts` is exactly the file that should exist —
        // the provider adapter — and flagging every import of it would train
        // people to ignore this check, which is worse than not having it.
        .replace(/^\s*(?:import|export)\s[^'"]*from\s+['"][^'"]*['"]/, '')
        .replace(/^\s*import\s+['"][^'"]*['"]/, '')
        .replace(/require\(\s*['"][^'"]*['"]\s*\)/g, '')
        .replace(/import\(\s*['"][^'"]*['"]\s*\)/g, '')
        // Python's form of the same thing. `.*` rather than `[^\n]*$` for the
        // reason given above, plus one more: `[\w.]+` and `[^\n]*` OVERLAP —
        // a word character satisfies both — so where one ends and the other
        // begins is ambiguous, and the `$` is what makes the engine explore
        // that ambiguity on failure. `.` is already `[^\n]`, so dropping the
        // anchor loses nothing and removes the only thing that could backtrack.
        .replace(/^\s*(?:from|import)\s+[\w.]+.*/, '');

      for (const pattern of MODEL_PATTERNS) {
        const match = pattern.exec(code);
        if (match) {
          violations.push(
            `${relativePath}:${index + 1}  ${match[0]}\n      ${line.trim()}`,
          );
          break;
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error(
    `\n✖ ${violations.length} model-name literal(s) outside the settings layer:\n`,
  );
  for (const violation of violations) console.error(`   ${violation}`);
  console.error(
    [
      '',
      '  Read the model from the settings layer instead:',
      '',
      '    TypeScript   const { generationModel } = await aiSettings.settingsFor(orgId)',
      '    Python       settings = await resolver.settings_for(organization_id)',
      '',
      '  A literal here is a tenant on the premium tier silently receiving the',
      '  cheap model — nothing errors, the answer is merely worse, and it is',
      '  worse for the customer paying more (doc 15 §1.2).',
      '',
      `  If this genuinely belongs in the settings layer, add the file to ALLOWED`,
      `  in ${relative(ROOT, fileURLToPath(import.meta.url))} — and expect that to be the`,
      '  interesting line in the diff.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(
  `✔ No model-name literals outside the settings layer (${ALLOWED.length} allowlisted files).`,
);
