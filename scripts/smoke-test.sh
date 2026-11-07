#!/usr/bin/env bash
set -euo pipefail

if (exec 3<>/dev/tcp/127.0.0.1/8787) 2>/dev/null; then
  echo 'Smoke test requires port 8787 to be available.' >&2
  exit 1
fi

smoke_dir=$(mktemp -d)
wrangler_pid=''

cleanup() {
  if [[ -n "${wrangler_pid}" ]]; then
    kill "${wrangler_pid}" 2>/dev/null || true
    wait "${wrangler_pid}" 2>/dev/null || true
  fi

  rm -rf "${smoke_dir}"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

expected_version=$(jq -r .version node_modules/twikoo-func/package.json)

wrangler d1 execute twikoo \
  --local \
  --persist-to "${smoke_dir}/state" \
  --file tests/fixtures/schema.sql

wrangler dev \
  --local \
  --persist-to "${smoke_dir}/state" \
  --port 8787 \
  > "${smoke_dir}/wrangler.log" 2>&1 &
wrangler_pid=$!

if ! curl \
  --retry 30 \
  --retry-connrefused \
  --retry-delay 1 \
  --retry-max-time 30 \
  --max-time 5 \
  --fail \
  --silent \
  --header 'Content-Type: application/json' \
  --data '{"event":"GET_FUNC_VERSION"}' \
  http://127.0.0.1:8787/ \
  | jq \
    -e \
    --arg version "${expected_version}" \
    '.code == 0 and .version == $version' \
    > /dev/null; then
  cat "${smoke_dir}/wrangler.log"
  exit 1
fi
