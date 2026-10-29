// F4, part 2 — T-9 and T-14 (docs/agent-orchestration/implementation/stage-f-external-projects.md §4, §5, §7.5, §8): the
// review export of a completed board task's run by board-review/v1 (review.json and review.md outside the project's tree,
// once per run, whole or not at all, written again after a crash at the application's start), the profile's
// reviewExport and runMcp, every field of board-tasks/v1 taken (scope; the full example of the format's document), and
// the runs without MCP (Claude: --strict-mcp-config and its init; Codex: no override, its thread's servers listed before
// each turn, closed on failure). Neutral fixtures only (upstream/stable, T1, ISSUE-1), local repositories with a bare
// remote, fake CLIs: no model, no real Codex or Claude, no network, no config of a CLI touched.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { findGit } from "../src/main/services/orchestration/git.ts";
import { fingerprint } from "../src/main/services/orchestration/boardAutopilot.ts";
import { createBoardStore } from "../src/main/services/orchestration/boardStore.ts";
import { readTasksFile } from "../src/main/services/orchestration/boardImport.ts";
import { createRunManager, testNativeRuntime } from "../src/main/services/orchestration/manager.ts";
import { validateProfile } from "../src/main/services/orchestration/profile.ts";
import { buildNativeTurn } from "../src/main/services/orchestration/providers.ts";
import { buildReview, cliVersions, createReviewExporter, reviewMarkdown } from "../src/main/services/orchestration/reviewExport.ts";
import { claudeHostDriver, codexAppServerDriver } from "../src/main/services/orchestration/sessions.ts";
import { PAUSED_REASONS_V2 } from "../src/main/services/orchestration/journal.ts";
import { pauseCause } from "../src/shared/orchestrationPause.ts";
import { AUTOPILOT_BUDGET } from "../src/shared/taskBoard.ts";
import { causeText } from "../src/renderer/src/features/orchestration/runModel.ts";
import { t as words } from "../src/renderer/src/lib/i18n.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(HERE, "..", "docs");
const GIT = findGit(process.env);
const NODE = fs.realpathSync(process.execPath);
const LAUNCH = { command: NODE, args: [path.join(HERE, "..", "src", "orchestration", "supervisor.mjs")], env: {} };
const OPTS = { skip: process.platform === "win32" && "orchestration runs on macOS and Linux", timeout: 300_000 };
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "raoden-f4r-")));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
fs.writeFileSync(path.join(TMP, "gitconfig"), "[user]\n\tname = t\n\temail = t@t\n");
const GIT_ENV = { PATH: process.env.PATH, HOME: TMP, GIT_CONFIG_GLOBAL: path.join(TMP, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };
const g = (cwd, ...args) => execFileSync(GIT, args, { cwd, encoding: "utf8", env: GIT_ENV });
let n = 0;
const WS = "common";
const code = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
const AjvClass = Ajv2020.default ?? Ajv2020;
const validReview = new AjvClass({ strict: true, strictRequired: false, allErrors: true }).compile(JSON.parse(fs.readFileSync(path.join(DOCS, "board-review-v1.schema.json"), "utf8")));
const PROFILE = (over = {}) => ({ v: 1, workMode: "worktree", checks: ["true"], prepare: { steps: [], auto: true }, env: { direnv: true }, access: { claude: "workspace", codex: "workspace" },
  finish: { commit: true, push: null, qa: null }, grants: [], savedAt: null, ...over });
const RB = { runBase: { remote: "upstream", branch: "stable", remoteUrl: "/r" } };

// ---------------- the pieces: versions, the profile, the export's build ----------------

test("cliVersions (О7): the semver word of the first line and the line itself up to 128; no version — null and the line; not read — both null", () => {
  assert.deepEqual(cliVersions("2.1.0 (Claude Code)"), { cliVersionAtExport: "2.1.0", cliVersionRaw: "2.1.0 (Claude Code)" });
  assert.deepEqual(cliVersions("codex-cli 0.155.0\nsecond line"), { cliVersionAtExport: "0.155.0", cliVersionRaw: "codex-cli 0.155.0" });
  assert.deepEqual(cliVersions("custom build"), { cliVersionAtExport: null, cliVersionRaw: "custom build" });
  assert.deepEqual(cliVersions("tool 1.2.3-beta.1"), { cliVersionAtExport: "1.2.3-beta.1", cliVersionRaw: "tool 1.2.3-beta.1" });
  const long = `v ${"x".repeat(200)}`;
  assert.equal(cliVersions(long).cliVersionRaw, long.slice(0, 128));
  assert.deepEqual(cliVersions(null), { cliVersionAtExport: null, cliVersionRaw: null });
});

test("validateProfile: reviewExport needs the worktree, runBase and the commit; runMcp false kept; absent or the defaults — no key", () => {
  assert.equal(validateProfile(PROFILE({ ...RB, reviewExport: true })).reviewExport, true);
  for (const p of [PROFILE(), PROFILE({ reviewExport: false }), PROFILE({ runMcp: true })]) {
    const v = validateProfile(p);
    assert.deepEqual(["reviewExport" in v, "runMcp" in v], [false, false]);
  }
  assert.equal(code(() => validateProfile(PROFILE({ reviewExport: true }))), "review_export_needs_base");
  assert.equal(code(() => validateProfile(PROFILE({ ...RB, reviewExport: true, finish: { commit: false, push: null, qa: null } }))), "review_export_needs_commit");
  for (const workMode of ["copy", "project"]) assert.equal(code(() => validateProfile(PROFILE({ workMode, reviewExport: true }))), "work_mode_not_worktree");
  assert.equal(code(() => validateProfile(PROFILE({ ...RB, reviewExport: "yes" }))), "invalid_profile");
  assert.equal(validateProfile(PROFILE({ runMcp: false })).runMcp, false);
  assert.equal(validateProfile(PROFILE({ workMode: "copy", runMcp: false })).runMcp, false, "runMcp in any mode");
  assert.equal(code(() => validateProfile(PROFILE({ runMcp: "no" }))), "invalid_profile");
});

test("the fingerprint holds reviewExport and runMcp; a profile without them prints as before", () => {
  const p = { access: { claude: "workspace", codex: "workspace" }, workMode: "worktree", checks: ["true"], prepare: { steps: [], auto: true }, env: { direnv: true },
    finish: { commit: true, push: null, qa: null }, grants: [] };
  assert.equal(fingerprint(p), JSON.stringify({ access: p.access, workMode: p.workMode, models: null, finish: p.finish, checks: p.checks, prepare: p.prepare, env: p.env, grants: [] }));
  assert.notEqual(fingerprint({ ...p, reviewExport: true }), fingerprint(p));
  assert.notEqual(fingerprint({ ...p, runMcp: false }), fingerprint(p));
});

const INPUT = (over = {}) => ({
  runId: "0b9f1c52-3d9a-4c1e-9a55-6f0c2d7a8e11", task: { key: "T-2", ref: "T2" }, boardTask: { title: "Second task", issue: "ISSUE-1", scope: ["docs/**"] },
  commit: "3".repeat(40), tree: "9".repeat(40), checkedTree: "9".repeat(40), base: { branch: "upstream/stable", commit: "e".repeat(40) }, branch: "ISSUE-1-T2",
  push: { remote: "upstream", at: "2026-10-21T10:15:30.000Z" }, roles: { lead: "codex", executor: "claude", reviewer: "codex" }, models: { executor: "opus" },
  versions: { claude: "2.1.0 (Claude Code)", codex: "codex-cli 0.155.0" },
  conditions: [{ id: "C1", text: "a check", covers: ["R1"], stage: 1, status: "met", evidence: { kind: "check", check: "cmd-1", command: "make lint" }, proof: null },
    { id: "C2", text: "a change", covers: ["R1"], stage: 1, status: "met", stale: true, evidence: { kind: "change" } }],
  findings: [
    { id: "F1", severity: "wish", status: "closed", downgraded: true, problem: "p | 1", evidence: "", closeWhen: "w", paths: ["a.md"], history: [{ kind: "opened" }, { kind: "closed_by_person" }] },
    { id: "F2", severity: "blocking", status: "open", problem: "p2", evidence: "e", closeWhen: "w2", paths: [], history: [{ kind: "opened" }] },
    { id: "F3", severity: "blocking", status: "closed", downgraded: false, problem: "p3", evidence: "e", closeWhen: "w3", paths: [], history: [{ kind: "opened" }, { kind: "closed" }] }],
  ...over
});

test("buildReview: the fields of board-review/v1 from their sources — passes the schema; null cases; review.md holds the same findings", () => {
  const r = buildReview(INPUT());
  assert.ok(validReview(r), JSON.stringify(validReview.errors));
  assert.deepEqual(r.push, { remote: "upstream", at: "2026-10-21T10:15:30.000Z", result: "confirmed" });
  assert.deepEqual([r.lead.model, r.executor.model, r.executor.modelActual, r.reviewer.cliVersionAtExport, r.executor.cliVersionAtExport], [null, "opus", null, "0.155.0", "2.1.0"]);
  assert.deepEqual(r.conditions.map((c) => [c.id, c.stale, c.evidence]), [["C1", false, { kind: "check", check: "cmd-1", command: "make lint" }], ["C2", true, { kind: "change", check: null, command: null }]]);
  assert.deepEqual(r.findings.map((f) => [f.id, f.severity, f.status, f.closedBy, f.downgraded]),
    [["F1", "wish", "closed", "person", true], ["F2", "blocking", "open", null, false], ["F3", "blocking", "closed", "reviewer", false]]);
  assert.equal(r.openBlocking, 1);
  assert.deepEqual(r.scope, ["docs/**"]);
  const md = reviewMarkdown(r);
  for (const f of ["F1", "F2", "F3", "p \\| 1", "ISSUE-1", "make lint"]) assert.ok(md.includes(f), f);
  // a task removed from the board, no push, no reviewer, the CLI not read, no conditions or findings
  const bare = buildReview(INPUT({ boardTask: null, push: null, roles: { lead: "codex", executor: "claude", reviewer: null }, versions: { claude: null, codex: null }, conditions: [], findings: [] }));
  assert.ok(validReview(bare), JSON.stringify(validReview.errors));
  assert.deepEqual([bare.task, bare.push, bare.reviewer, bare.scope, bare.findings, bare.conditions], [{ key: "T-2", ref: "T2", title: null, issue: null }, null, null, null, [], []]);
  assert.deepEqual([bare.executor.cliVersionAtExport, bare.executor.cliVersionRaw], [null, null]);
  assert.match(reviewMarkdown(bare), /No findings\./);
});

test("the exporter: whole or nothing (a crash after the temporary folder leaves nothing), single-flight, never again once written, never through a symbolic link", async () => {
  const root = path.join(TMP, `root-${++n}`);
  const runId = randomUUID();
  fs.mkdirSync(path.join(root, "runs", runId), { recursive: true });
  let asked = 0;
  let crash = true;
  const ex = createReviewExporter({ root, source: async () => { asked++; return INPUT({ runId }); }, afterTmp: () => { if (crash) throw new Error("crash"); } });
  await assert.rejects(ex.write(runId), /crash/);
  assert.deepEqual(fs.readdirSync(path.join(root, "runs", runId)), [], "no export/ and no temporary folder left");
  crash = false;
  const [a, b] = await Promise.all([ex.write(runId), ex.write(runId)]);
  assert.deepEqual([a, b, asked], [true, true, 2], "two calls at once: one write");
  const dir = path.join(root, "runs", runId, "export");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["review.json", "review.md"]);
  assert.ok(validReview(JSON.parse(fs.readFileSync(path.join(dir, "review.json"), "utf8"))));
  assert.equal(await ex.write(runId), false, "written once");
  assert.equal(asked, 2);
  // a run folder that is a symbolic link is not followed; the catch-up removes a temporary folder a crash left
  const other = path.join(TMP, `elsewhere-${++n}`);
  fs.mkdirSync(other);
  const linked = randomUUID();
  fs.symlinkSync(other, path.join(root, "runs", linked));
  assert.equal(await ex.write(linked), false);
  assert.deepEqual(fs.readdirSync(other), []);
  const left = randomUUID();
  fs.mkdirSync(path.join(root, "runs", left, "export.tmp-x"), { recursive: true });
  const written = await ex.catchUp();
  assert.deepEqual(written, [left]);
  assert.deepEqual(fs.readdirSync(path.join(root, "runs", left)), ["export"]);
});

