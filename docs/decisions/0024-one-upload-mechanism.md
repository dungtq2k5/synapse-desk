# 0024 — One upload mechanism: presign → confirm, with a `PendingUpload` record

**Status:** accepted · **Code:** `apps/storage-service/`

## Decision

Every file — document, avatar, message attachment — uses the same presign → upload → confirm flow, gated by a server-side `PendingUpload` record.

## Why

- **"Trust whatever path the client confirms" lets a caller confirm an object path from someone else's session.** Guessing a UUID is unlikely, but guessing is not the only way to end up with a stray path.
- Inventing a second upload mechanism per file type multiplies the signed-URL discipline, the tenant path prefix and the deletion story.

## Consequences

- **The stored filename is a UUID, never the original.** The human-readable name is served back through the signed URL's `responseDisposition`, so the object path itself carries nothing worth protecting.
- **The quota gate runs at presign**, before signing — a tenant over `max_storage_bytes` never receives a usable upload URL rather than discovering it after uploading 25 MB.
- **The row is created at confirm, not presign.** An abandoned presign must not leave a row pointing at an object that never arrived.
- `storage-service` is the only holder of storage credentials, and needs no Postgres.
- Tests point at the Firebase emulator, never a real bucket — the same principle as never pointing tests at the dev database. The emulator answers **501** for V4 signed URLs, so the signature itself is the one thing CI cannot cover.
