#!/usr/bin/env bash
# Runs the AI limit tests against a throwaway store.
#
# src/utils/db.js resolves its data directory from MONOLITH_DATA_DIR, so the
# tests get their own database instead of racing a snapshot/restore of the live
# one. Anything the run writes stays in the temp directory and is deleted on the
# way out, which also covers the WAL and shared-memory files for free.
set -uo pipefail
cd "$(dirname "$0")/.."

TMP_DIR="$(mktemp -d)"
cleanup() {
  # The store flushes 100ms after the last write; give any pending checkpoint
  # time to land before the directory disappears underneath it.
  sleep 0.2
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# aichat.js captures OWNER_ID at import time and ES imports are hoisted, so the
# value has to be in the environment rather than assigned inside the test file.
MONOLITH_DATA_DIR="$TMP_DIR" \
OWNER_ID="${OWNER_ID:-test-owner-user}" \
  node scripts/test-aichat.mjs
exit $?