// ---------------- the import: every field of board-tasks/v1 ----------------

const repo = () => {
  const dir = path.join(TMP, `repo-${++n}`);
  fs.mkdirSync(dir);
  execFileSync(GIT, ["init", "-q", dir], { env: GIT_ENV });
  return dir;
};
const WORKSPACES = { open: (id) => id === WS, named: (x) => (x === "acme" ? [WS] : []) };
const fileOf = (tasks, top = {}) => Buffer.from(JSON.stringify({ format: "board-tasks/v1", workspace: "acme", ...top, tasks }));
async function imp(st, tasks) {
  const r = await readTasksFile("tasks.json", fileOf(tasks), WORKSPACES);
  return (await st.importTasks(r.job, async () => new Set(), () => true)).rows;
}

test("import (F4): scope accepted and kept; a bad one → invalid_task; the same again — unchanged; a file without it takes it off", async () => {
  const dir = repo();
  const file = path.join(TMP, `board-${++n}.json`);
  const st = createBoardStore(file);
  const byRef = (ref) => JSON.parse(fs.readFileSync(file, "utf8")).tasks.find((t) => t.ref === ref);
  const row = (ref, over = {}) => ({ ref, project: dir, title: ref, text: ref, criteria: ["c"], ...over });
  let rows = await imp(st, [row("T1", { scope: ["docs/**", "src/a.ts"] }), row("T2", { scope: [] }), row("T3", { scope: ["x".repeat(301)] }), row("T4", { scope: Array.from({ length: 65 }, (_, i) => `d${i}`) }),
    row("T5", { scope: [" "] }), row("T6", { scope: "docs/**" })]);
  assert.deepEqual(rows.refused.map((x) => [x.ref, x.code]), [["T2", "invalid_task"], ["T3", "invalid_task"], ["T4", "invalid_task"], ["T5", "invalid_task"], ["T6", "invalid_task"]]);
  assert.deepEqual(byRef("T1").scope, ["docs/**", "src/a.ts"]);
  assert.deepEqual((await imp(st, [row("T1", { scope: ["docs/**", "src/a.ts"] })])).unchanged, ["T1"]);
  rows = await imp(st, [row("T1")]);
  assert.deepEqual([rows.updated.map((x) => x.ref), "scope" in byRef("T1")], [["T1"], false]);
  // board.json by hand: a bad scope is dropped, the board kept
  const t = byRef("T1");
  fs.writeFileSync(file, JSON.stringify({ v: 1, tasks: [{ ...t, scope: [1] }], counters: { [WS]: 9 } }));
  assert.equal("scope" in (await createBoardStore(file).read()).board.tasks[0], false);
});

test("the full example of board-tasks/v1 from the format's document, with project and workspace put in, is imported whole (every field taken in F4)", async () => {
  const doc = fs.readFileSync(path.join(DOCS, "agent-orchestration", "board-formats.md"), "utf8");
  const full = JSON.parse(doc.match(/<!-- example: tasks-full -->\s*```json\n([\s\S]*?)\n```/)[1]);
  const dir = repo();
  for (const t of full.tasks) t.project = dir;
  const st = createBoardStore(path.join(TMP, `board-${++n}.json`));
  const r = await readTasksFile("tasks.json", Buffer.from(JSON.stringify(full)), WORKSPACES);
  const rows = (await st.importTasks(r.job, async () => new Set(), () => true)).rows;
  assert.deepEqual([rows.refused, rows.created.map((x) => x.ref)], [[], ["T1", "T1-MR", "T2"]]);
  const t2 = (await st.read()).board.tasks.find((t) => t.ref === "T2");
  assert.deepEqual([t2.issue, t2.commitTitle, t2.scope, t2.models], ["ISSUE-1", "feat: second task", ["docs/**"], { executor: "opus" }]);
});

