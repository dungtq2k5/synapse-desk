# 0016 — OCR is a per-page branch, and the offline requirement bends but does not break

**Status:** accepted · **Code:** `apps/ingestion-service/src/modules/ingestion/ocr.service.ts`, `document-parser.service.ts`

## Decision

The gap is **partial scans, not scanned documents**. Empty pages branch to OCR; a page still empty afterwards is *recorded*, not silently dropped.

## Why

- **The promise has to survive chunking, not just parsing.** The check belongs in the processor, the only place holding both halves — and it subsumes both drop points in one check rather than instrumenting each.
- **A binary in our own image keeps what mattered.** The hard requirement was no network and no third-party API; "in-process" was a deployment-simplicity property, not a privacy one. `tesseract`/`poppler` in the image preserves all three privacy properties.

## Consequences

- The language list is **capped at 4 combinations**. Degradation is about ordering relative to the document's primary language, not list length — and an uncapped list is a footgun dressed as flexibility.
- `langs` is blank almost always and that is inherent: it is an escape hatch for a tenant who *knows* they are uploading scanned Vietnamese forms, so it belongs as an advanced field, not a required question on every upload. Absent ⇒ `en`.
- **The existing PDF fixture hides the threshold bug.** `buildPdf` uses `repeat = 40` precisely because of the 16-token threshold, so anything built from it clears the bar comfortably. A fixture landing between 1 and 15 tokens has to be written deliberately.
