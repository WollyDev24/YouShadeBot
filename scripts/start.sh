#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$DIR/bot.pid"

kill_old() {
  if [ -f "$PID_FILE" ]; then
    old_pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
      echo "[start] killing old process (pid $old_pid)"
      kill "$old_pid" 2>/dev/null || true
      sleep 1
      kill -9 "$old_pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi
}

cleanup() {
  rm -f "$PID_FILE"
  exit 0
}

trap cleanup SIGINT SIGTERM

kill_old

node "$DIR/src/index.js" &
BOT_PID=$!
echo "$BOT_PID" > "$PID_FILE"
echo "[start] bot started (pid $BOT_PID)"

wait "$BOT_PID"
code=$?
rm -f "$PID_FILE"
exit "$code"
