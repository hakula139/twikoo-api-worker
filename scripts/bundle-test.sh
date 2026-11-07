#!/usr/bin/env bash
set -euo pipefail

bundle_dir=$(mktemp -d)
trap 'rm -rf "${bundle_dir}"' EXIT

wrangler deploy \
  --dry-run \
  --outdir "${bundle_dir}"

threshold=$((3 * 1024 * 1024))
gzipped=$(gzip -c "${bundle_dir}/worker.js" | wc -c)

echo "Compressed bundle: ${gzipped} bytes (threshold: ${threshold})"

if [[ "${gzipped}" -gt "${threshold}" ]]; then
  echo "Compressed bundle ${gzipped}B exceeds ${threshold}B threshold." >&2
  exit 1
fi
