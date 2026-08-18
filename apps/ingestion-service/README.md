# ingestion-service

Parses uploaded documents, chunks them, embeds them, and writes the corpus that
`rag-service` retrieves from.

## Running the tests needs two system binaries

**Scanned-PDF OCR shells out to poppler and tesseract** — and jest
runs on your machine rather than in the image, so `--target runtime-ocr` puts
them somewhere the test suite cannot reach. Install them locally:

```bash
sudo apt-get install -y poppler-utils tesseract-ocr tesseract-ocr-eng
```

Without them, the OCR suites **skip with a reason** rather than failing. That is
deliberate: a red suite nobody can fix locally gets deleted or ignored within a
fortnight, while a visibly skipped test naming the package gets the package
installed. `test/utils/ocr-binaries.ts` is what decides, and
`npx jest --config jest.config.ts -t "reports which binaries"` prints what this
machine has.

**poppler alone is enough to build the fixtures.** `buildScannedPdf` draws text,
rasterizes it through `pdftoppm`, and embeds the PNG back into a PDF — which is
how a page that pdf.js reads as empty gets generated rather than committed as a
binary blob. tesseract is needed only to read one back.

### Extra languages

The OCR language set is `OCR_LANGUAGES` in `@synapsedesk/common` — eight, ISO
639-1. Tesseract's own codes differ (`vi` is `vie`, `zh` is `chi_sim`) and its
Debian packages differ again (`tesseract-ocr-chi-sim`, hyphen where the code has
an underscore); `TESSERACT_CODE_BY_LANGUAGE` is the only mapping, and the
package names live in the Dockerfile. To exercise a non-English document
locally:

```bash
sudo apt-get install -y tesseract-ocr-vie tesseract-ocr-jpn tesseract-ocr-chi-sim
```

## Building the image

Every other service builds with the command in `docker/node-service.Dockerfile`'s
header. **ingestion-service needs `--target runtime-ocr`**, which is the same
image plus poppler and tesseract:

```bash
docker build -f docker/node-service.Dockerfile \
  --target runtime-ocr \
  --build-arg SERVICE=ingestion-service \
  --build-arg GIT_SHA="$(git rev-parse HEAD)" \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t synapsedesk/ingestion-service .
```

Building it without the target produces a working image whose scanned pages all
fail with `binary_missing` — loudly, once, at the first scanned document, and
never at boot. Every other document still ingests.

**After changing the Dockerfile, run the two checks:**

```bash
./docker/check-ocr-image.sh
```

It builds both targets and asserts the cost boundary (the default image carries
no OCR) and the `USER` round trip (installed as root, runs as `node`, binaries
executable by that user). It is minutes rather than seconds, so it is not a
per-commit check — but it catches the mistake that is easiest to make here,
which is appending a stage and silently changing what `docker build` produces by
default.
