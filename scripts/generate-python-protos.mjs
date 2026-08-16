#!/usr/bin/env node
/**
 * Generates rag-service's Python protobuf stubs.
 *
 *   node scripts/generate-python-protos.mjs           # write them
 *   node scripts/generate-python-protos.mjs --check    # fail if they are stale
 *
 * **Why this is a script and not another entry in `buf.gen.yaml`.** buf drives
 * the TypeScript half through `protoc-gen-ts_proto`, an npm binary — which is
 * the whole point of that file's opening comment: `npm i` is enough, no
 * hand-installed protoc. The Python half cannot follow: `--grpc_python_out` is
 * not a protoc builtin, it comes from `grpcio-tools`, and grpcio-tools ships it
 * as a PYTHON MODULE rather than as a `protoc-gen-*` binary buf could invoke.
 * So the generator has to be `python -m grpc_tools.protoc`, and something has to
 * run it.
 *
 * **And something has to fix the imports afterwards.** protoc emits
 * `from synapsedesk.auth import common_pb2`, which is only importable if
 * `synapsedesk/` is itself on `sys.path`. It is not — the package root is
 * `rag_service.generated`, so every cross-file import needs rewriting to
 * `from rag_service.generated.synapsedesk...`. The committed stubs have always
 * had that rewrite; nothing in the repo performed it. It was done by hand, once,
 * and the knowledge of it lived nowhere.
 *
 * **How this was found.** `pyproject.toml` says protoc "rewrites these on every
 * `npm run proto:generate`". That was not true: `buf.gen.yaml` had no Python
 * plugin at all, so a `.proto` edit regenerated TypeScript and silently left
 * Python behind. It surfaced when `ledger.proto` gained two `import` statements
 * and the checked-in `ledger_pb2.py` referenced neither — a mismatch that would
 * have stayed invisible until rag-service failed to deserialize a field.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROTO_ROOT = join(REPO_ROOT, 'libs/grpc-proto/src/proto');
const RAG_ROOT = join(REPO_ROOT, 'apps/rag-service');
const OUT_DIR = join(RAG_ROOT, 'rag_service/generated');
const VENV_PYTHON = join(RAG_ROOT, '.venv/bin/python');

/**
 * An absolute `git` and a fixed PATH — the same pair `graphql.e2e-spec.ts` uses
 * for its `schema.gql` diff, and for the same reason: resolving a program
 * through an inherited PATH lets anything earlier on that PATH answer instead.
 */
const GIT = '/usr/bin/git';
const FIXED_PATH_ENV = { ...process.env, PATH: '/usr/bin:/bin' };

/**
 * Orders by CODE UNIT, explicitly.
 *
 * Not `localeCompare`, and the difference matters here more than it usually
 * does: locale-aware ordering is machine-dependent, and this ordering decides
 * the sequence protoc is handed its files in. A checked-in generated artifact
 * whose byte content depends on the developer's locale would make
 * `--check` fail on somebody else's laptop for no reason anyone could see.
 */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // NOSONAR

/**
 * The protos rag-service imports BY HAND — the closure below finds the rest.
 *
 * Listing dependencies here too is how this list goes stale: `ledger.proto`
 * gained `auth/common.proto` and `ingestion/document.proto` in the same change
 * that prompted this script, and a hand-maintained list would have missed both
 * exactly as the manual process did. Roots are what a human chose to consume;
 * everything else is derived.
 */
const ROOTS = [
  // Implemented BY rag-service.
  'synapsedesk/rag/rag.proto',
  'synapsedesk/ops/ops.proto',
  // Called BY rag-service: `ai_generations` has one writer, and this is how a
  // spending service asks that writer to record a row.
  'synapsedesk/ingestion/ledger.proto',
];

/** The rewrite protoc's output needs to be importable from the package root. */
const ABSOLUTE_IMPORT = /^from synapsedesk\./gm;
const PACKAGE_IMPORT = 'from rag_service.generated.synapsedesk.';

/**
 * Every proto reachable from {@link ROOTS}, roots included.
 *
 * protoc compiles a file's dependencies but only GENERATES for the files it is
 * handed — and a generated module imports its dependencies' modules by name. So
 * a dependency left out of this list produces a stub that imports something
 * nobody generated, which is an ImportError at rag-service boot rather than a
 * codegen error anyone would see here.
 *
 * `google/protobuf/*` is excluded: those ship inside the protobuf runtime, and
 * regenerating them would shadow the installed package with a copy that drifts.
 */
