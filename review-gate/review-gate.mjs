#!/usr/bin/env node
// review-gate — the bounded review loop (Gate B of the build-review process).
// SHARED ENGINE, v1. Repo-agnostic: all repo-flavored knobs live in a per-repo
// `.review-gate.json` (see README.md). Origin + rationale: ~/agents/notes/build-review-loop.md.
//
// It owns the MECHANICAL discipline a build agent skips under momentum: counting
// rounds, applying an AUTHORITATIVE SEVERITY FLOOR (a floor-matching finding blocks
// regardless of the reviewer's verdict line — waivable ONLY by a recorded override),
// enforcing CONVERGENCE (stop at the cap; a NEW ship-blocking category late => revise
// the design), and routing non-blockers to a backlog instead of fixing them. It does
// NOT fix anything — it decides and routes.
//
// Usage (run from the target repo root):
//   node <engine> init <change-id> [--track S|M|L]
//   node <engine> review        # run the next reviewer round + decide
//   node <engine> status | reset
//
// Exit codes: 0 ship · 10 ship-with-followups · 20 fix-and-reconfirm · 30 stop-revise · 1 error.
//
// Reviewer output contract (any reviewer plugged in must be promptable to emit this):
//   - findings as lines:  "- [critical|high|medium|low|info] <title> (file:line) | category: <c> | fix-level: <l>"
//   - one final line:     "Verdict: no-ship | ship-with-followups | ship"   (legacy approve/needs-attention/reject mapped)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

// ── Config: built-in DEFAULTS overlaid by the repo's .review-gate.json ────────
// The defaults below are data-service-flavored (tuned on the first instance,
// Touchstone). DO NOT treat them as canonical — a new repo should declare its own
// categories/floor in .review-gate.json and let its findings refine them.
const DEFAULTS = {
  stateDir: ".review-gate",
  followupsFile: "FOLLOWUPS.md",
  verifyFromRound: 3,
  budgets: { S: 1, M: 1, L: 2 },
  categories: [
    "authorization", "consent", "trust-boundary", "state-machine",
    "cache-identity", "provider-failure-taxonomy", "migration-data-integrity",
    "retry-recovery", "invariant-guard-coverage", "test-quality",
  ],
  floor: {
    blockingSeverities: ["critical"],
    blockingCategories: ["authorization", "trust-boundary"],
  },
  // Auditable escape hatch for the floor. A floor-matching finding may ship ONLY if an
  // override entry (here or in the repo's .review-gate.json) is keyed by its finding id
  // and carries a non-empty `reason` (+ optional `by`). Empty by default; the reviewer's
  // verdict line can NEVER waive the floor — only a recorded override can.
  overrides: {},
  reviewer: {
    command: "node",
    args: ["{{CODEX}}", "adversarial-review", "--wait", "--scope", "working-tree", "{{PROMPT}}"],
    stageUntracked: true,
  },
};

function loadConfig() {
  let user = {};
  const p = join(ROOT, ".review-gate.json");
  if (existsSync(p)) {
    try { user = JSON.parse(readFileSync(p, "utf8")); }
    catch (e) { die(`.review-gate.json is not valid JSON: ${e.message}`); }
  }
  return {
    ...DEFAULTS, ...user,
    budgets: { ...DEFAULTS.budgets, ...(user.budgets || {}) },
    floor: { ...DEFAULTS.floor, ...(user.floor || {}) },
    reviewer: { ...DEFAULTS.reviewer, ...(user.reviewer || {}) },
    categories: user.categories || DEFAULTS.categories,
    overrides: user.overrides || DEFAULTS.overrides,
  };
}
const cfg = loadConfig();
const DIR = join(ROOT, cfg.stateDir);
const STATE = join(DIR, "state.json");
const FOLLOWUPS = join(ROOT, cfg.followupsFile);

function resolveCodex() {
  if (process.env.CODEX_COMPANION) return process.env.CODEX_COMPANION;
  const base = join(process.env.HOME || "", ".claude/plugins/cache/openai-codex/codex");
  try {
    for (const v of readdirSync(base).sort().reverse()) {
      const cand = join(base, v, "scripts/codex-companion.mjs");
      if (existsSync(cand)) return cand;
    }
  } catch { /* none */ }
  return null;
}

