// R3b part A: admits() (src/shared/orchestrationAdmission.ts) is what apply() of main asks first. The snapshot below is the
// gates as they stood inline in apply() before the extraction (orchestrationService.ts at 6744e59), written out here by
// hand: every status x reason x journal version x proposal x work mode x command gives the same answer.
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PAUSED_REASONS_V2 } from "../src/main/services/orchestration/journal.ts";
import { admits } from "../src/shared/orchestrationAdmission.ts";

const RESUMABLE = ["user_request", "step_done", "plan_review", "permission_denied", "loop_suspected", "environment_error", "recovered",
  "app_closed", "stage_done", "external_failure", "needs_user_action", "finish_unconfirmed", "tree_changed_during_review"];
const STEP_ONLY = ["invalid_report", "protocol_error"];
const STOP_ONLY = ["lead_modified_tree", "shared_git_tampered", "journal_corrupt", "sandbox_unavailable"];
const FINDING_PAUSES = [...RESUMABLE, ...STEP_ONLY, "limit_reached", "awaiting_answer", "awaiting_person_decision"];
const ACTIVE = ["preparing", "running", "pausing", "paused"];
const BLOCKED = ["journal_corrupt", "awaiting_checks_decision", "awaiting_finish_confirmation", "check_needs_permissions", "awaiting_person_decision", "coverage_lost"];
// the old inline gates: true = the command went on past its status / reason check
const OLD = {
  pause_after_turn: (s) => s.status === "running",
  keep_running: (s) => s.status === "pausing",
  stop: (s) => ACTIVE.includes(s.status),
  resume: (s) => !(s.status !== "paused" || STOP_ONLY.includes(s.reason)) && RESUMABLE.includes(s.reason),
  step: (s) => !(s.status !== "paused" || STOP_ONLY.includes(s.reason)) && (RESUMABLE.includes(s.reason) || STEP_ONLY.includes(s.reason)),
  answer: (s) => !(s.status !== "paused" || s.reason !== "awaiting_answer"),
  clarify: (s) => !(!ACTIVE.includes(s.status) || BLOCKED.includes(s.reason) || (s.version === 2 && s.waits)),
  raise_limit: (s) => !(s.status !== "paused" || s.reason !== "limit_reached" || (s.version === 2 && s.waits)),
  recover: (s) => !(s.status !== "paused" || s.reason !== "outcome_unknown"),
  "recover.reset": (s) => !s.inPlace,
  dismiss: (s) => ["stopped", "completed", "failed"].includes(s.status),
  "checks.decide": (s) => !(s.status !== "paused" || s.reason !== "awaiting_checks_decision"),
  "check.amend": (s) => !(s.status !== "paused" || s.reason !== "check_needs_permissions"),
  "finish.confirm": (s) => !(s.status !== "paused" || s.reason !== "awaiting_finish_confirmation"),
  "person.decide": (s) => !(s.version !== 2 || s.status !== "paused"),
  "person.decide.disputed": (s) => s.reason === "awaiting_person_decision",
  "person.decide.condition": (s) => s.reason === "awaiting_person_decision",
  "person.decide.finding": (s) => FINDING_PAUSES.includes(s.reason),
  "plan.decide": (s) => !(s.version !== 2 || s.status !== "paused" || s.reason !== "coverage_lost"),
  permission: () => true
};

test("admits() answers exactly as the inline gates of apply() did, for every status, reason, version, proposal and work mode", () => {
  const statuses = ["preparing", "running", "pausing", "paused", "stopping", "stopped", "completed", "failed"];
  const reasons = ["", "no_such_reason", ...PAUSED_REASONS_V2];
  let n = 0;
  for (const status of statuses) for (const reason of reasons) for (const version of [1, 2]) for (const waits of [false, true]) for (const inPlace of [false, true]) {
    const old = { status, reason, version, waits, inPlace };
    for (const [kind, gate] of Object.entries(OLD)) {
      const got = admits(kind, { status, reason, version, proposalWaits: version === 2 && waits, inPlace });
      assert.equal(got, gate(old) ? null : "invalid_state", `${kind} on ${status}(${reason}) v${version} waits=${waits} inPlace=${inPlace}`);
      n++;
    }
  }
  assert.ok(n > 10_000);
});

