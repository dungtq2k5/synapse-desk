# 0037 — Operational worklists follow the document boundary

**Status:** accepted · **Code:** `apps/ingestion-service/src/common/document-visibility.ts`

## Decision

Every list that names a document applies the **same** visibility predicate `GET /documents` applies — org-wide ∪ the caller's departments, RDM §1.2. That now covers the two operational worklists, `listDocumentFlags` and `listIngestionJobs`, which previously filtered on tenant and soft-delete alone.

The predicate lives in one function, `documentVisibility(context)`, spread into the `document: { … }` half of a filter over any table that references one.

## Why

- **The alternative was already visible as a contradiction on a single id.** `GET /documents/:id` answers `NOT_FOUND` for a document outside the caller's departments; `GET /documents/:id/ingestion-jobs` returned that document's history, `error_log` included. One id, two routes, opposite answers.
- **The predicate is held to a stricter standard than convenience elsewhere.** Its own docblock says it is *"the SAME predicate `rag-service` enforces in retrieval, and the two must agree"* — a rule that is hard to reconcile with dropping it on a sibling route.
- **The audience is wider than the worklists were designed for.** `document.read` is granted to `SUPPORT_AGENT`, not only `KNOWLEDGE_MANAGER`, so an unscoped worklist hands one department's failures and document titles to every agent in the tenant.
- **The aggregate exception does not stretch to cover rows.** `getStorageUsage` deliberately skips department scoping because *"a number that shrank depending on who asked would make the storage page disagree with the quota"*. That argument is about a total. These return rows naming documents.

## Consequences

- **A worklist can be shorter than the pipeline is broken.** An operator seeing the whole tenant's stuck jobs is now a permissions question — a super admin sees everything, since `documentVisibility` returns `{}` for one — rather than something every `document.read` holder gets.
- **Narrowing a cached read is as dangerous as widening one**, in the mirror direction: two departments sharing a cache entry would defeat the filter. Neither worklist is cached, and `GET /documents` — the one that is — already carries `varyBy: 'caller'`. Any future `@Cacheable` on a worklist must do the same, and `visibilityDigest` in `cacheable.interceptor.ts` is the other half of that pair.
- **The filter reaches through a relation, so it cannot be spread at the top level** of a `DocumentFlagWhereInput` or `IngestionJobWhereInput` — neither table carries `is_organization_wide` or the department links.
- Each worklist needs **two** tests, not one: exclusion outside the departments, and inclusion for a member of any one of several listed departments. Only the pair distinguishes a correct filter from one that excludes too much.
