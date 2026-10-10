import { PageMeta } from '@synapsedesk/grpc-proto';
import { PaginationMetaDataResponseDto } from '../dto/rest/pagination-response.dto';

/**
 * Wire `PageMeta` -> REST envelope.
 *
 * A field-for-field copy: `PageMeta` was defined with exactly these names so
 * this stays a rename-free translation, and so adding a field to one end is a
 * compile error at the other rather than a silently missing key.
 */
export function toPaginationMetaDataResponseDto(
  meta: PageMeta | undefined,
): PaginationMetaDataResponseDto {
  // ts-proto types every message-valued field as `T | undefined`. That is its
  // convention for message fields, not permission for a list RPC to omit its
  // meta — so a missing one is a contract violation and should say so rather
  // than be papered over with zeroes that render as "0 results".
  if (!meta) {
    throw new Error('Received a paginated response without meta');
  }

  return {
    totalItems: meta.totalItems,
    itemCount: meta.itemCount,
    itemsPerPage: meta.itemsPerPage,
    totalPages: meta.totalPages,
    currentPage: meta.currentPage,
  };
}
