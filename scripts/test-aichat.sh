#!/usr/bin/env bash
# Runs the AI limit tests without letting them touch the live SQLite store.
# src/utils/db.js opens src/data/store.db on import, so snapshot it first and
# put it back afterwards whether the tests pass or fail.
set -uo pipefail
cd "$(dirname "$0")/.."

DATA_DIR="src/data"
BACKUP="$(mktemp -d)"
FILES=("store.db" "store.db-wal" "store.db-shm")

had_data=0
if [ -d "$DATA_DIR" ]; then
  had_data=1
  for f in "${FILES[@]}"; do
    [ -f "$DATA_DIR/$f" ] && cp -p "$DATA_DIR/$f" "$BACKUP/$f"
  done
fi

restore() {
  if [ "$had_data" = "1" ]; then
    for f in "${FILES[@]}"; do
      if [ -f "$BACKUP/$f" ]; then
        cp -p "$BACKUP/$f" "$DATA_DIR/$f"
      else
        rm -f "$DATA_DIR/$f"
      fi
    done
  fi
  rm -rf "$BACKUP"
}
trap restore EXIT

node scripts/test-aichat.mjs
status=$?

# The store flushes 100ms after the last write; wait for it to close cleanly so
# the restore below cannot race a pending WAL checkpoint.
sleep 0.3
exit $status
