/**
 * @file The shape of a Qdrant point, shared by the two services that disagree about
 * it at their peril.
 *
 * `ingestion-service` (TypeScript) writes points; `rag-service` (Python) filters
 * them. Neither can see the other's field names, and a mismatch does not error
 * — a filter on `organization_id` simply matches nothing when the writer spelled
 * it `organizationId`, so retrieval quietly returns empty for every tenant, or
 * worse, a filter that cannot see a field excludes nothing by it.
 *
 * So the names live here, once, and the Python mirror is held to them by
 * `ai-settings.contract.json` like every other cross-language constant.
 */

/** ONE collection, payload-partitioned. Not one per tenant. */
export const QDRANT_COLLECTION = 'document_chunks';

/**
 * The vector size, fixed at collection creation.
 *
 * Paired with `EMBEDDING_MODEL` in `ai-settings.config.ts` rather than declared
 * beside it, because the model is a SETTING (resolvable, potentially
 * tier-varying in principle) and this is a property of the collection that no
 * setting may vary. Changing it is a re-embed migration across every tenant.
 */
export const EMBEDDING_DIMENSION = 768;

/**
 * The payload keys. Four of them are the retrieval filter; the
 * other two are how a hit becomes a citation.
 *
 * **All four filter fields must be payload-indexed**, which is not an
 * optimisation: without an index Qdrant cannot estimate filter cardinality and
 * falls back to scanning. That returns correct answers, so nothing fails — the
 * tenant filter merely becomes the dominant cost of every query.
 */
export const QDRANT_PAYLOAD_FIELDS = {
  organizationId: 'organization_id',
  isDeleted: 'is_deleted',
  departmentIds: 'department_ids',
  isOrganizationWide: 'is_organization_wide',
  /** Not part of the filter. Indexed because the fan-out updates by document. */
  documentId: 'document_id',
  /** The bridge back to `document_chunks.id`, for citation text. */
  chunkId: 'chunk_id',
} as const;

/**
 * The payload a point actually carries, keyed by the WIRE names above.
 *
 * Declared here rather than at the writer because these keys are a contract
 * with two readers that TypeScript cannot see: rag-service reads them in
 * Python, and Qdrant itself filters on them. A `Record<string, unknown>` at the
 * call site types the container while leaving every key and value unchecked —
 * so `is_deleted: 'false'` (a string) or a typo'd key compiles, writes happily,
 * and silently drops the point out of every filtered query. Nothing fails; the
 * document simply becomes unfindable.
 *
 * The keys are computed from `QDRANT_PAYLOAD_FIELDS`, so a rename there is a
 * compile error here rather than a second place to remember.
 */
export type QdrantChunkPayload = {
  [QDRANT_PAYLOAD_FIELDS.chunkId]: string;
  [QDRANT_PAYLOAD_FIELDS.documentId]: string;
  [QDRANT_PAYLOAD_FIELDS.organizationId]: string;
  [QDRANT_PAYLOAD_FIELDS.departmentIds]: string[];
  [QDRANT_PAYLOAD_FIELDS.isOrganizationWide]: boolean;
  [QDRANT_PAYLOAD_FIELDS.isDeleted]: boolean;
};

/**
 * The subset a scope change may touch.
 *
 * `Partial`, because `setDocumentScope` writes only the fields it was given —
 * and deliberately NOT the whole payload: a full overwrite would drop
 * `chunk_id`, and the symptom would be a citation that fails to resolve weeks
 * later, far from the change that caused it.
 */
export type QdrantScopePayload = Partial<
  Pick<
    QdrantChunkPayload,
    | typeof QDRANT_PAYLOAD_FIELDS.departmentIds
    | typeof QDRANT_PAYLOAD_FIELDS.isOrganizationWide
    | typeof QDRANT_PAYLOAD_FIELDS.isDeleted
  >
>;

/**
 * How many points go in one upsert.
 *
 * Small enough that a failure re-does little work, large enough that a
 * 400-chunk document is a handful of round trips rather than 400.
 */
export const QDRANT_UPSERT_BATCH = 64;
