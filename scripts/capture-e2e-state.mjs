#!/usr/bin/env node
/**
 * The shared infrastructure state, dumped at the moment an e2e run failed.
 *
 * **Three known-gaps rows ask for this and none of them gets it**, because
 * every one of them asks a human to capture before re-running and the reflex
 * they describe is exactly the reflex that prevents it — #7's fifth sighting
 * is the row recording that its own instruction was not followed.
 *
 *   #7  wants `KEYS bull:scheduler-*` and their contents: a repeat entry left
 *       by one service's bootstrap is PROMOTED and executed by the next suite
 *       that boots a worker on that queue name.
 *   #13 wants to know which suites were in the run and how long it had been
 *       going — its two specs fail on a poll budget sized for an idle box, so
 *       "what else was running" is the whole diagnosis.
 *   #14 wants the durable streams and consumers: a suite that tears down
 *       shared broker state fails an unrelated service's suite mid-run.
 *
 * **Run-scoped, not spec-scoped, and that is #13's correction to #7.** A
 * capture bolted onto one spec loses the information it exists to protect —
 * which suites were in the run — because the spec cannot see them.
 *
 *     node scripts/capture-e2e-state.mjs                  # print to stdout
 *     node scripts/capture-e2e-state.mjs --out artifacts  # write files too
 *
 * The same script runs from a developer's shell and from the workflow's
 * `if: failure()` step, deliberately: **CI cannot reproduce two of these three
 * classes**, because a runner starts with an empty Redis and an empty
 * JetStream every time, while the machine that keeps producing them is the one
 * that accumulates state for weeks. A capture that existed only in CI would be
 * installed exactly where the bugs are not.
 *
 * Never fails the run: it is diagnostic output attached to an already-failing
 * job, and a capture that can itself fail turns one red into two.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;

/**
 * Every Redis db an e2e suite is pointed at — DERIVED, never listed.
 *
 * A literal here restates tracked configuration, and the failure mode is the
 * one this script's own header records: move `ingestion`'s `REDIS_DB` and the
 * capture goes quiet on precisely the service whose scheduler queue #7 is
 * about — and quiet looks like clean.
 *
 * Both spellings, because the repo uses both: `REDIS_DB = 4` (ingestion,
 * storage, rag) and a `redis://…/15` URL suffix (gateway, notification).
 * Absent either way means db 0, which is where auth and ticket live.
 */
const redisDbs = () => {
  const files = run('git', [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    'apps/*/.env.test',
  ])
    .split('\n')
    .filter(Boolean);

  const dbs = new Set();

  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const explicit = /^REDIS_DB\s*=\s*(\d+)/m.exec(text);
    const suffix = /^REDIS_URL\s*=\s*redis:\/\/[^\s/]+\/(\d+)/m.exec(text);
    dbs.add(Number(explicit?.[1] ?? suffix?.[1] ?? 0));
  }

  return [...dbs].sort((a, b) => a - b);
};

const sections = [];

const record = (title, body) => {
  sections.push({ title, body });
  console.log(`\n===== ${title} =====\n${body}`);
};