// ---------------- the manager: fixtures ----------------

// the fake CLIs; <dir>/version-hang makes `--version` hang (the export waits 5 s for it)
const FLAGS = fs.mkdtempSync(path.join(TMP, "flags-"));
function wrapper(name, mock, version) {
  const file = path.join(TMP, name);
  fs.writeFileSync(file, `#!/bin/sh\n[ "$1" = "--version" ] && { [ -f "${FLAGS}/version-hang" ] && exec sleep 30; echo "${version}"; echo "second line"; exit 0; }\nexec "${NODE}" "${path.join(HERE, "fixtures", "orchestration", mock)}" "$@"\n`, { mode: 0o755 });
  return file;
}
const CODEX = wrapper("codex", "mock-codex.mjs", "codex-cli 0.155.1");
const CLAUDE = wrapper("claude", "mock-claude.mjs", "2.1.281 (Claude Code)");
const SHELL = path.join(TMP, "test-shell");
// the login shell: every line logged; <FLAGS>/lsfail makes `git ls-remote` fail (the push's outcome unknown)
fs.writeFileSync(SHELL, `#!/bin/sh\ncase "$1" in -ilc|-c) shift ;; esac\nprintf '%s\\n' "$1" >> "${FLAGS}/shell.log"\ncase "$1" in *"git ls-remote"*) [ -f "${FLAGS}/lsfail" ] && exit 3 ;; esac\nexec /bin/sh -c "$1"\n`, { mode: 0o755 });
const shellLines = (re) => (fs.existsSync(path.join(FLAGS, "shell.log")) ? fs.readFileSync(path.join(FLAGS, "shell.log"), "utf8").split("\n").filter((l) => re.test(l)).length : 0);
const CHECK_ENV = { ...GIT_ENV, PATH: `/usr/bin:/bin:${path.dirname(GIT)}` };
const turns = (file) => {
  const c1 = { keep: null, text: `${file} says done`, covers: ["R1"], evidence: { kind: "change", check: null } };
  return [
    { answer: { stages: [{ title: "fix", task: `write ${file}`, conditions: [c1] }], dropped: [], dropRequirements: [], question: null } },
    { answer: { summary: "done", done: true }, writes: [{ rel: file, base64: Buffer.from("done\n").toString("base64") }] },
    { answer: { conditions: [{ id: "C1", status: "met", paths: [file], note: "written" }], findings: [], request: "none", question: null } },
    { answer: { conditions: [], findings: [], request: "none", question: null, requirements: [{ id: "R1", status: "met", note: "written" }] } }
  ];
};
// a run that changes nothing: its commit has nothing to commit
const nothing = () => {
  const c1 = { keep: null, text: "nothing to do", covers: ["R1"], evidence: { kind: "check", check: "cmd-1" } };
  return [
    { answer: { stages: [{ title: "look", task: "look", conditions: [c1] }], dropped: [], dropRequirements: [], question: null } },
    { answer: { summary: "nothing", done: true } },
    { answer: { conditions: [], findings: [], request: "none", question: null } },
    { answer: { conditions: [], findings: [], request: "none", question: null, requirements: [{ id: "R1", status: "met", note: "nothing" }] } }
  ];
};
function scripts(...sets) {
  const dir = path.join(TMP, `script-${++n}`);
  sets.forEach((answers, k) => {
    const sub = path.join(dir, String(k + 1));
    fs.mkdirSync(sub, { recursive: true });
    answers.forEach((a, i) => {
      fs.writeFileSync(path.join(sub, `${i + 1}.json`), JSON.stringify(a.answer));
      if (a.writes) fs.writeFileSync(path.join(sub, `${i + 1}.writes.json`), JSON.stringify(a.writes));
    });
  });
  return dir;
}
function manager(script, { root = path.join(TMP, `root-${++n}`), env = {}, state = fs.mkdtempSync(path.join(TMP, "state-")), afterExportTmp } = {}) {
  const file = path.join(TMP, `providers-${++n}.json`);
  const p = { path: `${TMP}:/usr/bin:/bin`, env: { HOME: TMP, MOCK_STATE: state, MOCK_SCRIPT: script, MOCK_SCRIPT_PER_CWD: "1", ...env } };
  fs.writeFileSync(file, JSON.stringify({ codex: { executable: CODEX, version: "codex-cli 0.155.1", ...p }, claude: { executable: CLAUDE, version: "2.1.281 (Claude Code)", ...p },
    shell: SHELL, checkEnv: { ...CHECK_ENV, HOME: TMP } }));
  const m = createRunManager({ platform: "darwin", arch: "arm64", root, gitPath: () => GIT, launch: () => LAUNCH, nodePath: () => NODE, stopGraceMs: 2000,
    agents: async () => { throw new Error("not used"); }, native: testNativeRuntime(file, () => LAUNCH), leadSandbox: false, journalV2: true,
    workspaceOpen: () => true, workspaceKnown: (id) => id === WS, ...(afterExportTmp ? { afterExportTmp } : {}) });
  return Object.assign(m, { root, state });
}
function project() {
  const dir = path.join(TMP, `project-${++n}`);
  const bare = path.join(TMP, `remote-${n}.git`);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "a.txt"), "1\n");
  fs.writeFileSync(path.join(dir, "keep.txt"), "keep\n");
  for (const a of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) g(dir, ...a);
  g(TMP, "init", "-q", "--bare", bare);
  g(bare, "config", "receive.advertisePushOptions", "true");
  g(dir, "remote", "add", "upstream", bare);
  g(dir, "push", "-q", "upstream", "main:stable");
  g(dir, "fetch", "-q", "upstream");
  return { dir, bare };
}
const bounds = { position: { x: 0, y: 0 }, size: { width: 280, height: 160 } };
async function linkOn(m, src) {
  const lead = (await m.createAgent({ agentId: randomUUID(), provider: "codex", project: src, bounds })).value.agentId;
  const exec = (await m.createAgent({ agentId: randomUUID(), provider: "claude", project: src, bounds })).value.agentId;
  return (await m.createLink({ linkId: randomUUID(), fromAgentId: lead, toAgentId: exec })).value.linkId;
}
const task = (over = {}) => ({ id: randomUUID(), key: `T-${++n}`, workspaceId: WS, project: "/p", title: "t", text: "x", criteria: ["c"],
  dependsOn: [], order: n, createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z", archivedAt: null, accepted: null, ...over });
const boardFile = (root, tasks) => { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, "board.json"), JSON.stringify({ v: 1, tasks, counters: { [WS]: 99 } })); };
const goalOf = (root, runId) => {
  const first = JSON.parse(fs.readFileSync(path.join(root, "runs", runId, "journal.jsonl"), "utf8").split("\n")[0]);
  return JSON.parse(fs.readFileSync(path.join(root, "runs", runId, "texts", first.data.goal.sha256), "utf8"));
};
const until = async (fn, what, ms = 120_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`timed out waiting for ${what}`);
};
const ended = (m, runId) => until(async () => { const v = (await m.get(runId)).value?.view; return v && ["completed", "paused", "failed", "stopped"].includes(v.status) ? v : null; }, `run ${runId} to end`);
const apOff = (m, linkId, ms) => until(async () => { const s = (await m.board()).value.autopilot[linkId]; return s && !s.on ? s : null; }, "the autopilot to stop", ms);
const remoteBase = (dir) => ({ base: { branch: "upstream/stable", commit: g(dir, "rev-parse", "refs/remotes/upstream/stable").trim(), key: "remote" } });
const autoGoal = (t, over = {}) => ({ text: t.text, criteria: t.criteria, checks: [], commands: ["test -f keep.txt"], mode: "autopilot", reviewPlan: false, workMode: "worktree",
  task: { id: t.id, key: t.key }, finish: { commit: true, push: false, qa: false }, ...over });
