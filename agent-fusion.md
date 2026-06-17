# Agent Fusion Harness

A task-agnostic protocol for running **multiple independent agents** on one large, long-running,
agent-led investigation or implementation. Agents reason independently; their output is **fused**.
Different agents reason differently (e.g. Claude/Opus + Codex/GPT), so fusing genuinely independent
work beats any one agent iterated alone — *provided* the independence survives past the first merge.

> **Read this whole file before doing anything.** Then act according to your `MODE` and `ROLE`.

This harness has **two modes**. Pick one in the header.

| | **Mode A — 2-Agent Self-Integrating** | **Mode B — Bounded-Divergence Conductor** |
|---|---|---|
| Agents | 2 (one works *and* integrates) | 3 (two symmetric workers + one arbiter) |
| Best for | Shorter runs; reviews; bounded investigations | Long build-outs where divergence must stay *compatible* |
| Integrator | The PRIMARY (has author's bias) | A clean ARBITER (no stake in either path) |
| Fusion | At each stage boundary | Seams continuously; interiors at milestones |
| Cost | Cheap, fast | Higher; a third session to run |
| Risk it manages | Speed | Two agents drifting into irreconcilable paths |

If you don't know which to use: **Mode A** for anything you'd expect to finish in an hour or two;
**Mode B** for multi-hour/day build-outs where "they diverged too far to merge" is the real risk.

---

## 0. How to use — fill-in header

This single document is handed to **every** agent in the run. The only per-agent difference is the
header. The **task** is supplied as a parallel input — the bootstrapping agent writes it verbatim to
`task.md`; everyone else reads it from there.

```
MODE      = A | B
RUN_DIR   = ~/agents/runs/<job-slug>     # shared working folder; SAME for all agents; export it
ROLE      = (Mode A) PRIMARY | SECONDARY
            (Mode B) WORKER_A | WORKER_B | ARBITER
RUNTIME   = e.g. Claude Code / Opus  |  Codex CLI
TASK      = <the task>                    # bootstrapping agent only; written to task.md
```

- **Mode A roles:** `PRIMARY` (default Claude/Opus — works *and* integrates; owns all `*.merged.*`,
  decisions, `FINAL.md`, `RUN.complete`); `SECONDARY` (default Codex — works, never integrates).
  PRIMARY bootstraps.
- **Mode B roles:** `WORKER_A` (default Claude/Opus) and `WORKER_B` (default Codex) are **symmetric
  peers** — neither is boss. `ARBITER` (recommend a clean Claude/Opus session) monitors, reconciles,
  and steers, but does **not** build deliverables. ARBITER bootstraps.

> **Filename rule (read this twice):** the case you type for `ROLE` is for humans. Every file you
> create under `control/`, `log/`, and every `DONE`/marker uses the **lowercase slug** of your role
> (`primary`, `secondary`, `worker_a`, `worker_b`, `arbiter`). See §3. Do not put a raw `$ROLE`
> into a path.

### Launching a run — the `fusion` script (cockpit)

You don't have to hand-open terminals and paste this document. `~/agents/fusion` launches a whole
run as a **cockpit workspace**: it writes the deterministic scaffold and starts each agent in its own
pane with its role header + a "read this harness" opening prompt already submitted.

```
fusion [--mode A|B] [--auto] [--cwd DIR] <slug> <task-file>   # task from a file
fusion [--mode A|B] [--auto] [--cwd DIR] <slug> -            # task from stdin
fusion [--mode A|B] [--auto] [--cwd DIR] <slug> -m "text"    # task inline
```

- **Mode A** opens 2 panes: `PRIMARY` (Claude) + `SECONDARY` (Codex). **Mode B** opens 3: `ARBITER`
  (Claude) + `WORKER_A` (Claude) + `WORKER_B` (Codex). Default `--mode A`.
- **`--auto`** starts the agents in each CLI's auto-approval mode (Claude `--permission-mode auto`,
  Codex `-a on-request` — the model self-checks when to ask). Without it, you approve tool calls per
  pane. Auto is fine for research/investigation runs.
- **`--cwd DIR`** sets the agents' working directory (default: the `RUN_DIR`). Point it at a repo for
  code runs — but for concurrent code edits also honour the isolation rule in §6.