function transitiveClosure(roots) {
  const seen = new Set();
  const queue = [...roots];

  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file) || file.startsWith('google/protobuf/')) continue;

    const path = join(PROTO_ROOT, file);
    if (!existsSync(path)) {
      throw new Error(
        `${file} does not exist under ${relative(REPO_ROOT, PROTO_ROOT)} — was it renamed?`,
      );
    }
    seen.add(file);

    for (const [, imported] of readFileSync(path, 'utf8').matchAll(
      /^ *import +(?:public +|weak +)?"([^"]+)" *;/gm,
    )) {
      queue.push(imported);
    }
  }

  return [...seen].sort(byCodeUnit);
}

/** Every generated file, so the rewrite and the staleness check see all of them. */
function generatedFiles(dir) {
  const found = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== '__pycache__') found.push(...generatedFiles(path));
    } else if (/\.pyi?$/.test(entry)) {
      found.push(path);
    }
  }

  return found.sort(byCodeUnit);
}

/**
 * An empty `__init__.py` in every generated package directory.
 *
 * Empty because these are pure namespace markers — the existing three are 0
 * bytes, and anything written into them would be code nobody generated sitting
 * in a directory nobody edits.
 */
function ensurePackageMarkers(dir) {
  const created = [];

  for (const entry of readdirSync(dir)) {
    if (entry === '__pycache__') continue;

    const path = join(dir, entry);
    if (statSync(path).isDirectory())
      created.push(...ensurePackageMarkers(path));
  }

  const marker = join(dir, '__init__.py');
  if (!existsSync(marker)) {
    writeFileSync(marker, '');
    created.push(marker);
  }

  return created;
}

function main() {
  const check = process.argv.includes('--check');

  if (!existsSync(VENV_PYTHON)) {
    // **A skip in write mode and a failure in check mode**, deliberately.
    //
    // Most contributors here never touch Python, and blocking `npm run
    // proto:generate` on a virtualenv they have no reason to own would push
    // them to stop running it — which is how the TypeScript stubs would go
    // stale too. But a CHECK that passes because it did nothing is worse than
    // no check: it reports "the stubs are current" having verified nothing.
    const message = `no virtualenv at ${relative(REPO_ROOT, VENV_PYTHON)}`;
    if (check) {
      console.error(
        `python protos: ${message}.\n` +
          `A staleness check cannot pass by skipping. Run \`npm run setup:py\` first.`,
      );
      process.exit(1);
    }

    console.warn(
      `python protos: ${message} — SKIPPED.\n` +
        `  rag-service's stubs are unchanged. Run \`npm run setup:py\` and re-run\n` +
        `  this if you edited a proto rag-service reads.`,
    );
    return;
  }

  const files = transitiveClosure(ROOTS);
  console.log(`python protos: generating ${files.length} file(s)`);

  execFileSync(
    VENV_PYTHON,
    [
      '-m',
      'grpc_tools.protoc',
      `-I${PROTO_ROOT}`,
      `--python_out=${OUT_DIR}`,
      `--pyi_out=${OUT_DIR}`,
      `--grpc_python_out=${OUT_DIR}`,
      ...files,
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );

  let rewritten = 0;
  for (const path of generatedFiles(OUT_DIR)) {
    const source = readFileSync(path, 'utf8');
    const fixed = source.replace(ABSOLUTE_IMPORT, PACKAGE_IMPORT);
    if (fixed !== source) {
      writeFileSync(path, fixed);
      rewritten += 1;
    }
  }
  console.log(`python protos: rewrote imports in ${rewritten} file(s)`);

  // **protoc creates the directories and none of the `__init__.py` files.**
  //
  // `synapsedesk/auth/` arrived without one while every sibling had one, which
  // is the state the manual process left behind. It imports anyway — Python 3
  // treats the directory as a namespace portion — so nothing failed here. It
  // fails later and elsewhere: a wheel build or a Docker `COPY` driven by
  // package discovery skips a directory with no `__init__.py`, and the stub is
  // missing in the image rather than in the checkout.
  const created = ensurePackageMarkers(OUT_DIR);
  if (created.length > 0) {
    console.log(
      `python protos: created ${created.length} __init__.py — ` +
        created.map((path) => relative(OUT_DIR, path)).join(', '),
    );
  }

  if (check) {
    // Same mechanism as the committed `schema.gql` test: regenerate, then let
    // git say whether anything moved. Comparing against a temp directory would
    // need a second copy of the output layout to compare with.
    const diff = execFileSync(
      GIT,
      ['diff', '--', relative(REPO_ROOT, OUT_DIR)],
      { cwd: REPO_ROOT, encoding: 'utf8', env: FIXED_PATH_ENV },
    );

    if (diff.trim()) {
      console.error(
        `\npython protos are STALE — a .proto changed and these were not regenerated:\n\n${diff}\n` +
          `Run \`npm run proto:generate\` and stage the result.`,
      );
      process.exit(1);
    }
    console.log('python protos: up to date');
  }
}

main();