function loadState() {
  if (!existsSync(STATE)) die(`No review-gate state. Run: review-gate init <change-id> [--track L]`);
  return JSON.parse(readFileSync(STATE, "utf8"));
}
function saveState(s) {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2) + "\n");
}
function die(msg) { console.error(msg); process.exit(1); }

// ── Round-aware prompts ───────────────────────────────────────────────────────
function firstPassPrompt(id) {
  return [
    `Category-level review of the working-tree diff for ${id} against its acceptance matrix.`,
    `Do NOT enumerate edge cases that share a root cause — report the root cause + a generalized fix.`,
    `Group findings under: ${cfg.categories.join(", ")}.`,
    `For each finding give a line: "- [severity] <title> (file:line) | category: <one group> | fix-level: <local patch|shared helper|DB constraint|reusable contract test|generalized guard|design revision>".`,
    `End with exactly one line "Verdict: no-ship" (ONLY for spec-acceptance failure, security/consent/privacy invariant breach, data loss/corruption, or broken happy path), "Verdict: ship-with-followups", or "Verdict: ship".`,
  ].join(" ");
}
function verifyPrompt(id, seen) {
  return [
    `Verify the prior findings for ${id} are closed. Do NOT perform a fresh broad review.`,
    `Admit a NEW finding only if it is ship-blocking. Categories seen so far: ${seen.join(", ") || "(none)"}.`,
    `If you admit one, classify it under those categories OR name the missing design category that allowed it, and explain why prior review missed it.`,
    `Same per-finding line format and a single final "Verdict: no-ship|ship-with-followups|ship" line. Prefer root-cause over edge-case findings.`,
  ].join(" ");
}

