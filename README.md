# agent-fusion

Tooling for **Agent Fusion** — running multiple independent agents (Claude/Opus +
Codex/GPT) on one task and fusing their output.

- **`agent-fusion.md`** — the harness protocol (Mode A: 2-agent self-integrating;
  Mode B: 2 symmetric workers + a clean ARBITER conductor). Read this first.
- **`fusion-lib.sh`** — shared shell helpers (`fusion_slug` / `fusion_log` /
  `fusion_wait`); synchronous heartbeat, no background process.
- **`fusion`** — launcher: scaffolds a run dir and opens a [cockpit](https://github.com/OvenBaker/cockpit)
  workspace with one pane per agent, each started with its role header + prompt.
- **`skill/agent-fusion/SKILL.md`** — vendored copy of the `agent-fusion` skill (the bootstrapping
  half: compose the brief, pick the mode, launch). Source of truth; installed to
  `~/.claude/skills/agent-fusion/SKILL.md`. Re-copy after editing either side to keep them in sync.

```bash
fusion --mode A <slug> task.md        # 2 agents: PRIMARY(claude) + SECONDARY(codex)
fusion --mode B <slug> task.md        # 3 roles:  ARBITER + WORKER_A(claude) + WORKER_B(codex)
fusion <slug> task.md --dry-run       # preview scaffold + prompts; spawn nothing
```

Runs live under `runs/<slug>/` (gitignored — the filesystem is the coordination bus).

---

Part of a trio: **[santa](https://github.com/OvenBaker/santa)** (search & resume your
Claude + Codex history) and **[cockpit](https://github.com/OvenBaker/cockpit)** (drive
many live sessions at once). See **[agent-tooling](https://github.com/OvenBaker/agent-tooling)**
for how they fit together.
