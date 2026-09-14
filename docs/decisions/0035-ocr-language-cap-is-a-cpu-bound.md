# 0035 — The OCR language cap is four, and it is a CPU bound

**Status:** accepted · **Code:** `libs/common/src/configs/document.config.ts`

## Decision

A document may declare at most **four** OCR languages, stored and passed **in the order given, never sorted**.

## Why

**Measured — and the measurement reversed the guess.** The design expected accuracy to degrade as languages were added and proposed a cap of 2. It does not. Rendered at 300 dpi, tesseract 5.3.4:

| `-l` | char error rate | time |
| :---- | :---- | :---- |
| `vie` | 0.00% | 651ms |
| `vie+eng` | 0.00% | 699ms |
| `vie+eng+jpn` | 0.00% | 739ms |
| `vie+eng+jpn+chi_sim` | 0.00% | 893ms |
| `eng+vie` (order swapped) | **2.41%** | 776ms |
| `eng` alone | **24.41%** | 642ms |

Three findings, and only the third sets the number:

1. **Extra languages cost no accuracy.** Four was as exact as one.
2. **Order is what costs accuracy** — naming English first on a Vietnamese document was worse than every four-language combination. Hence: never sort the list.
3. **Extra languages cost time**, roughly linearly, and CJK models cost most: `jpn` 578ms against `jpn+eng+chi_sim` 1359ms.

So the cap is a CPU bound, not an accuracy one. Four permits every realistic document — one language, English technical terms, and a CJK script — while holding the worst case near +40% on a path that already has a per-page timeout.

## Consequences

**The measurement is a best case, and that caveat is what keeps it honest.** These were clean synthetic renders of digital fonts, which is the easy case. Real scans are noisy and skewed, and language confusion grows with noise. **The numbers bound the best case**, so they are a reason not to tighten the cap rather than a license to loosen it.

Related: [0016](./0016-ocr-is-a-per-page-branch.md).