// ── Parse + classify ──────────────────────────────────────────────────────────
function parseReview(text) {
  const findings = [];
  const fre = /^\s*-\s*\[(critical|high|medium|low|info)\]\s*(.+)$/gim;
  let m;
  while ((m = fre.exec(text))) {
    const sev = m[1].toLowerCase();
    const rest = m[2];
    const catRaw = (rest.match(/category:\s*([a-z0-9/\- ]+)/i) || [, ""])[1].trim().toLowerCase().replace(/\s+/g, "-").replace(/\//g, "-");
    const fix = (rest.match(/fix-level:\s*([a-z0-9\- ]+)/i) || [, ""])[1].trim().toLowerCase();
    const title = rest.split("|")[0].trim();
    findings.push({ severity: sev, category: normCategory(catRaw, rest, text), fixLevel: fix, title });
  }
  let verdict = (text.match(/Verdict:\s*(no-ship|ship-with-followups|ship|needs-attention|approve|reject)/i) || [, ""])[1].toLowerCase();
  if (verdict === "approve") verdict = "ship";
  else if (verdict === "reject") verdict = "no-ship";
  else if (verdict === "needs-attention" || verdict === "") verdict = findings.some(isShipBlocking) ? "no-ship" : (findings.length ? "ship-with-followups" : "ship");
  return { verdict, findings };
}
function normCategory(cat, line, full) {
  if (cat) {
    const hit = cfg.categories.find((c) => c.startsWith(cat) || cat.startsWith(c) || cat.includes(c.split("-")[0]));
    if (hit) return hit;
  }
  // Heuristic FALLBACK only (authoritative path is the reviewer emitting `category:`).
  const hay = (line + " " + full.slice(0, 400)).toLowerCase();
  if (/consent|authoriz|authz|scope|gate|disclos/.test(hay)) return pick("authorization");
  if (/poison|untrusted|trust|tenant|cross-entity/.test(hay)) return pick("trust-boundary");
  if (/state machine|crash|partial|finalize|idempoten|lease|claim/.test(hay)) return pick("state-machine");
  if (/cache|profile|sha256|alias|identity|provenance/.test(hay)) return pick("cache-identity");
  if (/retry|terminal|transient|permanent|recover|stranded|cooldown|backfill/.test(hay)) return pick("provider-failure-taxonomy");
  if (/migration|rollback|down\b|check constraint/.test(hay)) return pick("migration-data-integrity");
  if (/guard|isolation|lockstep/.test(hay)) return pick("invariant-guard-coverage");
  return "uncategorized";
}
const pick = (c) => (cfg.categories.includes(c) ? c : "uncategorized");

// The SEVERITY FLOOR (config-driven): only these block the commit.
function isShipBlocking(f) {
  const t = f.title.toLowerCase();
  if (/ship-blocking|no-ship/.test(t)) return true;
  if (cfg.floor.blockingSeverities.includes(f.severity)) return true;
  const securityish = cfg.floor.blockingCategories.includes(f.category);
  const dataloss = /data loss|corruption|strand|lost|leak|disclos|bypass/.test(t);
  const brokenHappyPath = /broken|does not work|never|cannot|fails to/.test(t);
  return f.severity === "high" && (securityish || dataloss || brokenHappyPath);
}

// A finding's stable override key: a slug of its title. The engine prints it next to
// each ship-blocker so a human can record an override for that exact finding.
function findingId(f) {
  return f.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
// The ONLY way a floor-matching finding may ship: an explicit, auditable override entry
// (distinct from the reviewer's verdict line) with a non-empty `reason`. A blank/absent
// reason does NOT waive — fail-closed. If the finding's title changes, its id changes and
// the override no longer matches, so a rephrased finding must be re-reviewed/re-overridden.
function overrideFor(overrides, f) {
  const o = overrides && overrides[findingId(f)];
  return o && typeof o === "object" && typeof o.reason === "string" && o.reason.trim() ? o : null;
}

function runReviewer(prompt) {
  const r = cfg.reviewer;
  if (r.stageUntracked !== false) { try { execFileSync("git", ["add", "-N", "."], { cwd: ROOT, stdio: "ignore" }); } catch { /* ok */ } }
  let codex = null;
  const args = r.args.map((a) => {
    if (a.includes("{{CODEX}}")) { codex = codex ?? resolveCodex(); if (!codex) die("Reviewer needs {{CODEX}} but codex-companion.mjs was not found (set CODEX_COMPANION or a custom reviewer in .review-gate.json)."); a = a.replace("{{CODEX}}", codex); }
    return a.replace("{{PROMPT}}", prompt);
  });
  return execFileSync(r.command, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function writeFollowups(id, round, findings) {
  if (findings.length === 0) return 0;
  if (!existsSync(FOLLOWUPS)) writeFileSync(FOLLOWUPS, `# Follow-ups\n\nNon-blocking review findings routed here by the review gate (Gate B). Triage in batch; never let one re-open a hardening loop.\n`);
  const lines = findings.map((f) => `- [ ] (${id}, r${round}) **[${f.severity}]** ${f.title} _(category: ${f.category}; fix-level: ${f.fixLevel || "tbd"})_`);
  appendFileSync(FOLLOWUPS, `\n<!-- ${id} round ${round} -->\n` + lines.join("\n") + "\n");
  return findings.length;
}

// ── Commands ──────────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);

if (cmd === "init") {
  const id = rest.find((a) => !a.startsWith("--"));
  if (!id) die("Usage: review-gate init <change-id> [--track S|M|L]");
  const ti = rest.indexOf("--track");
  const track = (ti >= 0 ? rest[ti + 1] : "L").toUpperCase();
  if (!cfg.budgets[track]) die(`--track must be one of ${Object.keys(cfg.budgets).join(", ")} (got ${track})`);
  saveState({ id, track, round: 0, categories: [], history: [] });
  console.log(`review-gate initialised for ${id} (track ${track}, max ${cfg.budgets[track]} fix-confirm loops).`);
  console.log(`Round ${cfg.verifyFromRound}+ is verification-only; a NEW ship-blocking category there => revise the design.`);
  process.exit(0);
}
if (cmd === "status") { console.log(JSON.stringify({ config: { categories: cfg.categories, budgets: cfg.budgets, floor: cfg.floor }, state: existsSync(STATE) ? loadState() : null }, null, 2)); process.exit(0); }
if (cmd === "reset") { saveState({ id: null, track: "L", round: 0, categories: [], history: [] }); console.log("reset."); process.exit(0); }

if (cmd === "review") {
  const s = loadState();
  if (!s.id) die("Run: review-gate init <change-id> first.");
  const round = s.round + 1;
  const verifyOnly = round >= cfg.verifyFromRound;
  const prompt = verifyOnly ? verifyPrompt(s.id, s.categories) : firstPassPrompt(s.id);
  console.error(`\n=== review-gate ${s.id} round ${round} (${verifyOnly ? "verify-only" : "review"}) ===`);
  const out = runReviewer(prompt);
  writeFileSync(join(DIR, `round-${round}.md`), out);
  const { verdict, findings } = parseReview(out);

  const blocking = findings.filter(isShipBlocking);
  // The SEVERITY FLOOR is authoritative and beats the reviewer's verdict line: a
  // floor-matching finding ships ONLY if an explicit override waives it (fail-closed).
  const overrides = cfg.overrides || {};
  const waived = blocking.filter((f) => overrideFor(overrides, f));
  const unwaived = blocking.filter((f) => !overrideFor(overrides, f));
  const newCategories = [...new Set(unwaived.map((f) => f.category))].filter((c) => !s.categories.includes(c));
  s.categories = [...new Set([...s.categories, ...findings.map((f) => f.category)])];
  s.round = round;
  s.history.push({ round, verdict, findings: findings.length, blocking: blocking.length, unwaived: unwaived.length, waived: waived.length, newCategories });

  let code, decision;
  const overBudget = round - 1 >= cfg.budgets[s.track];
  const newBlockingCategoryLate = verifyOnly && newCategories.length > 0;

  // FLOOR FIRST — evaluated BEFORE any ship / ship-with-followups short-circuit, so no
  // reviewer verdict can let an un-overridden floor finding through.
  if (unwaived.length > 0) {
    if (newBlockingCategoryLate) {
      code = 30; decision = `STOP — REVISE THE DESIGN. Round ${round} surfaced a NEW ship-blocking category (${newCategories.join(", ")}). The design model is incomplete — patching locally is the design-by-review failure. Go back to Gate A and revise ${s.id}.`;
    } else if (overBudget) {
      code = 30; decision = `STOP — REVISE THE DESIGN. Fix-confirm budget for track ${s.track} (${cfg.budgets[s.track]}) is spent and ship-blockers remain. Re-derive the relevant invariant/state-machine wholesale in the design, then restart the gate.`;
    } else {
      code = 20; decision = `FIX-AND-RECONFIRM — ${unwaived.length} unwaived ship-blocker(s) within budget (the severity floor beats the verdict). Fix the WHOLE invariant (all layers/branches), not just the cited line, then: review-gate review.`;
    }
  } else if (verdict === "ship") {
    code = 0; decision = "SHIP — clean. Land it.";
  } else {
    // No unwaived floor finding: ship-with-followups. Route non-blockers AND any
    // overridden floor findings to the backlog as tracked debt.
    const n = writeFollowups(s.id, round, findings);
    const wnote = waived.length ? ` ${waived.length} floor finding(s) shipped under RECORDED OVERRIDE (tracked debt — see below).` : "";
    code = 10; decision = `SHIP-WITH-FOLLOWUPS — no unwaived ship-blockers.${wnote} ${n} item(s) routed to ${cfg.followupsFile}. Land it; do NOT keep hardening.`;
  }

  saveState(s);
  console.log(`\nVerdict: ${verdict} | findings: ${findings.length} (blocking ${blocking.length}: ${unwaived.length} unwaived, ${waived.length} overridden) | round ${round}, budget ${cfg.budgets[s.track]} fix-confirm`);
  if (unwaived.length) { console.log("Ship-blockers (unwaived — the floor beats the verdict):"); for (const f of unwaived) console.log(`  - [${f.severity}] ${f.title} (${f.category})  id=${findingId(f)}`); }
  if (waived.length) { console.log("Overridden floor findings (shipping as tracked debt; sign-off recorded):"); for (const f of waived) { const o = overrideFor(overrides, f); console.log(`  - [${f.severity}] ${f.title} (${f.category})  id=${findingId(f)}  reason=${JSON.stringify(o.reason)}${o.by ? ` by=${o.by}` : ""}`); } }
  console.log(`\nDECISION: ${decision}`);
  console.log(`(raw review: ${cfg.stateDir}/round-${round}.md)`);
  process.exit(code);
}

die(`Unknown command "${cmd || ""}". Usage: review-gate <init|review|status|reset>`);
