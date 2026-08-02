#!/usr/bin/env node
/**
 * Copies the .proto files into the grpc-proto library's build output.
 *
 *   node ../../scripts/copy-protos.mjs dist/proto
 *
 * `tsc` only emits JavaScript, and `PROTO_ROOT` resolves relative to the
 * compiled file's own directory (`__dirname`) — so at runtime the built code
 * looks for a .proto that tsc never copied. gRPC's loader reads the .proto at
 * startup, which means a production container fails to boot, not later.
 *
 * Run by the LIBRARY's build rather than each service's, because services now
 * resolve `@synapsedesk/grpc-proto` through node_modules to
 * `libs/grpc-proto/dist/index.js` — so that is the only `__dirname` the loader
 * ever sees, no matter which service is running.
 *
 * The copy is recursive and preserves the synapsedesk/auth/ tree, which the
 * loader's includeDirs depends on to resolve `import` statements between protos.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const destArg = process.argv[2];
if (!destArg) {
  console.error(
    'Usage: node scripts/copy-protos.mjs <dest-dir-relative-to-cwd>',
  );
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repoRoot, 'libs', 'grpc-proto', 'src', 'proto');
const dest = resolve(process.cwd(), destArg);

if (!existsSync(source)) {
  console.error(`No proto source directory at ${source}`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
cpSync(source, dest, { recursive: true });

console.log(`Copied protos -> ${destArg}`);
