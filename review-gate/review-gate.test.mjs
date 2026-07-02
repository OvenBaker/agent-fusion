// review-gate engine tests (node --test). Integration-level: they drive the real
// engine as a subprocess with a stub reviewer, so no engine refactor is needed.
//
// Proves the severity floor is AUTHORITATIVE (beats the reviewer verdict) and waivable
// only by a recorded override:
//   (a) a floor finding under "ship-with-followups", NO override        -> BLOCKS (exit 20)
//   (b) the same finding WITH a recorded override                       -> SHIPS  (exit 10), surfaced
//   (c) a non-floor finding under "ship-with-followups"                 -> SHIPS  (exit 10), no regression
//   (d) a floor finding under a "ship" verdict, NO override             -> BLOCKS (exit 20)  (verdict can't bypass)
//   (e) a high compliance-integrity finding (new blocking category)     -> BLOCKS (exit 20)
//   (f) an override with a BLANK reason does NOT waive (fail-closed)     -> BLOCKS (exit 20)
//
// Run: node --test  (from ~/agents/review-gate/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE = fileURLToPath(new URL("review-gate.mjs", import.meta.url));

const BASE_CONFIG = {
  categories: ["authorization", "trust-boundary", "state-machine", "test-quality", "compliance-integrity"],
  budgets: { S: 1, M: 1, L: 2 },
  verifyFromRound: 3,
  floor: {
    blockingSeverities: ["critical"],
    blockingCategories: ["authorization", "trust-boundary", "compliance-integrity"],
  },
  stateDir: ".review-gate",
  followupsFile: "FOLLOWUPS.md",
};

// Build a target-repo sandbox: a stub reviewer that prints `reviewText`, plus a
// .review-gate.json wired to it (+ any config overlay).
function sandbox(reviewText, overlay = {}) {
  const root = mkdtempSync(join(tmpdir(), "rg-test-"));
  const stub = join(root, "reviewer-stub.mjs");
  writeFileSync(stub, `process.stdout.write(${JSON.stringify(reviewText)});\n`);
  const cfg = {
    ...BASE_CONFIG,
    ...overlay,
    reviewer: { command: "node", args: [stub, "{{PROMPT}}"], stageUntracked: false },
  };
  writeFileSync(join(root, ".review-gate.json"), JSON.stringify(cfg, null, 2));
  return { root, writeConfig: (c) => writeFileSync(join(root, ".review-gate.json"), JSON.stringify({ ...cfg, ...c }, null, 2)) };
}

function gate(root, args) {
  return spawnSync("node", [ENGINE, ...args], { cwd: root, encoding: "utf8" });
}
function initAndReview(root) {
  const i = gate(root, ["init", "TEST", "--track", "L"]);
  assert.equal(i.status, 0, `init failed: ${i.stderr}`);
  return gate(root, ["review"]);
}

const FLOOR_HIGH_AUTHZ =
  "- [high] Broken authz check on approve (applications.ts:820) | category: authorization | fix-level: local patch\nVerdict: ship-with-followups\n";
const FLOOR_CRITICAL_SHIP =
  "- [critical] Suppression bypassed on decline (x.ts:12) | category: state-machine | fix-level: local patch\nVerdict: ship\n";
const FLOOR_HIGH_COMPLIANCE =
  "- [high] Tipping-off axis leaks to status-safe lens (spine.ts:44) | category: compliance-integrity | fix-level: shared helper\nVerdict: ship-with-followups\n";
const NON_FLOOR =
  "- [low] Rename a confusing variable (utils.ts:3) | category: test-quality | fix-level: local patch\nVerdict: ship-with-followups\n";

test("(a) floor finding + ship-with-followups, no override -> BLOCKS (exit 20)", () => {
  const { root } = sandbox(FLOOR_HIGH_AUTHZ);
  const r = initAndReview(root);
  assert.equal(r.status, 20, `expected 20, got ${r.status}. out:\n${r.stdout}`);
  assert.match(r.stdout, /FIX-AND-RECONFIRM/);
  assert.match(r.stdout, /unwaived/i);
  rmSync(root, { recursive: true, force: true });
});

test("(b) same floor finding WITH a recorded override -> SHIPS (exit 10) and is surfaced", () => {
  const { root, writeConfig } = sandbox(FLOOR_HIGH_AUTHZ);
  // First run (no override) blocks and prints the finding id we key the override on.
  const blocked = initAndReview(root);
  assert.equal(blocked.status, 20);
  const id = (blocked.stdout.match(/id=(\S+)/) || [])[1];
  assert.ok(id, `expected an id= in output:\n${blocked.stdout}`);
  // Record an explicit override for that exact finding, then re-run.
  writeConfig({ overrides: { [id]: { reason: "accepted as tracked debt for launch", by: "gareth" } } });
  const shipped = initAndReview(root);
  assert.equal(shipped.status, 10, `expected 10 with override, got ${shipped.status}. out:\n${shipped.stdout}`);
  assert.match(shipped.stdout, /SHIP-WITH-FOLLOWUPS/);
  assert.match(shipped.stdout, /RECORDED OVERRIDE/);
  assert.match(shipped.stdout, /accepted as tracked debt for launch/);
  rmSync(root, { recursive: true, force: true });
});

test("(c) non-floor finding + ship-with-followups -> SHIPS (exit 10), no regression", () => {
  const { root } = sandbox(NON_FLOOR);
  const r = initAndReview(root);
  assert.equal(r.status, 10, `expected 10, got ${r.status}. out:\n${r.stdout}`);
  assert.match(r.stdout, /SHIP-WITH-FOLLOWUPS/);
  rmSync(root, { recursive: true, force: true });
});

test("(d) floor finding under a 'ship' verdict, no override -> BLOCKS (exit 20)", () => {
  const { root } = sandbox(FLOOR_CRITICAL_SHIP);
  const r = initAndReview(root);
  assert.equal(r.status, 20, `a 'ship' verdict must not bypass the floor; got ${r.status}. out:\n${r.stdout}`);
  rmSync(root, { recursive: true, force: true });
});

test("(e) high compliance-integrity finding hits the floor -> BLOCKS (exit 20)", () => {
  const { root } = sandbox(FLOOR_HIGH_COMPLIANCE);
  const r = initAndReview(root);
  assert.equal(r.status, 20, `compliance-integrity@high should block; got ${r.status}. out:\n${r.stdout}`);
  rmSync(root, { recursive: true, force: true });
});

test("(f) override with a blank reason does NOT waive (fail-closed) -> BLOCKS (exit 20)", () => {
  const { root, writeConfig } = sandbox(FLOOR_HIGH_AUTHZ);
  const blocked = initAndReview(root);
  const id = (blocked.stdout.match(/id=(\S+)/) || [])[1];
  assert.ok(id);
  writeConfig({ overrides: { [id]: { reason: "   ", by: "gareth" } } });
  const still = initAndReview(root);
  assert.equal(still.status, 20, `a blank-reason override must not waive; got ${still.status}. out:\n${still.stdout}`);
  rmSync(root, { recursive: true, force: true });
});