const run = (command, commandArgs) => {
  try {
    return execFileSync(command, commandArgs, {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    // The tool being absent is itself worth recording — a capture that says
    // "no nats CLI here" is more useful than a silent gap.
    // `error.message`, not `error.shortMessage` — the latter is execa's and
    // `node:child_process` never sets it, so the left branch was always
    // `undefined` and the `??` was an implied dependency this script does not
    // have.
    return `<unavailable: ${error.message}>`;
  }
};

/**
 * `redis-cli`, wherever it actually is.
 *
 * **Measured the hard way while writing this**: `redis-cli` is not installed
 * on the machine that runs these suites, so a probe written as
 * `redis-cli … | wc -l` reported `0` keys — an error message counted as zero
 * lines — and "no leftovers" was indistinguishable from "no redis-cli". The
 * container always has the binary, so it is the fallback, and an absent
 * result is now reported as absent rather than as an empty one.
 */
const redis = (dbArgs) => {
  const local = run('redis-cli', dbArgs);
  if (!local.startsWith('<unavailable')) return local;

  return run('docker', [
    'exec',
    process.env.REDIS_CONTAINER ?? 'synapsedesk-redis',
    'redis-cli',
    ...dbArgs,
  ]);
};

record(
  'when',
  [
    `captured: ${new Date().toISOString()}`,
    `node: ${process.version}`,
    `ci: ${process.env.CI ?? 'no'}`,
  ].join('\n'),
);

// -------------------------------------------------------------------- #7

// Every scheduler/work queue key, and the CONTENTS of the repeat entries —
// the key names alone say a leftover exists, the hashes say when it will
// fire and whether something has already processed it (a hash that has grown
// `processedOn`/`finishedOn` fields is the promotion #7's sixth sighting
// proved end to end).
for (const db of redisDbs()) {
  const keys = redis(['-n', String(db), '--scan', '--pattern', 'bull:*']);

  if (!keys || keys.startsWith('<unavailable')) {
    record(`redis db${db}: bull keys`, keys || '(none)');
    continue;
  }

  const lines = keys.split('\n').filter(Boolean).sort();
  const detail = lines
    .filter((key) => key.includes(':repeat:') || key.includes(':delayed'))
    .map((key) => {
      const type = redis(['-n', String(db), 'type', key]);
      const value =
        type === 'hash'
          ? redis(['-n', String(db), 'hgetall', key])
          : redis(['-n', String(db), 'zrange', key, '0', '-1']);

      return `--- ${key} (${type})\n${value}`;
    })
    .join('\n');

  record(
    `redis db${db}: ${lines.length} bull key(s)`,
    [lines.join('\n'), detail].filter(Boolean).join('\n\n'),
  );
}

// ------------------------------------------------------------------- #14

// The durable streams and consumers. `nats` CLI if present; the monitor's
// HTTP endpoint otherwise, which every dev stack exposes for
// NATS_MONITOR_URL and which needs nothing installed.
const monitor = process.env.NATS_MONITOR_URL ?? 'http://localhost:8222';
record('nats streams', run('nats', ['stream', 'ls', '-a']));
record(
  'nats consumers (jsz)',
  run('curl', ['-s', `${monitor}/jsz?consumers=1&config=1`]),
);

// ------------------------------------------------------------------- #13

// **Which suites were in the run**, which is the thing #13 says #7's
// spec-scoped capture loses — and which the process table cannot answer:
// `test:e2e` is a sequential `&&` chain, so at the moment of failure `ps`
// shows one jest process, the suite that failed, and the chain has already
// discarded the five that did or did not precede it.
//
// Two sources, neither derivable from the other: the script text is the
// INTENDED order, the log tail is how far the run actually got.
try {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  record('suite order (package.json test:e2e)', manifest.scripts['test:e2e']);
} catch {
  record('suite order (package.json test:e2e)', '<unavailable>');
}

record(
  'run log tail',
  process.env.E2E_LOG
    ? run('tail', ['-n', '80', process.env.E2E_LOG])
    : '<no E2E_LOG set — run `npm run test:e2e 2>&1 | tee e2e.log` with E2E_LOG=e2e.log>',
);

// What else was on the box. #13's two specs fail on a poll budget sized for
// an idle machine, so load at the moment of failure IS the diagnosis.
record('load', run('cat', ['/proc/loadavg']));
record(
  'node processes',
  run('bash', [
    '-c',
    "ps -eo pid,etime,pcpu,pmem,args | grep -E '[j]est|[n]ode' | head -40",
  ]),
);

if (outDir) {
  // **The one place this script could break its own promise.** Every command
  // above goes through `run()`, which swallows its errors — but an unwritable
  // `--out` path would throw here, exit non-zero, and fail the `if: failure()`
  // step on top of the failure it was documenting. The stdout copy is the
  // useful half and has already been printed by now, so a write that cannot
  // happen is reported and shrugged off.
  const target = join(outDir, 'e2e-state.txt');

  try {
    mkdirSync(outDir, { recursive: true });
    const body = sections
      .map(({ title, body: text }) => `===== ${title} =====\n${text}`)
      .join('\n\n');

    writeFileSync(target, `${body}\n`);
    console.log(`\nwrote ${target}`);
  } catch (error) {
    console.error(
      `\ncould not write ${target} (${error.message}) — the capture above is ` +
        'the copy that matters',
    );
  }
}
