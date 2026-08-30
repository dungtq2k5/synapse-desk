/**
 * @file What auth created, for the steps that reference it.
 *
 * The manifest is the ONLY way a later step learns an id from an earlier one.
 * That is deliberate: cross-service ids carry no foreign key (RDM §1.13), so a
 * step that invented an `organizationId` would produce rows unreachable through
 * the API, invisible to every constraint, and discoverable only when a page
 * rendered a blank author.
 *
 * It also buys `--only`, resumability, and an answer to "which user is the Acme
 * admin" that does not need a query.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPO_ROOT } from './paths';

/** One seeded tenant, and the ids the later steps draw from. */
export type ManifestTenant = {
  organizationId: string;
  name: string;
  slug: string;
  planName: string;
  /** The grants, copied so a later step derives its counts without re-reading auth. */
  grants: {
    maxAgentSeats: number;
    maxStorageBytes: string;
    maxDocumentUploads: number;
  };
  /**
   * What the auth step DECIDED this tenant holds, derived from the grants
   * above.
   *
   * Carried rather than recomputed: the ingestion step spending its own
   * derivation would be a second definition of "how many documents does this
   * tenant have", and the two would drift the first time either fill changed.
   */
  planned: {
    documents: number;
    storageBytes: string;
  };
  departmentIds: string[];
  /** Every live user, admin first. */
  userIds: string[];
  adminUserId: string;
};

export type Manifest = {
  /** The faker seed this run used, so a re-run can reproduce it exactly. */
  seed: number;
  profile: string;
  generatedAt: string;
  tenants: ManifestTenant[];
};

/**
 * Gitignored, because it is derived.
 *
 * A committed manifest goes stale the first time somebody reseeds, and a stale
 * one is worse than none: it names ids that no longer exist and every step that
 * trusts it writes orphans.
 *
 * **Anchored to the repository root, not to `process.cwd()`.** The databases
 * are found relative to this source file, and a tool with two opinions about
 * where it is writes its manifest beside whichever directory it was started
 * from — see `paths.ts`.
 */
export const MANIFEST_PATH = join(REPO_ROOT, '.demo-seed', 'manifest.json');

export function writeManifest(manifest: Manifest, path = MANIFEST_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/**
 * Reads a previous run's manifest, for `--only`.
 *
 * Throws rather than returning empty: a `--only=ticket` that silently seeded
 * nothing would look like a successful run.
 */
export function readManifest(path = MANIFEST_PATH): Manifest {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
  } catch {
    throw new Error(
      `No manifest at ${path}. Run the auth step first — '--only' consumes what auth emitted.`,
    );
  }
}