**What the script does vs. what the agents do.** The script creates `RUN_DIR=~/agents/runs/<slug>`,
writes `task.md` (the immutable parallel input — supplied by you, *not* re-authored by an agent),
copies `fusion-lib.sh` into `control/`, and writes `roles.json` + `README.md`. The agents still run
the **protocol** themselves: the bootstrapper (PRIMARY/ARBITER) establishes its heartbeat and creates
`control/RUN.started`; everyone else waits on that marker, then proceeds. Nothing about §1–§6 changes;
the script only removes the manual terminal-opening and prompt-pasting. Re-running with `--force`
reuses an existing `RUN_DIR` (the agents resume from disk per §1.9).

Prerequisite: a cockpit grid must be running (`cockpit`). Each pane is stamped so cockpit's poller
tracks state and you can watch all agents' liveness/needs-input at a glance.

---

## 1. Core principles (BOTH modes)

1. **Blind-first, mechanically.** Produce *your own* artifact and write its `DONE` marker before
   reading any peer's corresponding artifact — and **do not read a peer artifact until *all*
   expected `DONE` markers for that step exist.** Independence before integration is the whole point.
2. **Converge the *frame*; diverge the *approach*.** The spine of the harness. Agree early on the
   **frame** — interfaces, data shapes, invariants, decomposition boundaries, naming, definition-of-done —
   then diverge freely on the **approach** (method, emphasis, analysis) *inside* that frame. Divergence
   in an interior is good. Divergence in a seam is the thing to forbid.
3. **Dissent is mandatory, capitulation is not free.** When you review/respond to a peer or integrator
   artifact, either raise ≥1 concrete counter-proposal **or** give an explicit, reasoned "no
   divergence found, and here's why." Steelman your own discarded idea before conceding it. Bare
   "concur" is a protocol violation.
4. **The decision/steering channel must not stay empty.** A run that completes with zero recorded
   decisions (Mode A) or zero steering events (Mode B) is a **failed fusion** — friction never
   surfaced. Genuine agreement is fine; *silent* agreement is the smell.
5. **Single integrator per fusion.** Only one role writes any given merged/synthesised/contract
   artifact. Two integrators race and clobber.
6. **Filesystem is the only bus.** If it isn't a file in `RUN_DIR`, peers can't see it.
7. **Own your namespace; never touch a peer's.** Write only files tagged with your own lowercase slug.
   Never edit a peer's files. Never edit `task.md` (or a frozen contract) after it's set.
8. **Marker-after-content.** Write the content file *completely*, then create its `DONE` marker. A
   marker's presence is the contract that the content is finished and safe to read.
9. **Resumable from disk.** Every phase/stage leaves durable artifacts. On (re)start, reconcile with
   `RUN_DIR` state — infer the current phase from which markers exist and resume there.
10. **Surface, don't silently diverge.** On timeout, stalled peer, or disagreement past the cap, log
    it and raise it to the human rather than quietly forking the work.
