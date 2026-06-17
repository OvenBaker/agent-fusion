#!/usr/bin/env bash
# fusion-lib.sh — shared helpers for the Agent Fusion harness (~/agents/agent-fusion.md).
# Source at startup:  source ~/agents/fusion-lib.sh   (requires RUN_DIR and ROLE in the environment)
# Goal: stop every agent hand-rolling its own heartbeat/wait/slug logic — and remove background
# processes entirely (run 2 leaked two heartbeat loops that ran ~10h past completion).

# Lowercase role slug — used for ALL control/marker/log filenames, regardless of header case.
# Never put a raw $ROLE into a path; mixed-case markers are how a peer's liveness check false-stalls.
fusion_slug() { printf '%s' "${1:-$ROLE}" | tr '[:upper:]' '[:lower:]'; }

# Synchronous heartbeat + log in one call. NO background process: liveness == "acted recently".
# usage: fusion_log "phase=plan stage=s01 msg='wrote blind plan'"
fusion_log() {
  local slug; slug="$(fusion_slug)"
  touch "$RUN_DIR/control/${slug}.alive"
  printf '%s [%s] %s\n' "$(date -u +%FT%TZ)" "$slug" "$*" >> "$RUN_DIR/log/${slug}.log"
}

# Wait for a marker, with timeout / lenient staleness / ABORT watch; refreshes own heartbeat each tick.
# Prints: READY | TIMEOUT | STALE:<age> | ABORT
# usage: fusion_wait <marker> [peer_alive] [timeout=3600] [interval=20] [stale=1800]
# NOTE: Claude Code blocks foreground sleep — run this with run_in_background:true, or use Monitor.
fusion_wait() {
  local marker="$1" peer_hb="$2" timeout="${3:-3600}" interval="${4:-20}" stale="${5:-1800}" waited=0 slug
  slug="$(fusion_slug)"
  while [ ! -e "$marker" ]; do
    sleep "$interval"; waited=$((waited + interval))
    touch "$RUN_DIR/control/${slug}.alive"
    [ -e "$RUN_DIR/control/ABORT" ] && { echo ABORT; return 2; }
    if [ -n "$peer_hb" ] && [ -e "$peer_hb" ]; then
      local age=$(( $(date +%s) - $(stat -c %Y "$peer_hb") ))
      [ "$age" -gt "$stale" ] && { echo "STALE:$age"; return 3; }
    fi
    [ "$waited" -ge "$timeout" ] && { echo TIMEOUT; return 1; }
  done
  echo READY
}

# ARBITER-only: one monitoring sweep — new beacons + pending tripwires/challenges/holds since a cursor.
# usage: fusion_watch_sweep
fusion_watch_sweep() {
  local cursor="$RUN_DIR/control/.arbiter_watch_cursor"
  [ -e "$cursor" ] || : > "$cursor"
  echo "== new beacons =="          ; find "$RUN_DIR/beacons" -type f -newer "$cursor" 2>/dev/null | sort
  echo "== need-ruling beacons ==" ; grep -li 'NEED-RULING: *yes' "$RUN_DIR"/beacons/*.md 2>/dev/null
  echo "== open challenges =="      ; ls "$RUN_DIR"/steering/*.challenge.* 2>/dev/null
  echo "== HOLD / ABORT =="         ; ls "$RUN_DIR"/control/HOLD "$RUN_DIR"/control/ABORT 2>/dev/null
  touch "$cursor"
}
