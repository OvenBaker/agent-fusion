---
name: agent-fusion
description: Start (or help run) an Agent Fusion run — two or three independent agents (Claude + Codex) working one task with their output fused, launched as a cockpit workspace. Use when the user wants to "fuse agents", "run a fusion", "kick off a multi-agent investigation/build", spin up Claude + Codex on the same task, or asks to draft the brief for such a run. Covers writing the task brief, picking Mode A vs B, and launching via ~/agents/fusion.
---

# Agent Fusion — kicking off a run

The Agent Fusion harness runs **multiple independent agents** (typically Claude/Opus + Codex/GPT) on
one task and **fuses** their work — independent reasoning beats one agent iterated alone. The full
protocol is `~/agents/agent-fusion.md`; the launcher is `~/agents/fusion`. This skill is the
**bootstrapping** half: turn the user's intent into a clean task brief and start the run. You are not
running the fusion yourself — you compose the brief and launch the agents that will.

## When to use

The user wants to start a fused multi-agent run, or asks you to write the brief for one: "fuse Claude
and Codex on this", "run a fusion / agent-fusion", "kick off a Mode B build", "spin up the conductor
on …", "draft the task for a fusion run". If they just ask *about* the harness, point them at
`~/agents/agent-fusion.md` instead.

## Steps

1. **Read the harness first** if you haven't this session: `~/agents/agent-fusion.md`. It defines the
   two modes, roles, and the launcher contract. Don't skip — the brief you write has to fit the frame.

2. **Pin down the task.** Get a crisp statement of what the agents should accomplish. Ask only what
   you genuinely need; prefer inferring from context (the repo, the conversation). The brief must be
   self-contained — the agents start in fresh sessions and see *only* `task.md` plus whatever the task
   tells them to read.

3. **Pick the mode** (recommend, don't interrogate):
   - **Mode A** (2 agents, PRIMARY self-integrates) — reviews, investigations, anything you'd expect
     to finish in an hour or two. The default.
   - **Mode B** (2 symmetric workers + a clean ARBITER) — long, multi-hour/day build-outs where "they
     diverged too far to merge" is the real risk. More expensive (a third session).
   State which you chose and why in one line.

4. **Write the brief to a file.** Compose `task.md` content and save it to a temp file (e.g.
   `/tmp/<slug>-task.md`). A good brief states: the objective, what to read/ground every claim in,
   explicit scope/output contract, and grounding rules (cite real files/lines; mark inferences; say so
   if something is missing rather than inventing). For read-only work, say **read-only** plainly. Keep
   it tight and unambiguous — this is the contract every agent shares.

5. **Choose a slug** — a short kebab-case run name (e.g. `valuno-reversal-probe`). It names the
   `RUN_DIR` (`~/agents/runs/<slug>`) and the cockpit workspace.

6. **Confirm with the user before launching** — show the chosen mode, slug, and the brief; let them
   tweak. Launching spawns live agents in cockpit, so get a nod first.

7. **Launch:**
   ```bash
   ~/agents/fusion --mode <A|B> [--auto] <slug> /tmp/<slug>-task.md
   ```
   - Add **`--auto`** for unattended research runs (Claude `--permission-mode auto`, Codex
     `-a on-request`). Omit it if the user wants to approve tool calls per pane.
   - Add **`--cwd <repo>`** for code runs (and remember §6 isolation for concurrent edits).
   - A cockpit grid must be running first (`cockpit`); the script errors with that hint if not.

8. **Report back** the workspace name (switch to it with Alt-←/→ in cockpit), the `RUN_DIR`, and that
   the agents will self-bootstrap (`control/RUN.started`) and proceed through the protocol. The run is
   then agent-driven; the user watches/steers via cockpit and the human controls in §5
   (`control/HOLD`, `control/ABORT`).

## Notes

- The script writes `task.md` from your brief and treats it as **immutable** — the agents read it,
  never rewrite it. Don't try to author `task.md` inside `RUN_DIR` yourself; just pass the brief file.
- Dry-run anytime to preview scaffolding + the exact opening prompts without spawning anything:
  `~/agents/fusion --mode A <slug> /tmp/<slug>-task.md --dry-run`.
- Re-running a slug with `--force` resumes/overwrites the scaffold; the agents reconcile from disk.