11. **Account for what fusion drops.** Every time you integrate (merge/synthesise), end the artifact
    with a brief *preservation ledger* — what you kept from each interior, and, critically, what you
    deliberately dropped and why. Best-of-both fails *silently* when good material from the non-chosen
    interior vanishes unremarked (run 2's synthesis quietly lost a useful pricing-input taxonomy this way).

---

## 2. Shared working folder layout

`<slug>` = lowercase role slug (`worker_a`, `arbiter`, …). `sNN` = stage/milestone.

```
$RUN_DIR/
├── task.md                       # parallel input; immutable after bootstrap
├── README.md                     # this run's layout + status (bootstrapper writes)
├── FINAL.md                      # final synthesis (PRIMARY in A; ARBITER in B)
├── control/
│   ├── roles.json                # who/what each agent is; MODE
│   ├── fusion-lib.sh             # copy of the shared helpers (provenance)
│   ├── RUN.started               # bootstrap done; others may begin
│   ├── <slug>.ready              # handshake
│   ├── <slug>.alive              # heartbeat: mtime = last action (touched synchronously, §3)
│   ├── RUN.complete              # ← THE completion marker (integrator, last thing written)
│   ├── HOLD                      # if present: pause at next checkpoint (human)
│   └── ABORT                     # if present: clean stop now (human)
├── plan/                         # blind plans + the merged plan/contract
├── stages/sNN/                   # work.<slug>.md, DONE.<slug>, merged.md / synthesis.md, artifacts/
├── decisions/                    # Mode A negotiation: NNNN.proposal/response/resolved
├── deliverables/                 # polished outputs (ownership: §B.3 in Mode B; PRIMARY in Mode A)
└── log/<slug>.log                # terse, append-only status lines

# Mode B adds:
├── contract/                     # contract.md (frozen FRAME) + DONE.frozen + amendment.NNNN.md
├── beacons/<slug>.NNNN.md        # rolling status beacons (workers emit)
└── steering/                     # conductor channel: NNNN.directive.<target>.md / .challenge.<slug>.md / .resolved.md
```

No `*.hb.pid` files, no heartbeat scripts — there is no background heartbeat (§3).

---

## 3. File, slug & heartbeat conventions (BOTH modes)

- **Slug — lowercase, always.** Every `control/`, `log/`, and marker filename uses the lowercase
  role slug, *whatever* case `ROLE` is typed in. Derive it once; never use raw `$ROLE` in a path:
  ```bash
  source ~/agents/fusion-lib.sh         # provides fusion_slug / fusion_log / fusion_wait
  slug="$(fusion_slug)"                 # e.g. WORKER_B -> worker_b
  ```
  (Mixed-case markers — `WORKER_B.alive` vs `worker_b.alive` — are how a peer's liveness check
  silently misses and false-stalls. One canonical casing eliminates that whole class of bug.)
- **Heartbeat — synchronous, NO background process.** Do **not** launch a heartbeat daemon/loop to
  detach and reap (that churns at startup and leaks past completion). Instead, *touch your alive
  marker as part of every log line and phase transition* — liveness means "acted recently":
  ```bash
  fusion_log "phase=plan stage=s01 msg='wrote blind plan'"   # appends log line AND touches control/<slug>.alive
  ```
  `fusion_wait` refreshes your heartbeat on every poll tick, so you stay live while blocking. Nothing
  runs in the background ⇒ nothing leaks. Call `fusion_log` liberally; at minimum at every transition.
- **Markers are empty create-only files.** Presence = signal. Content first, marker last. Don't
  rewrite a marker; to supersede an artifact, version it (`merged.v2.md` + `DONE.merged.v2`) and log it.
- **Atomic-ish writes.** If you can, write `path.tmp` then `mv -f path.tmp path`. Either way, the
  marker-after-content rule (§1.8) is the real guarantee.

---

## 4. Waiting & liveness (BOTH modes)

You'll spend much of a run waiting on a peer marker. Use `fusion_wait` from the lib (it polls, watches
`ABORT`, applies a lenient 30-min staleness threshold, and refreshes your own heartbeat each tick):

```bash
fusion_wait "$RUN_DIR/contract/DONE.frozen" "$RUN_DIR/control/worker_a.alive"   # -> READY|TIMEOUT|STALE|ABORT
```

- **Codex / shell-first runtimes:** call it in the foreground.
- **Claude Code:** foreground `sleep` is blocked — run it with `run_in_background: true` (you're
  re-invoked when it exits), or use the `Monitor` tool with an until-condition. Never foreground-sleep.
- **On STALE/TIMEOUT, don't pause-and-pray.** Keep working your *own* independent thread, log
  `control/<peer_slug>.stalled`, and surface to the human. Blocking entirely on a stalled peer is how
  a run dies waiting. (Mode A SECONDARY can't integrate, so if PRIMARY is truly gone it pauses and
  alerts; otherwise it keeps producing its own work.)
- Scale `timeout` to the step (a 4-hour build milestone needs a longer wait than a 5-minute plan).

## 5. Human controls (BOTH modes)

- `control/HOLD` — agents pause at the next checkpoint and wait. Remove to resume.
- `control/ABORT` — agents stop cleanly at the next safe point; integrator writes `control/RUN.aborted`.
  `fusion_wait` already watches for it.

## 6. Implementation-task isolation (code, BOTH modes)

Concurrent edits to one working tree corrupt it. The plan/contract **must** specify one of:
- **Partition** — disjoint files/modules per agent. (Repo not under git → worktrees unavailable → use this.)
- **Worktree-per-agent** — each works in its own git worktree/branch; the integrator merges.
For read-only investigations, no isolation needed; only *write* artifacts are namespaced.

