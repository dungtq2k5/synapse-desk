/**
 * @file The derivation itself — that the skip list is real, and complete.
 *
 * Two rows, and between them they are what keeps "derived, not written" from
 * rotting into a list nobody can read:
 *
 * - a tag a row DECLARES that names no real API is a typo, and a typo skips
 *   that row for ever while reporting a tidy `skipped`;
 * - an API the Java gateway IMPLEMENTS that no row declares is an API the
 *   harness never exercises — and the derivation alone cannot see it, because
 *   it only ever proves that skipped rows are pending.
 *
 * The second is the direction rule: scanning from the pending list toward the
 * rows proves nothing about the rows that are missing.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './gateway';
import {
  GENERATED_APIS,
  PENDING_APIS,
  apiNameFor,
  declaredTags,
  pendingApis,
} from './pending';

describe('the Java skip list', () => {
  /**
   * Every API name that really exists.
   *
   * From the generated sources when they are there — which is the
   * authoritative answer, since those are the interfaces the pending list
   * names. When they are not (a `node` run on a machine that has never built
   * the Java gateway), from the OpenAPI document's tags, normalised the way
   * the generator normalises them. Both answer the same question; only the
   * first is available unconditionally under `GATEWAY_IMPL=java`.
   */
  const realApiNames = (): Set<string> => {
    if (existsSync(GENERATED_APIS)) {
      return new Set(
        readdirSync(GENERATED_APIS)
          .filter((name) => name.endsWith('Api.java'))
          .map((name) => name.slice(0, -'.java'.length)),
      );
    }

    const document = JSON.parse(
      readFileSync(join(REPO_ROOT, 'docs/reference/openapi.json'), 'utf8'),
    ) as { paths: Record<string, Record<string, { tags?: string[] }>> };

    const tags = new Set<string>();
    for (const path of Object.values(document.paths)) {
      for (const operation of Object.values(path)) {
        for (const tag of operation.tags ?? []) {
          // `Two Factor Auth` -> `TwoFactorAuthApi`, as the generator writes it.
          tags.add(apiNameFor(tag.replace(/[^A-Za-z0-9]/gu, '')));
        }
      }
    }

    return tags;
  };

  const declared = declaredTags;

  it('**every declared tag names a real API** — a typo would skip its row for ever', () => {
    const real = realApiNames();
    const unknown = declared().filter((tag) => !real.has(apiNameFor(tag)));

    expect(unknown).toEqual([]);
    // Two floors: an empty universe, or a scan that stopped matching
    // `rowFor(...)`, would each make the check above vacuous.
    expect(real.size).toBeGreaterThanOrEqual(30);
    expect(declared().length).toBeGreaterThanOrEqual(5);
  });

  it('**every IMPLEMENTED API is exercised by some row**', () => {
    // The direction that matters. `pending-apis.txt` lists what Java has not
    // implemented, so its complement is what Java HAS — and each of those
    // must appear in some suite's declared tags, or it is served and untested.
    const pending = pendingApis();
    // FIXME Type 'Set<string>' can only be iterated through when using the '--downlevelIteration' flag or with a '--target' of 'es2015' or higher.
    const implemented = [...realApiNames()].filter(
      (name) => !pending.has(name),
    );
    const covered = new Set(declared().map(apiNameFor));

    expect(implemented.filter((name) => !covered.has(name))).toEqual([]);
    // Today: Ops, Auth, Users, Feedback, Otp, Chat. The floor rises as the
    // pending list shrinks, and it is here so an empty `implemented` cannot
    // report full coverage.
    expect(implemented.length).toBeGreaterThanOrEqual(6);
  });

  it('the pending list is read from the Java build, not copied here', () => {
    // A file read across the workspace boundary, which `image-contract`
    // permits — it refuses relative IMPORTS that leave a workspace, not data.
    expect(existsSync(PENDING_APIS)).toBe(true);
    expect(pendingApis().size).toBeGreaterThan(0);
  });
});
