package com.synapsedesk.gateway.documents;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * `Document`, as the GraphQL schema serves it — `fileUrl` and `deletedById`
 * absent, matching Node's `DocumentResponseGqlDto` exactly: `fileUrl` is an
 * internal object path resolved to a fresh signed URL per REST read, and
 * publishing the raw path here would advertise the storage layout.
 */
public record DocumentGqlDto(
  String id,
  String organizationId,
  String createdById,
  String title,
  String fileType,
  int fileSizeBytes,
  boolean isOrganizationWide,
  DocumentStatusGql status,
  List<String> departmentIds,
  int chunkCount,
  OffsetDateTime createdAt,
  OffsetDateTime updatedAt,
  OffsetDateTime deletedAt
) {}