const exportDir = (root, runId) => path.join(root, "runs", runId, "export");
const readExport = (root, runId) => JSON.parse(fs.readFileSync(path.join(exportDir(root, runId), "review.json"), "utf8"));
const status = (cwd) => g(cwd, "status", "--porcelain", "--untracked-files=all");
const EXPORT_PROFILE = (over = {}) => PROFILE({ checks: ["test -f keep.txt"], branchTemplate: "{issue}-{ref}", runBase: { remote: "upstream", branch: "stable" }, reviewExport: true, ...over });
const lines = (m, f) => (fs.existsSync(path.join(m.state, f)) ? fs.readFileSync(path.join(m.state, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

// ---------------- the manager: the review export ----------------

test("the autopilot's run at a remote base with push and reviewExport: review.json and review.md outside the tree, by the schema, from their sources; git status the same before and after; the view's paths", OPTS, async () => {
  const { dir, bare } = project();
  const t1 = task({ project: dir, ref: "T1", issue: "ISSUE-1", commitTitle: "feat: one", title: "Первая задача", text: "write x", criteria: ["x.txt says done"], scope: ["docs/**", "x.txt"] });
  const root = path.join(TMP, `root-${++n}`);
  boardFile(root, [t1]);
  // the first manager crashes between «completed» and the files: nothing is written then
  let m = manager(scripts(turns("x.txt")), { root, afterExportTmp: () => { throw new Error("crash after the temporary folder"); } });
  const linkId = await linkOn(m, dir);
  const saved = await m.saveProfile(linkId, { ...EXPORT_PROFILE({ runPush: { enabled: true, remote: "upstream", options: ["merge_request.create"], protected: [] } }), confirmPush: true });
  assert.ok(saved.ok, JSON.stringify(saved));
  assert.equal((await m.boardBudget(linkId, { ...AUTOPILOT_BUDGET, parallel: 1 })).ok, true);
  assert.ok((await m.boardAutopilot(linkId, true, "ru")).ok);
  const end = await apOff(m, linkId, 240_000);
  assert.equal(end.stop.code, "all_done", JSON.stringify(end));
  const runId = (await m.board()).value.facts[0].runId;
  assert.equal(goalOf(root, runId).export, true, "main put goal.export in");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fs.existsSync(exportDir(root, runId)), false, "the crash left no export/");
  assert.deepEqual(fs.readdirSync(path.join(root, "runs", runId)).filter((x) => x.startsWith("export")), [], "and no temporary folder");
  const worktree = (await m.get(runId)).value.view.workDir;
  const before = [status(worktree), status(dir)];
  await m.shutdown();
  // the application's start writes it
  m = manager(scripts(), { root });
  assert.deepEqual((await m.reviewExports()).value, [runId]);
  assert.deepEqual([status(worktree), status(dir)], before, "git status in the worktree and the project: the same");
  assert.equal(path.relative(dir, exportDir(root, runId)).startsWith(".."), true, "outside the project");
  const r = readExport(root, runId);
  assert.ok(validReview(r), JSON.stringify(validReview.errors));
  const commit = g(dir, "rev-parse", "ISSUE-1-T1").trim();
  const goal = goalOf(root, runId);
  assert.deepEqual([r.run, r.task, r.commit, r.tree, r.checkedTree], [runId, { key: t1.key, ref: "T1", title: "Первая задача", issue: "ISSUE-1" }, commit, g(dir, "rev-parse", `${commit}^{tree}`).trim(), g(dir, "rev-parse", `${commit}^{tree}`).trim()]);
  assert.deepEqual([r.base, r.branch, r.scope], [{ branch: "upstream/stable", commit: goal.base.commit }, "ISSUE-1-T1", ["docs/**", "x.txt"]]);
  assert.equal(g(bare, "rev-parse", "refs/heads/ISSUE-1-T1").trim(), commit, "the push the export names reached the remote");
  assert.deepEqual([r.push.remote, r.push.result], ["upstream", "confirmed"]);
  assert.match(r.push.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.deepEqual([r.lead.provider, r.executor.provider, r.reviewer?.provider ?? null], ["codex", "claude", "codex"]);
  assert.deepEqual([r.lead.cliVersionAtExport, r.lead.cliVersionRaw, r.executor.cliVersionAtExport], ["0.155.1", "codex-cli 0.155.1", "2.1.281"]);
  assert.deepEqual([r.conditions.map((c) => c.id), r.findings, r.openBlocking], [["C1"], [], 0]);
  const md = fs.readFileSync(path.join(exportDir(root, runId), "review.md"), "utf8");
  assert.match(md, /ISSUE-1-T1/);
  assert.match(md, /No findings\./);
  // the view names the paths; again — nothing written
  const v = (await m.get(runId)).value.view;
  assert.deepEqual(v.export, { json: path.join(exportDir(root, runId), "review.json"), md: path.join(exportDir(root, runId), "review.md") });
  const mtime = fs.statSync(path.join(exportDir(root, runId), "review.json")).mtimeMs;
  assert.deepEqual([(await m.writeReviewExport(runId)).value, (await m.reviewExports()).value], [false, []]);
  assert.equal(fs.statSync(path.join(exportDir(root, runId), "review.json")).mtimeMs, mtime);
  await m.shutdown();
});

test("the push's outcome first unknown, then established by ls-remote: push confirmed in the export; runBase without a template — the branch canvastty/<run8> (goal.branch)", OPTS, async () => {
  const { dir, bare } = project();
  const t1 = task({ project: dir, ref: "T1", issue: "ISSUE-1", commitTitle: "feat: one", text: "write x", criteria: ["x.txt says done"] });
  const root = path.join(TMP, `root-${++n}`);
  boardFile(root, [t1]);
  const m = manager(scripts(turns("x.txt")), { root });
  const linkId = await linkOn(m, dir);
  const saved = await m.saveProfile(linkId, { ...EXPORT_PROFILE({ branchTemplate: undefined, runPush: { enabled: true, remote: "upstream", options: [], protected: [] } }), confirmPush: true });
  assert.ok(saved.ok, JSON.stringify(saved));
  const [push0, ls0] = [shellLines(/git push /), shellLines(/git ls-remote /)];
  fs.writeFileSync(path.join(FLAGS, "lsfail"), "");
  try {
    assert.equal((await m.boardBudget(linkId, { ...AUTOPILOT_BUDGET, parallel: 1 })).ok, true);
    assert.ok((await m.boardAutopilot(linkId, true, "ru")).ok);
    assert.equal((await apOff(m, linkId, 240_000)).stop.code, "run_paused");
  } finally { fs.rmSync(path.join(FLAGS, "lsfail"), { force: true }); }
  const runId = (await m.board()).value.facts[0].runId;
  assert.equal((await m.get(runId)).value.view.reason, "finish_unconfirmed");
  assert.deepEqual([(await m.get(runId)).value.view.export, fs.existsSync(exportDir(root, runId))], [null, false], "paused: no export yet");
  await m.command(runId, { commandId: randomUUID(), expectedRevision: (await m.get(runId)).value.view.revision, command: { kind: "resume" } });
  assert.equal((await ended(m, runId)).status, "completed");
  await until(() => fs.existsSync(path.join(exportDir(root, runId), "review.json")), "the export", 10_000);
  const r = readExport(root, runId);
  assert.ok(validReview(r), JSON.stringify(validReview.errors));
  const branch = `canvastty/${runId.slice(0, 8)}`;
  assert.deepEqual([goalOf(root, runId).branch, r.branch], [branch, branch]);
  assert.deepEqual([r.push?.remote, r.push?.result], ["upstream", "confirmed"]);
  assert.equal(g(bare, "rev-parse", `refs/heads/${branch}`).trim(), r.commit);
  assert.deepEqual([shellLines(/git push /) - push0, shellLines(/git ls-remote /) - ls0], [1, 2], "pushed once; established by ls-remote");
  await m.shutdown();
});

test("each completed run of a task its own export; a run with nothing to commit — none (the view says so); a goal without export — none; the CLI not answering — both versions null, the export written; an archived task keeps its title and issue, a removed one has null", OPTS, async () => {
  const { dir } = project();
  const t1 = task({ project: dir, ref: "T1", issue: "ISSUE-1", commitTitle: "feat: one", title: "Задача один", text: "write x", criteria: ["x.txt says done"] });
  const t2 = task({ project: dir, ref: "T2", issue: "ISSUE-2", title: "Задача два", text: "look", criteria: ["nothing to do"] });
  const root = path.join(TMP, `root-${++n}`);
  boardFile(root, [t1, t2]);
  let m = manager(scripts(turns("x.txt"), turns("y.txt"), nothing()), { root });
  const linkId = await linkOn(m, dir);
  assert.ok((await m.saveProfile(linkId, EXPORT_PROFILE())).ok);
  const start = async (t) => {
    const runId = randomUUID();
    const r = await m.create({ requestId: runId, source: dir, goal: autoGoal(t, remoteBase(dir)) });
    assert.ok(r.ok, JSON.stringify(r));
    const v = await ended(m, runId);
    assert.equal(v.status, "completed", JSON.stringify([v.status, v.reason]));
    await until(() => fs.existsSync(exportDir(root, runId)) || v.export === null, "the export written", 10_000).catch(() => {});
    return runId;
  };
  const a = await start(t1);
  const b = await start(t1);
  assert.deepEqual([readExport(root, a).branch, readExport(root, b).branch], ["ISSUE-1-T1", "ISSUE-1-T1-2"], "two runs, two exports");
  assert.deepEqual([readExport(root, a).run, readExport(root, b).run, readExport(root, a).push], [a, b, null]);
  const c = await start(t2);
  const vc = (await m.get(c)).value.view;
  assert.deepEqual([vc.export, fs.existsSync(exportDir(root, c))], [null, false], "nothing to commit: no export, the panel says so");
  const fc = vc.progress.finish.find((f) => f.step === "commit");
  assert.deepEqual([fc.asked, fc.status, fc.commit], [true, "done", null], "what the panel reads: the commit step done with commit null");
  await m.shutdown();
  // a goal without export (the profile without the key): none
  fs.rmSync(exportDir(root, b), { recursive: true });
  fs.writeFileSync(path.join(FLAGS, "version-hang"), "");
  try {
    m = manager(scripts(), { root });
    // the board: t1 archived, then removed (by hand: a task with runs is never removed by the window)
    const st = JSON.parse(fs.readFileSync(path.join(root, "board.json"), "utf8"));
    st.tasks = st.tasks.map((t) => (t.id === t1.id ? { ...t, archivedAt: "2026-10-22T12:00:00.000Z" } : t));
    fs.writeFileSync(path.join(root, "board.json"), JSON.stringify(st));
    const t0 = Date.now();
    assert.deepEqual((await m.reviewExports()).value, [b]);
    assert.ok(Date.now() - t0 < 25_000, "the CLI's 5 s, not its 30");
    const rb = readExport(root, b);
    assert.ok(validReview(rb), JSON.stringify(validReview.errors));
    assert.deepEqual([rb.task.title, rb.task.issue], ["Задача один", "ISSUE-1"], "archived: from the board");
    assert.deepEqual([rb.executor.cliVersionAtExport, rb.executor.cliVersionRaw, rb.lead.cliVersionRaw], [null, null, null], "the CLI did not answer in 5 s");
    await m.shutdown();
    fs.rmSync(exportDir(root, b), { recursive: true });
    st.tasks = st.tasks.filter((t) => t.id !== t1.id);
    fs.writeFileSync(path.join(root, "board.json"), JSON.stringify(st));
    m = manager(scripts(), { root });
    assert.deepEqual((await m.reviewExports()).value, [b]);
    assert.deepEqual(readExport(root, b).task, { key: t1.key, ref: "T1", title: null, issue: null }, "removed: ref from the goal, title and issue null");
    await m.shutdown();
  } finally { fs.rmSync(path.join(FLAGS, "version-hang"), { force: true }); }
});

test("no export for a goal without export, a stopped run or a failed one; reviewExport in copy — work_mode_not_worktree, without runBase — review_export_needs_base (saveProfile)", OPTS, async () => {
  const { dir } = project();
  const t1 = task({ project: dir, ref: "T1", issue: "ISSUE-1", text: "write x", criteria: ["x.txt says done"] });
  const root = path.join(TMP, `root-${++n}`);
  boardFile(root, [t1]);
  const m = manager(scripts(turns("x.txt"), turns("x.txt").slice(0, 1)), { root });
  const linkId = await linkOn(m, dir);
  assert.equal((await m.saveProfile(linkId, EXPORT_PROFILE({ runBase: undefined }))).code, "review_export_needs_base");
  assert.equal((await m.saveProfile(linkId, EXPORT_PROFILE({ workMode: "copy", runBase: undefined, branchTemplate: undefined }))).code, "work_mode_not_worktree");
  assert.equal((await m.saveProfile(linkId, EXPORT_PROFILE({ finish: { commit: false, push: null, qa: null } }))).code, "review_export_needs_commit");
  // the profile without reviewExport: the goal has no export, nothing is written
  assert.ok((await m.saveProfile(linkId, EXPORT_PROFILE({ reviewExport: undefined }))).ok);
  const a = randomUUID();
  assert.ok((await m.create({ requestId: a, source: dir, goal: autoGoal(t1, remoteBase(dir)) })).ok);
  assert.equal((await ended(m, a)).status, "completed");
  assert.deepEqual(["export" in goalOf(root, a), (await m.get(a)).value.view.export, (await m.writeReviewExport(a)).value, fs.existsSync(exportDir(root, a))], [false, undefined, false, false]);
  // a stopped run with goal.export: none
  assert.ok((await m.saveProfile(linkId, EXPORT_PROFILE())).ok);
  const b = randomUUID();
  assert.ok((await m.create({ requestId: b, source: dir, goal: autoGoal(t1, { ...remoteBase(dir), reviewPlan: true }) })).ok);
  await until(async () => (await m.get(b)).value.view.status === "paused", "the plan shown");
  const v = (await m.get(b)).value.view;
  await m.command(b, { commandId: randomUUID(), expectedRevision: v.revision, command: { kind: "stop" } });
  assert.equal((await ended(m, b)).status, "stopped");
  assert.equal(goalOf(root, b).export, true);
  assert.deepEqual([(await m.get(b)).value.view.export, (await m.writeReviewExport(b)).value, fs.existsSync(exportDir(root, b))], [null, false, false]);
  await m.shutdown();
});

test("the window cannot send export or noMcp: parseGoal refuses them; a direct caller's are dropped (the profile decides)", OPTS, async () => {
  const { dir } = project();
  const t1 = task({ project: dir, ref: "T1", issue: "ISSUE-1" });
  const root = path.join(TMP, `root-${++n}`);
  boardFile(root, [t1]);
  const m = manager(scripts(turns("x.txt").slice(0, 1)), { root });
  const linkId = await linkOn(m, dir);
  assert.ok((await m.saveProfile(linkId, PROFILE({ checks: ["test -f keep.txt"] }))).ok);
  const { registerOrchestrationIpc } = await import("../src/main/ipc/orchestrationIpc.ts");
  const { IPC } = await import("../src/shared/contracts.ts");
  const handlers = new Map();
  registerOrchestrationIpc((channel, listener) => handlers.set(channel, listener), m);
  const frame = { id: "frame" };
  const sender = { id: 1, mainFrame: frame, isDestroyed: () => false, send() {}, on() {}, once() {}, removeListener() {} };
  for (const extra of [{ export: true }, { noMcp: true }]) {
    const r = await handlers.get(IPC.orchestrationLinkStart)({ sender, senderFrame: frame }, { linkId, requestId: randomUUID(), goal: autoGoal(t1, { reviewPlan: true, ...extra }) }).catch((e) => ({ code: e.code ?? String(e) }));
    assert.equal(r.code ?? r.ok, "invalid_argument", JSON.stringify(r));
  }
  const id = randomUUID();
  assert.ok((await m.create({ requestId: id, source: dir, goal: { ...autoGoal(t1, { reviewPlan: true }), export: true, noMcp: true } })).ok);
  const goal = goalOf(root, id);
  assert.deepEqual(["export" in goal, "noMcp" in goal], [false, false]);
  await ended(m, id);
  await m.shutdown();
});

// ---------------- T-14: the runs without MCP ----------------

test("buildNativeTurn: noMcp — Claude with --strict-mcp-config and no --mcp-config; without it — as before; Codex's argv the same either way", () => {
  const cli = (provider, executable) => ({ state: "available", provider, executable, launcher: "native", environment: { PATH: "/usr/bin" }, checked: [] });
  const base = { cwd: TMP, env: {}, task: "t", schema: { type: "object" }, ask: async () => ({ decision: "deny" }), clientVersion: "test" };
  const claude = (noMcp) => buildNativeTurn({ ...base, cli: cli("claude", CLAUDE), cliVersion: "2.1.281 (Claude Code)", session: { kind: "new" }, ...(noMcp ? { noMcp: true } : {}) });
  const on = claude(true), off = claude(false);
  assert.ok(on.ok && off.ok);
  assert.equal(on.spec.argv.includes("--strict-mcp-config"), true);
  assert.equal(on.spec.argv.some((a) => a.startsWith("--mcp-config")), false);
  assert.equal(off.spec.argv.includes("--strict-mcp-config"), false);
  assert.ok(on.mcp && !off.mcp);
  const codex = (noMcp) => buildNativeTurn({ ...base, cli: cli("codex", CODEX), cliVersion: "codex-cli 0.155.1", session: { kind: "new" }, ...(noMcp ? { noMcp: true } : {}) });
  assert.deepEqual(codex(true).spec.argv, codex(false).spec.argv);
});

// a driver over a fake io: what it sent, and the answers fed back as frames
function driven(make) {
  const sent = [];
  let ended = false;
  const driver = make();
  driver.start({ send: (m) => sent.push(m), end: () => { ended = true; }, hold() {} });
  const feed = (type, value) => driver.frame({ kind: "event", type, value, bytes: 0 });
  const last = (method) => sent.filter((m) => m.method === method).at(-1);
  const answer = (method, result) => feed("rpc.response", { id: last(method).id, result });
  return { sent, feed, last, answer, ended: () => ended, driver };
}
const tick = () => new Promise((r) => setTimeout(r, 5));
const codexDriver = (guard, extra = {}) => driven(() => codexAppServerDriver({ cwd: TMP, task: "t", schema: {}, threadId: null, clientVersion: "test", ask: async () => ({ decision: "deny" }),
  trustCwd: true, noMcp: guard, mcpMs: 300, ...extra }));
async function threadUp(d, method = "thread/start") {
  d.answer("initialize", {});
  d.answer(method, { thread: { id: "thr-1" } });
  await tick();
}

test("Codex without MCP: thread/start's config only the folder's trust, no MCP key; the list asked in the thread, every page; a named server (runtimeStatus disabled too) — mcp_present with its names, no turn; a whole empty list — the turn", async () => {
  // named servers, on two pages
  let guard = { block: null };
  let d = codexDriver(guard);
  await threadUp(d);
  assert.deepEqual(d.last("thread/start").params.config, { projects: { [TMP]: { trust_level: "trusted" } } }, "no MCP config");
  assert.deepEqual(d.last("mcpServerStatus/list").params, { threadId: "thr-1" });
  d.answer("mcpServerStatus/list", { data: [{ name: "a", runtimeStatus: "disabled" }], nextCursor: "c1" });
  await tick();
  assert.deepEqual(d.last("mcpServerStatus/list").params, { threadId: "thr-1", cursor: "c1" });
  d.answer("mcpServerStatus/list", { data: [{ name: "b", runtimeStatus: "ready" }], nextCursor: null });
  await tick();
  assert.deepEqual(guard.block, { code: "mcp_present", cli: "codex", names: ["a", "b"], detail: null });
  assert.deepEqual([d.last("turn/start"), d.ended()], [undefined, true]);
  // an empty whole list: the turn goes; thread/resume carries no MCP key either
  guard = { block: null };
  d = driven(() => codexAppServerDriver({ cwd: TMP, task: "t", schema: {}, threadId: "thr-9", clientVersion: "test", ask: async () => ({ decision: "deny" }), noMcp: guard, mcpMs: 300 }));
  await threadUp(d, "thread/resume");
  assert.equal("config" in d.last("thread/resume").params, false);
  d.answer("mcpServerStatus/list", { data: [] });
  await tick();
  assert.deepEqual([guard.block, !!d.last("turn/start"), d.ended()], [null, true, false]);
  // without noMcp: no list, the turn at once (as before)
  d = driven(() => codexAppServerDriver({ cwd: TMP, task: "t", schema: {}, threadId: null, clientVersion: "test", ask: async () => ({ decision: "deny" }) }));
  await threadUp(d);
  assert.deepEqual([d.last("mcpServerStatus/list"), !!d.last("turn/start")], [undefined, true]);
});

test("Codex without MCP is closed on failure: no answer in time, an error, no list, a repeating cursor, a second page that fails — mcp_unchecked, no turn", async () => {
  const cases = {
    "no answer": async () => {},
    "an error": async (d) => d.feed("rpc.response", { id: d.last("mcpServerStatus/list").id, error: { message: "boom" } }),
    "no list": async (d) => d.answer("mcpServerStatus/list", {}),
    "a repeating cursor": async (d) => {
      d.answer("mcpServerStatus/list", { data: [], nextCursor: "c" });
      await tick();
      d.answer("mcpServerStatus/list", { data: [], nextCursor: "c" });
    },
    "a failed second page": async (d) => {
      d.answer("mcpServerStatus/list", { data: [], nextCursor: "c" });
      await tick();
      d.feed("rpc.response", { id: d.last("mcpServerStatus/list").id, error: { message: "page 2" } });
    }
  };
  for (const [what, act] of Object.entries(cases)) {
    const guard = { block: null };
    const d = codexDriver(guard);
    await threadUp(d);
    await act(d);
    await until(async () => d.ended() || null, what, 3000);
    assert.equal(guard.block?.code, "mcp_unchecked", what);
    assert.equal(d.last("turn/start"), undefined, what);
  }
});

test("Claude without MCP: an init naming servers — mcp_present (the driver ends the turn); an empty list — the turn goes on; without noMcp the init is not read", () => {
  const make = (guard) => driven(() => claudeHostDriver({ task: "t", ask: async () => ({ decision: "deny" }), ...(guard ? { noMcp: guard } : {}) }));
  let guard = { block: null };
  let d = make(guard);
  assert.throws(() => d.feed("system", { subtype: "init", session_id: "s", mcp_servers: [{ name: "srv", status: "connected" }] }), /mcp_present/);
  assert.deepEqual(guard.block, { code: "mcp_present", cli: "claude", names: ["srv"], detail: null });
  guard = { block: null };
  d = make(guard);
  d.feed("system", { subtype: "init", session_id: "s", mcp_servers: [] });
  assert.equal(guard.block, null);
  d = make(null);
  d.feed("system", { subtype: "init", session_id: "s", mcp_servers: [{ name: "srv" }] });
});

test("the pause of a run without MCP: needs_user_action, not a new reason; the panel's words name the CLI and its servers", () => {
  assert.equal(PAUSED_REASONS_V2.some((r) => r.startsWith("mcp")), false);
  const entries = [{ turnId: "t1", kind: "turn_finished", text: "protocol_error", detail: {} },
    { turnId: "t1", kind: "error", text: "mcp_present: …", detail: { mcp: "mcp_present", cli: "codex", names: "a, b" } }];
  const cause = pauseCause("needs_user_action", "t1", entries);
  assert.deepEqual(cause, { kind: "mcp", reason: "needs_user_action", code: "mcp_present", cli: "codex", names: "a, b" });
  assert.equal(causeText("ru", cause), "У Codex включены MCP-серверы: a, b; выключите их в своём конфиге Codex и нажмите «Продолжить»");
  assert.match(causeText("en", { ...cause, code: "mcp_unchecked" }), /MCP servers of Codex could not be checked \(no answer/);
  // the readiness item's words (OrchestrationDialogs readinessLine: mcp_warning by its facts)
  const dialogs = fs.readFileSync(path.join(HERE, "..", "src", "renderer", "src", "features", "orchestration", "OrchestrationDialogs.tsx"), "utf8");
  assert.match(dialogs, /case "mcp_warning": return f\.unchecked === true \? t\(locale, "orchError_mcp_warning_unchecked"\) : t\(locale, "orchError_mcp_warning"\)\.replace\("\{names\}"/);
});

test("a run without MCP on the fake CLIs: Claude gets --strict-mcp-config, Codex is asked in its thread; a named Codex server — paused needs_user_action/mcp_present; Claude's init naming one — the same; none — completed; readiness warns", OPTS, async () => {
  const { dir } = project();
  const run = async (env, script) => {
    const m = manager(script, { env });
    const linkId = await linkOn(m, dir);
    assert.ok((await m.saveProfile(linkId, PROFILE({ checks: ["test -f keep.txt"], runMcp: false }))).ok);
    const runId = randomUUID();
    assert.ok((await m.startOnLink({ linkId, requestId: runId, goal: { text: "write x", criteria: ["x.txt says done"], checks: [], commands: ["test -f keep.txt"], mode: "autopilot", reviewPlan: false, workMode: "worktree" } })).ok);
    const v = await ended(m, runId);
    return { m, linkId, runId, v, goal: goalOf(m.root, runId) };
  };
  // none named: completed; Claude with --strict-mcp-config; Codex's list with the thread's id; its thread's config has no MCP key
  let r = await run({ MOCK_CODEX_MCP: "" }, scripts(turns("x.txt")));
  assert.equal(r.v.status, "completed", JSON.stringify([r.v.status, r.v.reason]));
  assert.equal(r.goal.noMcp, true);
  assert.ok(lines(r.m, "claude-argv.jsonl").every((a) => a.includes("--strict-mcp-config") && !a.includes("--mcp-config")));
  const asked = lines(r.m, "codex-mcp.jsonl");
  assert.ok(asked.length >= 2 && asked.every((p) => typeof p.threadId === "string" && p.threadId), JSON.stringify(asked));
  assert.ok(lines(r.m, "codex-thread-config.jsonl").every((x) => x.config === null || JSON.stringify(Object.keys(x.config)) === '["projects"]'));
  await r.m.shutdown();
  // a named Codex server (runtimeStatus disabled): the lead's turn does not go — needs_user_action, mcp_present with the names
  r = await run({ MOCK_CODEX_MCP: "alpha,beta" }, scripts(turns("x.txt")));
  assert.deepEqual([r.v.status, r.v.reason], ["paused", "needs_user_action"]);
  let feed = (await r.m.activity(r.runId, 0, 500)).value.entries;
  assert.ok(feed.some((e) => e.kind === "error" && e.detail?.mcp === "mcp_present" && e.detail.names === "alpha, beta" && /alpha, beta/.test(e.text)), JSON.stringify(feed.slice(-4)));
  assert.equal(lines(r.m, "codex-thread.jsonl").length, 1);
  assert.equal(fs.readdirSync(r.m.state).filter((f) => /^[0-9a-f-]{36}\.json$/.test(f)).length, 0, "no model turn");
  // readiness: the same rule before the start — a warning naming them
  const ready = (await r.m.readiness({ linkId: r.linkId, commands: ["test -f keep.txt"], workMode: "worktree" })).value;
  const item = ready.items.find((i) => i.id === "mcp_warning");
  assert.deepEqual([item?.level, item?.facts], ["warning", { names: "alpha, beta" }]);
  await r.m.shutdown();
  // no list: mcp_unchecked; Claude's init naming a server: mcp_present of Claude
  r = await run({ MOCK_CODEX_MCP: "no_data" }, scripts(turns("x.txt")));
  assert.deepEqual([r.v.status, r.v.reason], ["paused", "needs_user_action"]);
  feed = (await r.m.activity(r.runId, 0, 500)).value.entries;
  assert.ok(feed.some((e) => e.detail?.mcp === "mcp_unchecked"));
  const unchecked = (await r.m.readiness({ linkId: r.linkId, commands: ["test -f keep.txt"], workMode: "worktree" })).value.items.find((i) => i.id === "mcp_warning");
  assert.deepEqual(unchecked?.facts, { unchecked: true });
  await r.m.shutdown();
  r = await run({ MOCK_CODEX_MCP: "", MOCK_CLAUDE_MCP: "gamma" }, scripts(turns("x.txt")));
  assert.deepEqual([r.v.status, r.v.reason], ["paused", "needs_user_action"]);
  feed = (await r.m.activity(r.runId, 0, 500)).value.entries;
  assert.ok(feed.some((e) => e.detail?.mcp === "mcp_present" && e.detail.cli === "claude" && e.detail.names === "gamma"));
  await r.m.shutdown();
});

test("readiness of a run without MCP whose Codex does not answer the list: «not checked» (after its 30 s); without runMcp no list is asked", { ...OPTS, timeout: 120_000 }, async () => {
  const { dir } = project();
  const m = manager(scripts(), { env: { MOCK_CODEX_MCP: "hang" } });
  const linkId = await linkOn(m, dir);
  assert.ok((await m.saveProfile(linkId, PROFILE({ checks: ["test -f keep.txt"] }))).ok);
  const plain = (await m.readiness({ linkId, commands: ["test -f keep.txt"], workMode: "worktree" })).value;
  assert.deepEqual([plain.items.some((i) => i.id === "mcp_warning"), lines(m, "codex-mcp.jsonl").length], [false, 0]);
  assert.ok((await m.saveProfile(linkId, PROFILE({ checks: ["test -f keep.txt"], runMcp: false }))).ok);
  const t0 = Date.now();
  const item = (await m.readiness({ linkId, commands: ["test -f keep.txt"], workMode: "worktree" })).value.items.find((i) => i.id === "mcp_warning");
  assert.deepEqual([item?.level, item?.facts], ["warning", { unchecked: true }]);
  assert.ok(Date.now() - t0 >= 29_000, "after the list's 30 s");
  await m.shutdown();
});

test("i18n (F4, T-9, T-14): the texts in both languages", () => {
  const keys = ["projReviewExport", "projReviewExportHint", "projRunMcp", "projRunMcpHint", "orchExportPaths", "orchExportCopy", "orchExportNone",
    "orchError_review_export_needs_base", "orchError_review_export_needs_commit", "orchError_mcp_present", "orchError_mcp_unchecked", "orchError_mcp_warning", "orchError_mcp_warning_unchecked"];
  for (const locale of ["ru", "en"]) for (const k of keys) assert.ok(words(locale, k), `${locale}: ${k}`);
  assert.equal(words("ru", "orchExportNone"), "Выгрузки нет: нечего было коммитить");
  assert.equal(words("en", "projRunMcp"), "Run without MCP");
});

// ---------------- review fixes: the exporter's catch-up, the manager's guards ----------------

test("catchUp: a run folder that is a symbolic link is not entered (its export.tmp-* stays), a foreign name is skipped, a temporary folder of a write going on is not removed", async () => {
  const root = path.join(TMP, `root-${++n}`);
  fs.mkdirSync(path.join(root, "runs"), { recursive: true });
  const other = path.join(TMP, `elsewhere-${++n}`);
  fs.mkdirSync(path.join(other, "export.tmp-x"), { recursive: true });
  fs.symlinkSync(other, path.join(root, "runs", randomUUID()));
  fs.mkdirSync(path.join(root, "runs", "not-a-run", "export.tmp-y"), { recursive: true });
  const live = randomUUID();
  fs.mkdirSync(path.join(root, "runs", live), { recursive: true });
  let release;
  const gate = new Promise((r) => { release = r; });
  let inside;
  const reached = new Promise((r) => { inside = r; });
  const ex = createReviewExporter({ root, source: async () => INPUT({ runId: live }), afterTmp: async () => { inside(); await gate; } });
  const writing = ex.write(live);
  await reached;
  assert.deepEqual(await ex.catchUp(), []);
  assert.deepEqual(fs.readdirSync(other), ["export.tmp-x"], "not followed");
  assert.deepEqual(fs.readdirSync(path.join(root, "runs", "not-a-run")), ["export.tmp-y"], "not a run");
  assert.equal(fs.readdirSync(path.join(root, "runs", live)).some((x) => x.startsWith("export.tmp-")), true, "the live write's folder stays");
  release();
  assert.equal(await writing, true);
  assert.deepEqual(fs.readdirSync(path.join(root, "runs", live)), ["export"]);
});

test("reviewExports and writeReviewExport are refused outside macOS arm64 (unsupported_platform), as the inbox is", () => {
  const m = createRunManager({ platform: "linux", arch: "x64", root: path.join(TMP, `root-${++n}`), gitPath: () => GIT, launch: () => LAUNCH, nodePath: () => NODE,
    agents: async () => { throw new Error("not used"); }, workspaceOpen: () => true, workspaceKnown: () => true });
  return Promise.all([m.reviewExports(), m.writeReviewExport(randomUUID())]).then(([a, b]) => {
    assert.deepEqual([a.code, b.code], ["unsupported_platform", "unsupported_platform"]);
  });
});

async function exportRun({ afterExportTmp, answers = turns("x.txt") } = {}) {
  const { dir } = project();
  const t1 = task({ project: dir, ref: "T1", issue: "ISSUE-1", commitTitle: "feat: one", title: "t", text: "write x", criteria: ["x.txt says done"] });
  const root = path.join(TMP, `root-${++n}`);
  boardFile(root, [t1]);
  const m = manager(scripts(answers), { root, afterExportTmp });
  const linkId = await linkOn(m, dir);
  assert.ok((await m.saveProfile(linkId, EXPORT_PROFILE())).ok);
  g(dir, "fetch", "-q", "upstream");
  const runId = randomUUID();
  const r = await m.create({ requestId: runId, source: dir, goal: autoGoal(t1, remoteBase(dir)) });
  assert.ok(r.ok, JSON.stringify(r));
  const end = await ended(m, runId);
  assert.equal(end.status, "completed", JSON.stringify(end).slice(0, 600));
  return { m, root, runId };
}

test("a journal v2 whose conditions cannot be read is not exported empty: nothing is written, the next ask writes it", OPTS, async () => {
  const { m, root, runId } = await exportRun();
  await until(() => fs.existsSync(exportDir(root, runId)), "the export written", 10_000);
  await m.shutdown();
  // the same run, its export removed and its texts (but the goal's) moved away: the conditions cannot be loaded
  fs.rmSync(exportDir(root, runId), { recursive: true });
  const texts = path.join(root, "runs", runId, "texts");
  const stash = path.join(TMP, `stash-${++n}`);
  fs.mkdirSync(stash);
  const first = JSON.parse(fs.readFileSync(path.join(root, "runs", runId, "journal.jsonl"), "utf8").split("\n")[0]);
  for (const f of fs.readdirSync(texts)) if (f !== first.data.goal.sha256) fs.renameSync(path.join(texts, f), path.join(stash, f));
  const again = manager(scripts(), { root });
  assert.deepEqual([(await again.writeReviewExport(runId)).value, fs.existsSync(exportDir(root, runId))], [false, false]);
  for (const f of fs.readdirSync(stash)) fs.renameSync(path.join(stash, f), path.join(texts, f));
  assert.deepEqual((await again.writeReviewExport(runId)).value, true);
  assert.deepEqual(readExport(root, runId).conditions.map((c) => c.id), ["C1"]);
  await again.shutdown();
});

test("a run reviewed by the lead with no findings is exported again with findings []: written, by the schema", OPTS, async () => {
  const { m, root, runId } = await exportRun();
  await until(() => fs.existsSync(exportDir(root, runId)), "the export written", 10_000);
  await m.shutdown();
  fs.rmSync(exportDir(root, runId), { recursive: true });
  const again = manager(scripts(), { root });
  assert.deepEqual((await again.writeReviewExport(runId)).value, true);
  const r = readExport(root, runId);
  assert.ok(validReview(r), JSON.stringify(validReview.errors));
  assert.deepEqual(r.findings, []);
  await again.shutdown();
});

test("a failed export write is asked again at the run's next change, no more than 3 times in all: the handle's flag is not kept for good", OPTS, async () => {
  let calls = 0;
  const { m, root, runId } = await exportRun({ afterExportTmp: () => { calls++; throw new Error("crash"); } });
  await until(() => calls >= 1, "the first ask", 10_000);
  const change = async () => {
    const before = (await m.get(runId)).value.seq;
    const r = await m.command(runId, { commandId: randomUUID(), expectedRevision: (await m.get(runId)).value.view.revision, command: { kind: "dismiss" } });
    assert.ok(r.ok, JSON.stringify(r));
    await until(async () => (await m.get(runId)).value.seq > before, "the journal to change", 5000);
    await new Promise((res) => setTimeout(res, 300));
  };
  await change();
  assert.equal(calls, 2, "asked again after the failure");
  await change();
  await change();
  await change();
  assert.equal(calls, 3, "and no more than 3 times in all");
  assert.equal(fs.existsSync(exportDir(root, runId)), false);
  await m.shutdown();
});

// ---------------- review fixes: the MCP checks of the sessions ----------------

test("Codex without MCP: a thread without an id is closed at once (mcp_unchecked), no list is asked, no turn", async () => {
  const guard = { block: null };
  const d = codexDriver(guard);
  d.answer("initialize", {});
  d.answer("thread/start", { thread: {} });
  await tick();
  assert.equal(guard.block?.code, "mcp_unchecked");
  assert.deepEqual([d.last("mcpServerStatus/list"), d.last("turn/start"), d.ended()], [undefined, undefined, true]);
});

test("Claude without MCP: a turn that ended with no system/init at all is mcp_unchecked; with the init it is not", () => {
  const make = (guard) => driven(() => claudeHostDriver({ task: "t", ask: async () => ({ decision: "deny" }), noMcp: guard }));
  let guard = { block: null };
  let d = make(guard);
  assert.throws(() => d.feed("result", { subtype: "success", is_error: false }), /mcp_unchecked/);
  assert.equal(guard.block?.code, "mcp_unchecked");
  guard = { block: null };
  d = make(guard);
  d.feed("system", { subtype: "init", session_id: "s", mcp_servers: [] });
  d.feed("result", { subtype: "success", is_error: false });
  assert.deepEqual([guard.block, d.ended()], [null, true]);
});

test("Codex without MCP: the list request's timer is cleared when the session ends", async () => {
  const MS = 47_001;
  const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
  const made = new Set(), cleared = new Set();
  globalThis.setTimeout = (fn, ms, ...rest) => { const t = set(fn, ms, ...rest); if (ms > 40_000 && ms <= MS) made.add(t); return t; };
  globalThis.clearTimeout = (t) => { cleared.add(t); return clear(t); };
  try {
    const d = codexDriver({ block: null }, { mcpMs: MS });
    await threadUp(d);
    assert.equal(made.size, 1, "the list is asked, its timer runs");
    d.feed("turn/completed", {});
    assert.equal(d.ended(), true);
    assert.deepEqual([...made].filter((t) => !cleared.has(t)), [], "cleared at the end");
  } finally {
    globalThis.setTimeout = set;
    globalThis.clearTimeout = clear;
  }
});
