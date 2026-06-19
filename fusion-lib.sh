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

# ── Integrity helpers: immutable DONE, freshness, gates, completion (agent-fusion.md §1.8/§3/§4) ──

# Internal: content hash of a file (GNU sha256sum, BSD shasum fallback).
_fusion_hash() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1; }

# Finalize an artifact: write its DONE marker AND a fingerprint sidecar, so a later
# edit to the artifact (a §1.8 immutability violation) is PROVABLE at synthesis time.
# The DONE marker stays an empty signal file (§3); the fingerprint (.fp) sits beside
# it and is written BEFORE the marker (marker-after-content). Use this everywhere you
# would have done `touch DONE.<slug>` for a content artifact.
# usage: fusion_done <artifact> [marker]   default marker: <dir-of-artifact>/DONE.<slug>
fusion_done() {
  local art="$1" marker="$2" slug fp
  [ -n "$art" ] && [ -e "$art" ] || { echo "fusion_done: artifact missing: ${art:-<none>}" >&2; return 2; }
  slug="$(fusion_slug)"
  [ -n "$marker" ] || marker="$(dirname "$art")/DONE.$slug"
  fp="${marker}.fp"
  printf '%s  %s  %s\n' "$(_fusion_hash "$art")" "$(stat -c %Y "$art" 2>/dev/null)" "$art" > "$fp"
  : > "$marker"
  fusion_log "done artifact=$(basename "$art") marker=$(basename "$marker")"
}

# Integrator pre-synthesis freshness check for a stage/plan dir. Confirms each
# fingerprinted artifact is UNCHANGED since its DONE (no post-DONE edit), lists any
# *.addendum.* files, and (with a cursor) shows what changed since your last read.
# Run this BEFORE fusing. Returns nonzero if any artifact is STALE — re-read it first.
# usage: fusion_freshness <dir> [cursor_file]
fusion_freshness() {
  local dir="$1" cursor="$2" rc=0 fp recorded art now
  [ -d "$dir" ] || { echo "fusion_freshness: no dir: $dir" >&2; return 2; }
  echo "== freshness: $dir =="
  for fp in "$dir"/DONE.*.fp; do
    [ -e "$fp" ] || continue
    read -r recorded _ art < "$fp"
    if [ ! -e "$art" ]; then echo "MISSING  $art"; rc=1; continue; fi
    now="$(_fusion_hash "$art")"
    if [ "$now" != "$recorded" ]; then
      echo "STALE    $art  (edited after DONE — re-read before synthesis)"; rc=1
    else
      echo "ok       $art"
    fi
  done
  echo "== addenda =="; ls "$dir"/*.addendum.*.md 2>/dev/null || echo "(none)"
  [ -n "$cursor" ] && { echo "== changed since last read =="; find "$dir" -type f -newer "$cursor" 2>/dev/null | sort; }
  return "$rc"
}

# Stage gate: are ALL required markers present before consuming a prior stage's fused
# output / starting gated next-stage work? Prints what's missing; nonzero if any absent.
# usage: fusion_gate <marker> [marker ...]
fusion_gate() {
  local m missing=0
  for m in "$@"; do [ -e "$m" ] || { echo "missing: $m"; missing=1; }; done
  [ "$missing" -eq 0 ] && echo READY
  return "$missing"
}

# Integrator guard: assert the run is truly finishable BEFORE writing RUN.complete.
# .signoff args must be non-empty (or satisfied by a non-empty <arg>.skipped.md);
# .md args must be non-empty; every other arg (a marker) must merely exist.
# Prints PASS/FAIL and returns nonzero if any precondition is unmet.
# usage: fusion_can_complete <path> [path ...]
#   e.g. fusion_can_complete "$RUN_DIR/FINAL.md" $RUN_DIR/stages/*/DONE.synthesis \
#                            "$RUN_DIR/control/worker_a.signoff" "$RUN_DIR/control/worker_b.signoff"
fusion_can_complete() {
  local rc=0 p
  for p in "$@"; do
    case "$p" in
      *.signoff)
        if   [ -s "$p" ];             then echo "ok    $p"
        elif [ -s "${p}.skipped.md" ]; then echo "ok    $p (skipped)"
        else echo "FAIL  $p  (missing/empty — write it, or ${p##*/}.skipped.md with a reason)"; rc=1; fi;;
      *.md)
        if [ -s "$p" ]; then echo "ok    $p"; else echo "FAIL  $p  (missing/empty)"; rc=1; fi;;
      *)
        if [ -e "$p" ]; then echo "ok    $p"; else echo "FAIL  $p  (missing marker)"; rc=1; fi;;
    esac
  done
  if [ "$rc" -eq 0 ]; then echo "RUN.complete preconditions: PASS"
  else echo "RUN.complete preconditions: FAIL — do NOT write control/RUN.complete yet"; fi
  return "$rc"
}
