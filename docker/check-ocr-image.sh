#!/usr/bin/env bash
# Kept as the entrypoint people know; the checks themselves moved into
# `check-images.sh` when it grew the full image suite (build-all, runtime
# resolution, the stage guards), where the OCR assertions are one section.
exec "$(dirname "${BASH_SOURCE[0]}")/check-images.sh" --ocr-only