═══════════════════════════════════════════════════════════════════════════════════════════════
# MODE A — 2-Agent Self-Integrating
═══════════════════════════════════════════════════════════════════════════════════════════════

PRIMARY works *and* integrates; SECONDARY works. The guardrails in §1 (mechanical blind-first,
mandatory dissent, non-empty `decisions/`) keep it from collapsing into lockstep.

### Phase 0 — Bootstrap & handshake
**PRIMARY:** `mkdir -p $RUN_DIR/{control,plan,stages,decisions,log,deliverables}`; copy
`~/agents/fusion-lib.sh` into `control/`; write `task.md` verbatim, `README.md`, `control/roles.json`;
`source fusion-lib.sh`; `fusion_log "bootstrap"` (this establishes your heartbeat); create
`control/RUN.started`; `fusion_wait` for `control/secondary.ready`.
**SECONDARY:** `fusion_wait` for `control/RUN.started`; read `task.md` + `roles.json`; source lib;
`fusion_log "ready"`; create `control/secondary.ready`.

### Phase 1 — Independent planning (BLIND)
Each writes `plan/plan.<slug>.md` (decomposition, division of labour, dependencies, risks, isolation
per §6), then `plan/DONE.<slug>`. **Read the peer's plan only once both `DONE` markers exist.**

### Phase 2 — Plan fusion (PRIMARY) + mandatory review (SECONDARY)
**PRIMARY:** wait for both; write `plan/plan.merged.md` (the contract) listing **Agreements /
Divergences (your choice + why) / Gaps**; converge the *frame*, preserve *approach* divergence; create
`plan/DONE.merged`. **SECONDARY:** wait; write `plan/plan.review.secondary.md` — **mandatory dissent
(§1.3)**. **PRIMARY:** revise if warranted; create `plan/MERGED.final`. Contract frozen.

### Phase 3 — Staged execution loop
For each `sNN`: **both (BLIND)** write `stages/sNN/work.<slug>.md` + `DONE.<slug>` (read peer only once
both exist); **PRIMARY** fuses → `stages/sNN/merged.md` (ending with a preservation ledger, §1.11) +
`DONE.merged`. **Checkpoint is not a solo
call** — open a decision and get SECONDARY's countersignature (`decisions/` must not be empty, §1.4).
Honour `HOLD`. **SECONDARY** waits for `DONE.merged` + the resolved decision before the next stage.

### Phase 4 — Finalization (PRIMARY)
Write `FINAL.md`; **then** `control/RUN.complete` (last artifact — never before deliverables exist).
SECONDARY may write `control/secondary.signoff`, then stop.

### Decision protocol (Mode A)
1. **Open** `decisions/NNNN.proposal.<slug>.md` (context, options, recommendation, default-if-silent).
2. **Respond** `decisions/NNNN.response.<peer_slug>.md` = `concur`(+reason) | `counter`(+alternative) | `concerns`.
3. **Resolve** (PRIMARY) `decisions/NNNN.resolved.md`. Cap 2 round-trips, then PRIMARY decides + records dissent.

═══════════════════════════════════════════════════════════════════════════════════════════════
# MODE B — Bounded-Divergence 3-Role Conductor
═══════════════════════════════════════════════════════════════════════════════════════════════

Two **symmetric workers** (no boss) + an **ARBITER** that monitors, reconciles, and steers. Goal: let
workers explore genuinely *different approaches* while staying in *compatible spaces*, so the end state
is best-of-both — never two irreconcilable towers.

## B.1 The central rule

> **The ARBITER steers *compatibility*. It must never steer *approach*.**

- ✅ "You're defining the `Facility` interface two ways — converge on this shape." (seam)
- ✅ "WORKER_B, your data model violates the frozen audit-chain invariant — adjust." (invariant)
- ✅ "You're both analysing the credit module — WORKER_B, take monitoring instead." (redundancy)
- ❌ "Do the risk scoring the way WORKER_A does." (approach — that's the divergence you're paying for)

Every directive must name which it is. Steering toward a *particular approach* re-creates lockstep
with the arbiter as the new dictator — the failure mode.

