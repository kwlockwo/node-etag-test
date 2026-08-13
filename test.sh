#!/usr/bin/env bash
# Runs the full Accept-Encoding x notransform matrix against a live deploy
# and prints headers of interest for each combination.
#
# Handles Render free-tier cold starts: warms the service up first by
# polling /health, and retries any individual request that comes back as
# a routing failure (x-render-routing: no-server) instead of a real
# response from the app.
#
# Usage: ./test.sh https://node-etag-test.onrender.com

set -euo pipefail

HOST="${1:-}"
if [ -z "$HOST" ]; then
  echo "Usage: $0 <base-url>" >&2
  echo "Example: $0 https://node-etag-test.onrender.com" >&2
  exit 1
fi

GREP_PATTERN='etag|content-encoding|cache-control|vary|request-id|ray'
MAX_ATTEMPTS=8
RETRY_DELAY=5

# Returns 0 (success) once a request gets a response that isn't a
# "no-server" routing failure, printing status + headers along the way.
warm_up() {
  echo "Warming up ${HOST} ..."
  for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
    local headers status
    headers="$(curl -sS -D - "${HOST}/health" -o /dev/null || true)"
    status="$(printf '%s' "$headers" | head -n1 | tr -d '\r')"
    if printf '%s' "$headers" | grep -qi '^x-render-routing: no-server'; then
      echo "  attempt ${attempt}/${MAX_ATTEMPTS}: ${status} (no-server, service still waking up) — retrying in ${RETRY_DELAY}s"
      sleep "$RETRY_DELAY"
      continue
    fi
    echo "  attempt ${attempt}/${MAX_ATTEMPTS}: ${status} — service is up"
    return 0
  done
  echo "  gave up waiting for the service to wake up after ${MAX_ATTEMPTS} attempts" >&2
  return 1
}

# Runs one curl case, retrying if the edge returns a no-server routing
# failure instead of routing to the app.
run_case() {
  local label="$1"
  local url="$2"
  shift 2
  local curl_args=("$@")

  echo "=== ${label} ==="
  echo "GET ${url}"
  if [ "${#curl_args[@]}" -gt 0 ]; then
    echo "Header: ${curl_args[*]}"
  fi

  local attempt headers status
  for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
    headers="$(curl -sS -D - "${curl_args[@]}" "$url" -o /dev/null)"
    status="$(printf '%s' "$headers" | head -n1 | tr -d '\r')"
    if printf '%s' "$headers" | grep -qi '^x-render-routing: no-server'; then
      echo "  (attempt ${attempt}: ${status}, no-server — retrying in ${RETRY_DELAY}s)"
      sleep "$RETRY_DELAY"
      continue
    fi
    break
  done

  echo "Status: ${status}"
  printf '%s' "$headers" | grep -iE "$GREP_PATTERN" || echo "(no matching headers found)"
  echo
}

warm_up

echo
echo "########################################"
echo "# Without ?notransform=1"
echo "########################################"
echo

run_case "a) no Accept-Encoding header"          "${HOST}/resource/1"
run_case "b) Accept-Encoding: identity"          "${HOST}/resource/1" -H "Accept-Encoding: identity"
run_case "c) Accept-Encoding: gzip"              "${HOST}/resource/1" -H "Accept-Encoding: gzip"
run_case "d) Accept-Encoding: br"                "${HOST}/resource/1" -H "Accept-Encoding: br"
run_case "e) Accept-Encoding: gzip, br"          "${HOST}/resource/1" -H "Accept-Encoding: gzip, br"

echo "########################################"
echo "# With ?notransform=1"
echo "########################################"
echo

run_case "f) no Accept-Encoding header"          "${HOST}/resource/1?notransform=1"
run_case "g) Accept-Encoding: identity"          "${HOST}/resource/1?notransform=1" -H "Accept-Encoding: identity"
run_case "h) Accept-Encoding: gzip"              "${HOST}/resource/1?notransform=1" -H "Accept-Encoding: gzip"
run_case "i) Accept-Encoding: br"                "${HOST}/resource/1?notransform=1" -H "Accept-Encoding: br"
run_case "j) Accept-Encoding: gzip, br"          "${HOST}/resource/1?notransform=1" -H "Accept-Encoding: gzip, br"

echo "########################################"
echo "# /resource/:id/compressed (origin-compressed) — without notransform=1"
echo "########################################"
echo

run_case "k) no Accept-Encoding header"          "${HOST}/resource/1/compressed"
run_case "l) Accept-Encoding: identity"          "${HOST}/resource/1/compressed" -H "Accept-Encoding: identity"
run_case "m) Accept-Encoding: gzip"              "${HOST}/resource/1/compressed" -H "Accept-Encoding: gzip"
run_case "n) Accept-Encoding: br"                "${HOST}/resource/1/compressed" -H "Accept-Encoding: br"
run_case "o) Accept-Encoding: gzip, br"          "${HOST}/resource/1/compressed" -H "Accept-Encoding: gzip, br"

echo "########################################"
echo "# /resource/:id/compressed (origin-compressed) — with notransform=1"
echo "########################################"
echo

run_case "p) no Accept-Encoding header"          "${HOST}/resource/1/compressed?notransform=1"
run_case "q) Accept-Encoding: gzip"              "${HOST}/resource/1/compressed?notransform=1" -H "Accept-Encoding: gzip"
run_case "r) Accept-Encoding: br"                "${HOST}/resource/1/compressed?notransform=1" -H "Accept-Encoding: br"

echo "Done. Paste this output for review."
