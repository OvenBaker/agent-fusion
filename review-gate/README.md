# review-gate (v1 shared engine)

The bounded review loop — Gate B of the build-review process. Owns the *mechanical*
discipline a build agent skips under momentum: round counting, the severity floor,
convergence enforcement, and routing non-blockers to a backlog. It decides and routes;
it does not fix anything. Background: `~/agents/notes/build-review-loop.md`.

## Use (from a target repo root)

```bash
G=~/agents/review-gate/review-gate.mjs
node $G init ADR-015 --track L     # S | M | L  (default L)
# ...build against the acceptance matrix...
node $G review                     # run a reviewer round + decide; repeat
node $G status
```

Exit codes gate a script: `0` ship · `10` ship-with-followups · `20` fix-and-reconfirm
· `30` stop-revise-design · `1` error. Round state lives in `<stateDir>/` (gitignore it);
raw reviews are saved per round.

A repo typically wires a thin shim + npm script so the engine path isn't hardcoded:

```js
// scripts/review-gate.mjs  (shim)
import { join } from "node:path";
const home = process.env.REVIEW_GATE_HOME || join(process.env.HOME, "agents", "review-gate");
await import(join(home, "review-gate.mjs"));   // inherits argv + cwd
```

## Config — `.review-gate.json` (per repo, committed)

All repo-flavored knobs live here; the engine ships zero project strings. Built-in
defaults are **data-service-flavored** (tuned on n=1, Touchstone) — a new repo should
declare its own and let findings refine them rather than inherit blindly.

```jsonc
{
  // The reviewer. {{PROMPT}} = the round prompt; {{CODEX}} = auto-resolved
  // codex-companion path (or set CODEX_COMPANION). Swap in any reviewer that can be
  // prompted to emit the output contract below.
  "reviewer": {
    "command": "node",
    "args": ["{{CODEX}}", "adversarial-review", "--wait", "--scope", "working-tree", "{{PROMPT}}"],
    "stageUntracked": true
  },
  "categories": ["authorization", "trust-boundary", "state-machine", "..."],
  "budgets": { "S": 1, "M": 1, "L": 2 },   // max fix-confirm loops per track
  "verifyFromRound": 3,                      // round N+ is verify-only
  "floor": {                                 // the severity floor — AUTHORITATIVE; beats the verdict
    "blockingSeverities": ["critical"],
    "blockingCategories": ["authorization", "trust-boundary"]
  },
  // The ONLY way a floor-matching finding may ship: an explicit, auditable override,
  // keyed by the finding id the gate prints (id=…), each with a non-empty `reason`
  // (+ optional `by`). The reviewer's verdict line can NEVER waive the floor.
  "overrides": {
    // "broken-authz-check-on-approve-applications-ts-820": { "reason": "…", "by": "gareth" }
  },
  "stateDir": ".review-gate",
  "followupsFile": "FOLLOWUPS.md"
}
```

A finding also blocks if its title says "ship-blocking", or it is `high` severity AND
(in a blocking category, or describes data-loss/leak/strand, or a broken happy path).
Everything else routes to the followups file.

**The floor is authoritative — it beats the reviewer's verdict.** A `Verdict: ship` or
`Verdict: ship-with-followups` line can NOT carry a floor-matching finding past the gate
(that short-circuit was the bug that let a Critical and a high-authorization finding ship
as tracked debt). The ONLY escape is an explicit, auditable **override**: an entry in
`overrides` keyed by the finding id the gate prints (`id=…`), with a non-empty `reason`
(+ optional `by`). An overridden finding ships as tracked debt and is listed in the gate's
output so the sign-off is visible; a blank/absent reason does not waive (fail-closed). If a
finding's title later changes, its id changes and the override no longer applies — it must
be re-reviewed. Exit codes are unchanged: an un-overridden floor finding yields `20`
(fix-and-reconfirm) within budget, or `30` (stop-revise) if the budget is spent or a new
blocking category surfaces late.

## Reviewer output contract

Any reviewer must be promptable to emit:

- findings as lines —
  `- [critical|high|medium|low|info] <title> (file:line) | category: <c> | fix-level: <l>`
- one final line — `Verdict: no-ship | ship-with-followups | ship`
  (legacy `approve` / `needs-attention` / `reject` are mapped; absent category is
  heuristically inferred as a fallback, but emitting `category:` is authoritative).

The round prompts the engine sends already request exactly this.

## What stays in the repo (NOT here)

`review-gate` is the engine only. These are per-repo instances of generic *patterns* —
keep them in the repo, they don't belong in the shared harness:

- **Category guards** — pattern: auto-discover the subjects from the filesystem +
  a registration self-test that fails loudly when a subject isn't registered (a guard
  that silently skips a new subject is false confidence). Reference impl:
  `touchstone/scripts/check-adapter-isolation.mjs`.
- **Contract suites** — pattern: assert *membership* in a risk-class contract instead of
  re-proving each failure mode; stubs throw-until-implemented. Reference impl:
  `touchstone/src/test/contracts/`.
- **The acceptance matrix + process doc** — generic skeleton in
  `touchstone/docs/process/build-review-loop.md`; instantiate per repo.

## Status

v1, validated on Touchstone. The default category set + floor are deliberately not frozen
— pressure-test them on a second repo before promoting any to canonical, and only then
consider wrapping a `/build-review` skill around the templates.