## B.2 Steering is bidirectional — the ARBITER is a divergence regulator
**Pull together** when they're about to become incompatible on a seam; **push apart** when they've
drifted into doing the *same* thing (redundant convergence = wasted parallelism). Manage the
divergence budget: diverge where it adds signal, converge where it must be compatible.

## B.3 Roles & ownership
- **WORKER_A / WORKER_B** — symmetric. Each takes the task through its assigned scope independently,
  emits beacons, requests rulings when touching seams, may challenge a directive. Neither defers to the
  other. **Workers write nothing in the `deliverables/` root.** They write only `stages/sNN/work.<slug>.md`,
  `beacons/<slug>.NNNN.md`, and — *only where the contract assigns a dual build* — their own clearly
  namespaced subdir `deliverables/<artifact>.<slug>/`.
- **ARBITER** — bootstraps; freezes the contract; runs the control loop (B.8); reconciles seams
  continuously; synthesises interiors at milestones. **Owns everything else under `deliverables/`** and
  the canonical shared data artifact (e.g. `model.json`) — these are *synthesis*, written by the ARBITER
  alone. Builds no interior work of its own. Does an independent orientation read (B.5). Recommend a
  clean Opus session. (State the deliverable/canonical-artifact ownership explicitly in the contract so
  no worker has to infer it — in run 2 both workers spent a beacon guessing this.)

## B.4 Phase 0 — Bootstrap & handshake (ARBITER)
`mkdir -p $RUN_DIR/{control,plan,contract,stages,beacons,steering,log,deliverables}`; copy
`~/agents/fusion-lib.sh` into `control/`; write `task.md`, `README.md`, `control/roles.json` (`mode:B`);
`source fusion-lib.sh`; `fusion_log "bootstrap"` (establishes heartbeat); `control/RUN.started`;
`fusion_wait` for both `control/worker_a.ready` and `control/worker_b.ready`. Workers: `fusion_wait` for
`RUN.started`; read task; source lib; `fusion_log "ready"`; create `control/<slug>.ready`.

## B.5 Phase 1 — Blind plans + independent orientation
- **Both workers (BLIND):** `plan/plan.<slug>.md` (decomposition, seams foreseen, approach, risks);
  `plan/DONE.<slug>`.
- **ARBITER (independent read):** *while* workers plan, write `plan/orientation.arbiter.md` — your own
  view of the seams/invariants. **Folie-à-deux guard:** gives you a reference frame to catch both
  workers being wrong the same way. You build nothing from it.

## B.6 Phase 2 — Contract freeze (ARBITER)
Wait for both worker plans. Synthesise (your orientation + both plans) into `contract/contract.md` —
the **frozen FRAME, and only the frame**: seams (interfaces, schemas, vocabulary), invariants,
decomposition & ownership (incl. **who owns deliverables / the canonical artifact**, per B.3),
definition-of-done. **Explicitly NOT in the contract:** *how* each worker solves its interior — say so.
Create `contract/DONE.frozen`. Each worker reviews once (**mandatory dissent**, §1.3) via a beacon;
amend via `contract/amendment.NNNN.md` if warranted. Post-freeze frame changes go through steering (B.8).

## B.7 Phase 3 — Bounded-divergence execution
Workers run interiors **independently and concurrently** — they do **not** lockstep at boundaries.

**Beacons** (`beacons/<slug>.NNNN.md`, ~every work unit or N min):
```
WHERE:       <what I'm working on now>
ASSUMING:    <assumptions that could affect a peer>
SEAM:        <contract seam I'm about to touch — or "none">
NEED-RULING: <yes/no — am I blocked pending an ARBITER ruling?>
DIVERGENCE:  <how my approach differs from what I'd expect the peer to do, if known>
```
**Tripwires:** before *committing* anything that (a) changes a seam, (b) could violate an invariant, or
(c) will collide with the peer's scope — stop, post a beacon with `NEED-RULING:yes`, and **block only
that seam-work** while progressing other interior work. Non-seam work never blocks.

**Fusion cadence:** *seams fuse continuously* (the moment a seam decision forms, the ARBITER reconciles
it — publishing the reconciled seam *is* the steer). *Interiors fuse at milestones* — at each
`stages/sNN/` the workers write `work.<slug>.md` + `DONE.<slug>` (BLIND of each other), and the ARBITER
writes `stages/sNN/synthesis.md` (the heavy best-of-both synthesis), ending with a **preservation
ledger** (§1.11): kept-from-A / kept-from-B / dropped-and-why.

