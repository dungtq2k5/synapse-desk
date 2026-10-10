import { CallerContext } from '@synapsedesk/common';
import { Prisma } from '../generated/prisma/client';

/**
 * What this caller may see: org-wide ∪ their departments — RDM §1.2 — and
 * everything for a super admin, which returns `{}` so callers can spread it
 * unconditionally.
 *
 * Spread into a `DocumentWhereInput`, or into the `document: { … }` half of a
 * filter over a table that names one:
 *
 * ```ts
 * where: { organizationId, document: { deletedAt: null, ...documentVisibility(context) } }
 * ```
 *
 * Why every worklist naming a document applies it too: ADR 0037.
 *
 * **The SAME predicate `rag-service` enforces in retrieval**, and the two must
 * agree: a document invisible in a list but retrievable by the RAG pipeline is
 * a disclosure, and one visible but not retrievable is a user reporting that
 * search is broken.
 *
 * **The gateway caches `GET /documents` keyed on a digest of exactly these two
 * inputs** — `visibilityDigest` in `cacheable.interceptor.ts`. Widening this
 * without widening that digest serves one audience's rows to another, because
 * two callers the new filter separates would still share a cache entry. The
 * pair is easy to miss: only one of the two files looks like it is about
 * security.
 */
export function documentVisibility(
  context: CallerContext,
): Prisma.DocumentWhereInput {
  if (context.isSuperAdmin) return {};

  return {
    OR: [
      { isOrganizationWide: true },
      {
        departmentLinks: {
          some: { departmentId: { in: context.departmentIds } },
        },
      },
    ],
  };
}
