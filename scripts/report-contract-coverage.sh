#!/usr/bin/env bash
# The contract suite's Java coverage, after a run with CONTRACT_JACOCO_AGENT set:
# checks that every gateway launch wrote its JaCoCo file, then merges them into
# services/api-gateway/target/site/jacoco-contract/jacoco.xml.
#
# The agent writes on JVM exit, so a gateway that died some way other than the
# harness's SIGTERM leaves no file, and its rows would count as uncovered
# without a word. `launches.txt` (written by `gateway.ts`) names every file a
# launch should have written; one missing fails this.
#
#   bash scripts/report-contract-coverage.sh
set -euo pipefail

dir=services/api-gateway/target/contract-jacoco

if [[ ! -s "$dir/launches.txt" ]]; then
  echo "No gateway was launched with the JaCoCo agent (no $dir/launches.txt)." >&2
  exit 1
fi

missing=()
while read -r file; do
  [[ -s "$dir/$file" ]] || missing+=("$file")
done < "$dir/launches.txt"

if (( ${#missing[@]} > 0 )); then
  echo "${#missing[@]} launch(es) wrote no coverage: ${missing[*]}" >&2
  exit 1
fi
echo "$(wc -l < "$dir/launches.txt") launches, each wrote its coverage."

cd services/api-gateway
./mvnw -q jacoco:merge@contract-merge jacoco:report@contract-report