## B.8 The conductor control loop (ARBITER)
Event-driven — wake on a new beacon (`fusion_watch_sweep`), a `NEED-RULING` tripwire, or a milestone.
On each wake: **(1) monitor** new beacons + in-progress artifacts; **(2) detect drift the workers
haven't noticed** — incompatible seam (→ pull together) or redundant overlap (→ push apart);
**(3) steer** via `steering/NNNN.directive.<target>.md`:
```
KIND:          seam | invariant | scope/redundancy | reconciliation     # NEVER "approach"
TRIGGER:       push (I detected it) | pull (ref beacon NNNN)
TO:            worker_a | worker_b | both
DIRECTIVE:     <the compatibility instruction>
RATIONALE:     <why; cite the contract seam/invariant>
BINDING:       yes (compatibility) | advisory
CHALLENGEABLE: yes | no
```
**(4) reconcile seams** into `contract/amendment.NNNN.md` when a seam must evolve (logged; never edit
the frozen contract in place). **Challenge protocol:** a worker may contest via
`steering/NNNN.challenge.<slug>.md`; ARBITER issues `steering/NNNN.resolved.md`. Any approach-adjacent
steer must be challengeable — and if you're issuing those, you're over-steering (B.10).

## B.9 Phase 4 — Final synthesis (ARBITER)
At the final milestone, write the deliverables' synthesis and `FINAL.md` (neutral best-of-both — no
author bias, since you built neither interior), verify the contract's DoD, and include the final
**preservation ledger** (§1.11) so no worker's good material is dropped unremarked; **then**
`control/RUN.complete`. Workers write `control/<slug>.signoff` (optional dissent) and stop.

## B.10 Over-steer audit (the new failure mode)
An over-active ARBITER collapses divergence → new lockstep with a new boss. Detectable, because every
steer is audited:
```bash
cd "$RUN_DIR/steering" 2>/dev/null && \
  echo "approach-steers (should be ~0):" && grep -l '^KIND: *approach' *.directive.* 2>/dev/null | wc -l && \
  echo "by kind:" && grep -h '^KIND:' *.directive.* 2>/dev/null | sort | uniq -c
```
Healthy: directives overwhelmingly `seam`/`invariant`/`scope`/`reconciliation`; **`approach` ≈ 0**. Also
smell-check: if workers' artifacts visibly converge in structure right after a steer, that steer
flattened them — back it out. Per §1.4, an *empty* `steering/` at completion means the conductor never
did its job either.

---

## 7. Per-role quick reference

**Mode A · PRIMARY:** bootstrap → blind plan → fuse plans (frame-converge, approach-preserve) → read
mandatory review → freeze → per stage: blind work → fuse → **checkpoint decision (countersigned)** →
`FINAL.md` → `RUN.complete`.
**Mode A · SECONDARY:** wait `RUN.started` → blind plan → **mandatory dissent review** → per stage:
blind work → wait `merged` + resolved decision → signoff.

**Mode B · WORKER_A/B (symmetric):** wait `RUN.started` → blind plan → review frozen contract (mandatory
dissent) → run interior independently; emit beacons; tripwire+block only on seam-work; challenge
directives you disagree with → at milestones write blind `work.<slug>.md` → signoff. Write nothing in
`deliverables/` root.
**Mode B · ARBITER:** bootstrap → independent orientation read → freeze contract (frame only, incl.
deliverable ownership) → control loop: monitor → detect drift (pull-together / push-apart) → steer
*compatibility never approach* → reconcile seams continuously → synthesise interiors at milestones →
over-steer self-audit → `FINAL.md` → `RUN.complete`.

**Everyone, always:** `source ~/agents/fusion-lib.sh`; lowercase slug in every filename; heartbeat is
synchronous via `fusion_log` (no background process); blind-first gated on markers; converge frame /
diverge approach; dissent is mandatory; own your namespace; marker-after-content; keep working your own
thread if a peer stalls; watch HOLD/ABORT; on (re)start, reconcile with disk and resume.
