/** How a presigned upload's bytes are sent: see `PresignUploadResponse.upload_method`. */
export type UploadMethod = 'PUT' | 'POST';

/**
 * A presign answer's method. An empty one comes from a storage-service that
 * predates the field, which always meant a PUT.
 *
 * @example uploadMethodOf('') // 'PUT'
 * @example uploadMethodOf('POST') // 'POST'
 */
export function uploadMethodOf(wire: string): UploadMethod {
  return wire === 'POST' ? 'POST' : 'PUT';
}