// the service: the same answers from apply() itself, on a real pause (plan_review) and on a run that was stopped
import { createTestAgents, plan } from "./fixtures/orchestration/test-agents.mjs";
import { createOrchestrationService } from "../src/main/services/orchestration/orchestrationService.ts";
import { checkPreparedDeps, createRegistry } from "../src/main/services/orchestration/checks.ts";
import { findGit } from "../src/main/services/orchestration/git.ts";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GIT = findGit(process.env);
const NODE = fs.realpathSync(process.execPath);
const LAUNCH = { command: NODE, args: [path.join(HERE, "..", "src", "orchestration", "supervisor.mjs")], env: {} };
const SKIP = { skip: process.platform !== "darwin" && "checks run only in the macOS sandbox" };

test("apply() refuses with invalid_state where admits() does, on plan_review and after Stop", SKIP, async (t) => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "canvastty-adm-")));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tmp, "gitconfig"), "");
  const g = (cwd, ...args) => execFileSync(GIT, args, { cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: tmp, GIT_CONFIG_GLOBAL: path.join(tmp, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
  const src = path.join(tmp, "src");
  fs.cpSync(path.join(HERE, "fixtures", "orchestration", "check-project"), src, { recursive: true });
  fs.mkdirSync(path.join(src, "node_modules", "left-pad"), { recursive: true });
  fs.writeFileSync(path.join(src, "node_modules", "left-pad", "index.mjs"), "export default (s) => s;\n");
  g(src, "init", "-q", "-b", "main"); g(src, "add", "-A"); g(src, "commit", "-q", "-m", "fixture");
  const deps = checkPreparedDeps({ lockfileRelPath: "package-lock.json", lockfileSha256: createHash("sha256").update(fs.readFileSync(path.join(src, "package-lock.json"))).digest("hex"),
    nodeModulesPath: path.join(src, "node_modules") });
  const registry = createRegistry([{ id: "unit", title: "unit tests", executable: NODE, argv: ["--test", "tests/sum.test.mjs"], timeoutMs: 120_000, maxOutputBytes: 65_536 }]);
  const agents = createTestAgents({ plan: { report: plan("only stage") } });
  const run = await createOrchestrationService({ root: path.join(tmp, "root"), gitPath: GIT, agents, checks: { registry, deps, launch: LAUNCH } })
    .createRun({ source: src, goal: { text: "extend sum", criteria: ["sum works"], checks: ["unit"], reviewPlan: true } });
  const until = async (fn) => { for (let i = 0; i < 2400 && !fn(); i++) await new Promise((r) => setTimeout(r, 25)); assert.ok(fn()); };
  const send = (command) => run.command({ commandId: randomUUID(), expectedRevision: run.view().revision, command });
  await until(() => run.view().status === "paused");
  await run.idle();
  assert.equal(run.view().reason, "plan_review");
  const bare = { answer: { kind: "answer", questionId: "q", text: "x" }, raise_limit: { kind: "raise_limit", limit: "turns", value: 999 }, recover: { kind: "recover", action: "accept" },
    "checks.decide": { kind: "checks.decide", decision: "accept" }, "check.amend": { kind: "check.amend", checkId: "cmd-1", line: "npm test" },
    "finish.confirm": { kind: "finish.confirm", tree: "t", commit: null, push: null, qa: null }, dismiss: { kind: "dismiss" } };
  for (const [name, command] of Object.entries(bare)) {
    assert.deepEqual(await send(command), { status: "rejected", code: "invalid_state" }, `${name} on plan_review`);
  }
  assert.equal((await send({ kind: "clarify", text: "more" })).status, "accepted", "clarify is admitted on plan_review");
  assert.equal((await send({ kind: "stop" })).status, "accepted");
  await until(() => run.view().status === "stopped");
  assert.deepEqual(await send({ kind: "resume" }), { status: "rejected", code: "invalid_state" });
  assert.deepEqual(await send({ kind: "stop" }), { status: "rejected", code: "invalid_state" });
  assert.equal((await send({ kind: "dismiss" })).status, "accepted", "dismiss is admitted on a stopped run");
  await run.close();
});
