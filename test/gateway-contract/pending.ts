/**
 * @file What API each row exercises.
 *
 * A row declares the API TAG it exercises — not to be gated by it, but so
 * `declared-tags.contract-spec.ts` can prove every published API has a row.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { matchingBracketIndex } from './brackets';
import { REPO_ROOT } from './gateway';
import { compareAlphabetically } from '@synapsedesk/core';

/**
 * `it`, declaring the API tags the row exercises. The tags are read by
 * `declaredTags()` from the source, never here.
 *
 * @example
 * rowFor('Tickets')('creates a ticket', async () => { … });
 */
export function rowFor(...tags: string[]): jest.It {
  // Declared for `declaredTags()`, deliberately not consulted here.
  void tags;

  return it;
}

/**
 * The tags the rows actually declare, read from the spec SOURCES.
 *
 * **Scanned, not listed.** A hand-kept map beside these files would be the
 * second copy this whole design exists to avoid — and it drifts silently:
 * measured, a `rowFor('Webhookz')` typo left a map saying `Webhooks` and the
 * guard stayed green while the row skipped for ever. The calls are the
 * declaration; this reads them.
 *
 * Direction, as ever: from the rows toward the published document. The
 * reverse would only confirm that the tags someone wrote down exist.
 */
/**
 * Every tag a `rowFor(...)` call in `source` names as a string literal.
 *
 * **Depth-matched, not `rowFor\(([^)]*)\)`.** A `[^)]*` scan stops at the
 * FIRST `)`, so a call like `rowFor(tagsFor(x))` would silently contribute
 * zero tags rather than the real ones — the same failure shape
 * `graphql-permission-coverage`'s `@Query(...)` parsing hit, and
 * `permission-coverage`'s nested `ResponseEntity<...>` hit again. This one
 * is upstream of every guard that trusts {@link declaredTags}, so an
 * under-count here checks fewer tags for typos WHILE STAYING GREEN, rather
 * than failing on the row it missed — the highest-consequence of the three.
 * Exported so the hostile shape can be pinned directly, without a fixture
 * file on disk.
 */
export function tagsIn(source: string): string[] {
  const tags: string[] = [];
  let searchFrom = 0;

  for (;;) {
    const start = source.indexOf('rowFor(', searchFrom);
    if (start < 0) break;

    const openParen = start + 'rowFor'.length;
    const closeParen = matchingBracketIndex(source, openParen, '(', ')');
    if (closeParen < 0) break;

    for (const literal of source
      .slice(openParen + 1, closeParen)
      .matchAll(/'([^']+)'/gu)) {
      tags.push(literal[1]);
    }
    searchFrom = closeParen + 1;
  }

  return tags;
}

export function declaredTags(): string[] {
  const here = join(REPO_ROOT, 'test/gateway-contract');
  const tags = new Set<string>();

  for (const file of readdirSync(here).filter((name) =>
    name.endsWith('.contract-spec.ts'),
  )) {
    for (const tag of tagsIn(readFileSync(join(here, file), 'utf8'))) {
      tags.add(tag);
    }
  }

  return [...tags].sort(compareAlphabetically);
}
