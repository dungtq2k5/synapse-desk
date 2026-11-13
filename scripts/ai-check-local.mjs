#!/usr/bin/env node
/**
 * @file `npm run ai:check-local`: can this machine run the configured local
 * models? Answers before anything starts, with one verdict:
 *
 *   OK    every configured model fits and can stay loaded;
 *   WARN  it will run, but slowly or swapping, and says why;
 *   NO    a model won't fit, and names the setting to change.
 *
 * Reads the two services' `.env` (`AI_GENERATION_PROVIDER`,
 * `AI_EMBEDDING_PROVIDER`, `OLLAMA_BASE_URL`, `OLLAMA_NUM_CTX`), asks Ollama
 * what it has, and sizes each model as its weights plus its KV cache at
 * `num_ctx` (from `/api/show`'s layer and head counts), against free VRAM on
 * a GPU or `MemAvailable` on the CPU.
 *
 * @example
 * npm run ai:check-local
 */

import { readFileSync, statfsSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ROOT = join(import.meta.dirname, '..');
const GiB = 1024 ** 3;

/** The services' models per provider. Read from the compiled catalogue. */
const { MODELS_BY_PROVIDER, OLLAMA_MODEL_DIGESTS } = await import(
  join(ROOT, 'packages/contracts/dist/index.js')
);

/** `KEY = value` lines, as the services' `.env` files write them. */
function readEnv(path) {
  if (!existsSync(path)) return {};
  const env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const rag = {
  ...readEnv(join(ROOT, 'services/rag-service/.env')),
  ...process.env,
};
const ingestion = {
  ...readEnv(join(ROOT, 'services/ingestion-service/.env')),
  ...process.env,
};

const generation = rag.AI_GENERATION_PROVIDER || 'gemini';
const embedding = rag.AI_EMBEDDING_PROVIDER || 'gemini';
const baseUrl = rag.OLLAMA_BASE_URL || ingestion.OLLAMA_BASE_URL || '';
const numCtx = Number(rag.OLLAMA_NUM_CTX || 8192);

const lines = [];
const say = (text) => lines.push(text);
let verdict = 'OK';
const raise = (level) => {
  const order = ['OK', 'WARN', 'NO'];
  if (order.indexOf(level) > order.indexOf(verdict)) verdict = level;
};

if ((ingestion.AI_EMBEDDING_PROVIDER || 'gemini') !== embedding) {
  say(
    `NO   rag-service embeds with ${embedding}, ingestion-service with ` +
      `${ingestion.AI_EMBEDDING_PROVIDER || 'gemini'}: set AI_EMBEDDING_PROVIDER ` +
      'the same in both .env files.',
  );
  raise('NO');
}

/** Each local model and the role it serves, by the switches. */
const wanted = [];
if (generation === 'ollama') {
  const models = MODELS_BY_PROVIDER.ollama;
  wanted.push([models.generationModelByTier.FAST, 'FAST tier and cheap calls']);
  if (
    models.generationModelByTier.QUALITY !== models.generationModelByTier.FAST
  ) {
    wanted.push([
      models.generationModelByTier.QUALITY,
      'QUALITY tier (on demand)',
    ]);
  }
}
if (embedding === 'ollama') {
  wanted.push([MODELS_BY_PROVIDER.ollama.embeddingModel, 'embeddings']);
}

if (wanted.length === 0) {
  console.log('OK   Both roles are on gemini: nothing local to check.');
  process.exit(0);
}

async function get(path, body) {
  const response = await fetch(new URL(path, baseUrl), {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

let version;
let tags;
try {
  version = (await get('/api/version')).version;
  tags = (await get('/api/tags')).models;
} catch (error) {
  console.log(
    `NO   OLLAMA_BASE_URL ${baseUrl || '(unset)'} doesn't answer (${error.message}). ` +
      'Start it with `docker compose up -d ollama`.',
  );
  process.exit(2);
}

// The compute: load the smallest wanted model briefly and read where it sat.
const probe = wanted.at(-1)[0];
const pulled = new Map(tags.map((tag) => [tag.name, tag]));
let onGpu = false;
if (pulled.has(probe)) {
  if (probe === MODELS_BY_PROVIDER.ollama.embeddingModel) {
    await get('/api/embed', { model: probe, input: ['probe'] });
  } else {
    await get('/api/generate', {
      model: probe,
      prompt: 'hi',
      stream: false,
      options: { num_predict: 1 },
    });
  }
  const loaded = (await get('/api/ps')).models ?? [];
  onGpu = loaded.some((model) => model.name === probe && model.size_vram > 0);
}
say(
  `     Ollama ${version} at ${baseUrl}, computing on ${onGpu ? 'the GPU' : 'the CPU'}.`,
);

/**
 * Ollama's compute buffers per loaded model, beyond weights and KV cache.
 * Measured 2026-11-12 on the RX 6600: 0.17 GiB for the 3B and 0.06 for nomic
 * over the estimate below; rounded up, so the verdict errs toward WARN.
 */
const COMPUTE_BUFFERS = 0.25 * GiB;

/** Weights plus the KV cache at `num_ctx`, from the model's own shape. */
async function footprint(name) {
  const tag = pulled.get(name);
  const info = (await get('/api/show', { model: name })).model_info ?? {};
  const key = (suffix) =>
    Object.entries(info).find(([k]) => k.endsWith(suffix))?.[1] ?? 0;
  const layers = key('.block_count');
  const heads = key('.attention.head_count') || 1;
  const kvHeads = key('.attention.head_count_kv') || heads;
  const width = key('.embedding_length');
  const context = Math.min(numCtx, key('.context_length') || numCtx);
  // K and V, f16, per layer: kvHeads × (width / heads) values each.
  const kv = 2 * layers * kvHeads * (width / heads) * 2 * context;
  return tag.size + kv + COMPUTE_BUFFERS;
}

let missingBytes = 0;
let need = 0;
let needResident = 0;
for (const [name, role] of wanted) {
  const tag = pulled.get(name);
  if (!tag) {
    say(`NO   ${name} (${role}) isn't pulled: run \`ollama pull ${name}\`.`);
    raise('NO');
    missingBytes += await registrySize(name);
    continue;
  }
  if (OLLAMA_MODEL_DIGESTS[name] && tag.digest !== OLLAMA_MODEL_DIGESTS[name]) {
    say(
      `NO   ${name} is ${tag.digest.slice(0, 12)}, not the pinned ${OLLAMA_MODEL_DIGESTS[name].slice(0, 12)}: re-pull it.`,
    );
    raise('NO');
  }
  const bytes = await footprint(name);
  need += bytes;
  if (!role.includes('on demand')) needResident += bytes;
  say(
    `     ${name} (${role}): ${(bytes / GiB).toFixed(2)} GiB at num_ctx ${numCtx}.`,
  );
}

/** What a pull would add, from the registry's manifest; 0 if unreachable. */
async function registrySize(name) {
  const [model, tag] = name.split(':');
  try {
    const response = await fetch(
      `https://registry.ollama.ai/v2/library/${model}/manifests/${tag}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const manifest = await response.json();
    return manifest.layers.reduce((sum, layer) => sum + layer.size, 0);
  } catch {
    return 0;
  }
}

// Memory: what the loaded models already hold counts as free for them.
const loaded = (await get('/api/ps')).models ?? [];
let free;
if (onGpu) {
  const card = readdirSync('/sys/class/drm').find((name) =>
    existsSync(`/sys/class/drm/${name}/device/mem_info_vram_total`),
  );
  const read = (file) =>
    Number(readFileSync(`/sys/class/drm/${card}/device/${file}`, 'utf8'));
  const held = loaded.reduce((sum, model) => sum + model.size_vram, 0);
  free = card
    ? read('mem_info_vram_total') - read('mem_info_vram_used') + held
    : 0;
  say(`     Free VRAM for models: ${(free / GiB).toFixed(2)} GiB.`);
} else {
  const available = /MemAvailable:\s+(\d+) kB/.exec(
    readFileSync('/proc/meminfo', 'utf8'),
  );
  const held = loaded.reduce((sum, model) => sum + model.size, 0);
  free = Number(available[1]) * 1024 + held;
  say(`     MemAvailable for models: ${(free / GiB).toFixed(2)} GiB.`);
}

if (need > free) {
  if (needResident <= free) {
    say(
      `WARN All of them need ${(need / GiB).toFixed(2)} GiB; the resident ones fit. ` +
        'The QUALITY model loads on demand (seconds per swap): keep ' +
        'OLLAMA_MAX_LOADED_MODELS=2 so the FAST model and the embedder stay loaded.',
    );
    raise('WARN');
  } else {
    say(
      `NO   The models that must stay loaded need ${(needResident / GiB).toFixed(2)} GiB ` +
        `of ${(free / GiB).toFixed(2)} GiB: lower OLLAMA_NUM_CTX, stop what else ` +
        'holds the memory, or keep generation on gemini.',
    );
    raise('NO');
  }
}

if (!onGpu && generation === 'ollama') {
  // Measured 2026-11-12 on the i5-12400F (see `ai-pricing.config.ts`).
  say(
    'WARN On the CPU an answer streams at about 17 tokens/s on the 3B and 7.5 on ' +
      'the 7B: readable, slowly. Serve from the GPU (OLLAMA_VULKAN) for speed.',
  );
  raise('WARN');
}

const modelsDir = rag.OLLAMA_MODELS_DIR || join(homedir(), '.ollama/models');
if (missingBytes > 0 && existsSync(modelsDir)) {
  const { bavail, bsize } = statfsSync(modelsDir);
  const disk = bavail * bsize;
  say(
    `     A pull adds ${(missingBytes / GiB).toFixed(2)} GiB; ${(disk / GiB).toFixed(1)} GiB free.`,
  );
  if (missingBytes > disk) {
    say('NO   Not enough disk for the pull: free space first.');
    raise('NO');
  }
}

console.log(lines.join('\n'));
console.log(`${verdict}`);
process.exit(verdict === 'NO' ? 2 : 0);
