// F4, part 1 — T-8 (docs/agent-orchestration/implementation/stage-f-external-projects.md §4, §5.5, §7): the autopilot's push
// of a board task's run branch with the profile's push options (runPush) — the profile's rules and its confirmation, the
// reason push_option_field, the options filled at the start and frozen with the protected branches in the goal, each
// option its own `-o` (shq), a protected branch refused at the start and paused before the push, after an unknown outcome
// only ls-remote, the dialog's start keeping finish.push, the fingerprint. Neutral fixtures only (upstream/stable, T1,
// ISSUE-1), local repositories with a bare remote whose pre-receive hook writes the push options it got, fake CLIs: no
// model, no real Codex or Claude, no network.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { findGit } from "../src/main/services/orchestration/git.ts";
import { createBoardAutopilot, fingerprint, placeOptsOf } from "../src/main/services/orchestration/boardAutopilot.ts";
import { readTasksFile } from "../src/main/services/orchestration/boardImport.ts";
import { pushLine } from "../src/main/services/orchestration/finish.ts";
import { buildRecord, canonical, sha256Hex } from "../src/main/services/orchestration/journal.ts";
import { createRunManager, testNativeRuntime } from "../src/main/services/orchestration/manager.ts";
import { createProfileStore, fillOption, pushOptionFields, validateProfile } from "../src/main/services/orchestration/profile.ts";
import { assertMainRenderer } from "../src/main/ipc/mainRenderer.ts";
import { registerOrchestrationIpc } from "../src/main/ipc/orchestrationIpc.ts";
import { IPC } from "../src/shared/contracts.ts";
import { AUTOPILOT_BUDGET, autopilotParallelStep, boardOptsOf, boardStatuses, nextTask, placeKey } from "../src/shared/taskBoard.ts";
import { taskLine } from "../src/renderer/src/features/orchestration/boardModel.ts";
import { t as words } from "../src/renderer/src/lib/i18n.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GIT = findGit(process.env);
const NODE = fs.realpathSync(process.execPath);
const LAUNCH = { command: NODE, args: [path.join(HERE, "..", "src", "orchestration", "supervisor.mjs")], env: {} };
const OPTS = { skip: process.platform === "win32" && "orchestration runs on macOS and Linux", timeout: 300_000 };
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "raoden-f4-")));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
fs.writeFileSync(path.join(TMP, "gitconfig"), "[user]\n\tname = t\n\temail = t@t\n");
const GIT_ENV = { PATH: process.env.PATH, HOME: TMP, GIT_CONFIG_GLOBAL: path.join(TMP, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };
const g = (cwd, ...args) => execFileSync(GIT, args, { cwd, encoding: "utf8", env: GIT_ENV });
let n = 0;

const WS = "common";
const PLACE = { workspaceId: WS, project: "/p" };
const task = (over = {}) => ({ id: randomUUID(), key: `T-${++n}`, workspaceId: WS, project: "/p", title: "t", text: "x", criteria: ["c"],
  dependsOn: [], order: n, createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z", archivedAt: null, accepted: null, ...over });
const NONE = { runs: 0, ms: 0 };
const PROFILE = (over = {}) => ({ v: 1, workMode: "worktree", checks: ["true"], prepare: { steps: [], auto: true }, env: { direnv: true }, access: { claude: "workspace", codex: "workspace" },
  finish: { commit: true, push: null, qa: null }, grants: [], savedAt: null, ...over });
const RUN_PUSH = (over = {}) => ({ enabled: true, remote: "upstream", options: [], protected: [], ...over });
const code = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
const TITLE = `feat: "quoted" $HOME it's`; // quotes and $ reach the remote as one string

// ---------------- the profile, the line, the options ----------------

test("pushLine: each option its own -o through shq before the remote and the refspec; no options — the line as before", () => {
  const p = { remote: "upstream", branch: "ISSUE-1-T1", commit: "c".repeat(40) };
  assert.equal(pushLine(p), `git push 'upstream' '${"c".repeat(40)}:refs/heads/ISSUE-1-T1'`);
  assert.equal(pushLine({ ...p, options: [] }), pushLine(p));
  assert.equal(pushLine({ ...p, options: ["merge_request.create", `merge_request.title=${TITLE}`] }),
    `git push -o 'merge_request.create' -o 'merge_request.title=feat: "quoted" $HOME it'\\''s' 'upstream' '${"c".repeat(40)}:refs/heads/ISSUE-1-T1'`);
  assert.equal(fillOption("merge_request.title={commitTitle}", { commitTitle: TITLE, issue: "", ref: "", base: "" }), `merge_request.title=${TITLE}`);
  assert.equal(fillOption("t={base}/{issue}-{ref}", { commitTitle: "", issue: "ISSUE-1", ref: "T1", base: "stable" }), "t=stable/ISSUE-1-T1");
  assert.deepEqual(pushOptionFields(["a={issue}", "b={commitTitle}", "c={ref}"]), ["issue", "commitTitle"]);
  assert.deepEqual(pushOptionFields(["merge_request.create", "x={ref}-{base}"]), []);
});

test("validateProfile: runPush — its options' rules (push_option_invalid, push_option_forbidden, push_needs_base), push_needs_commit, the worktree only; none — no key", () => {
  const RB = { runBase: { remote: "upstream", branch: "stable", remoteUrl: "/r" } };
  const ok = validateProfile(PROFILE({ ...RB, runPush: RUN_PUSH({ options: ["merge_request.create", "merge_request.target={base}", "merge_request.title={commitTitle}"], protected: ["release"], remoteUrl: "/r", confirmedAt: "2026-10-22T00:00:00.000Z" }) }));
  assert.deepEqual(ok.runPush, { enabled: true, remote: "upstream", remoteUrl: "/r", options: ["merge_request.create", "merge_request.target={base}", "merge_request.title={commitTitle}"],
    protected: ["release"], confirmedAt: "2026-10-22T00:00:00.000Z" });
  assert.equal("runPush" in validateProfile(PROFILE()), false);
  assert.equal("runPush" in validateProfile(PROFILE({ runPush: null })), false);
  const rp = (over, p = {}) => code(() => validateProfile(PROFILE({ ...p, runPush: RUN_PUSH(over) })));
  assert.equal(rp({ options: ["a=one\ntwo"] }), "push_option_invalid", "a line break");
  assert.equal(rp({ options: ["-a"] }), "push_option_invalid", "a key with - first");
  assert.equal(rp({ options: ["a={foo}"] }), "push_option_invalid", "an unknown substitution");
  assert.equal(rp({ options: ["a b=c"] }), "push_option_invalid", "a space in the key");
  assert.equal(rp({ options: [`a=${"x".repeat(301)}`] }), "push_option_invalid", "a value over 300");
  assert.equal(rp({ options: Array.from({ length: 17 }, (_, i) => `k${i}`) }), "push_option_invalid", "over 16");
  for (const k of ["merge_request.merge_when_pipeline_succeeds", "merge_request.auto_merge", "ci.skip"]) assert.equal(rp({ options: [k] }), "push_option_forbidden", k);
  assert.equal(rp({ options: ["merge_request.target={base}"] }), "push_needs_base");
  assert.equal(rp({ options: ["merge_request.target={base}"] }, RB), null);
  assert.equal(rp({}, { finish: { commit: false, push: null, qa: null } }), "push_needs_commit");
  assert.equal(rp({}, { workMode: "copy" }), "work_mode_not_worktree");
  assert.equal(rp({}, { workMode: "project" }), "work_mode_not_worktree");
  assert.equal(rp({ protected: ["-x"] }), "invalid_profile");
  assert.equal(rp({ remote: "--upload-pack=x" }), "invalid_profile");
  // finish.push is as before
  assert.deepEqual(validateProfile(PROFILE({ finish: { commit: true, push: { remote: "upstream", branch: "qa" }, qa: null } })).finish.push, { remote: "upstream", branch: "qa", remoteUrl: null });
});

test("push_option_field: a task without the field the options need — the reason in boardStatuses (with its field), nextTask and next skip it (with dependencies too); the card names the field", () => {
  const fields = ["issue", "commitTitle"];
  const opts = { pushFields: new Map([[placeKey(PLACE), fields]]) };
  const full = task({ issue: "ISSUE-1", commitTitle: "feat: x" });
  const noTitle = task({ issue: "ISSUE-1" });
  const noIssue = task({ commitTitle: "feat: y" });
  const st = boardStatuses({ tasks: [full, noTitle, noIssue] }, [], [], opts);
  assert.deepEqual([full, noTitle, noIssue].map((t) => [st.get(t.id).reason, st.get(t.id).field ?? null]), [[null, null], ["push_option_field", "commitTitle"], ["push_option_field", "issue"]]);
  assert.equal(st.get(noTitle.id).depsWait, null);
  assert.equal(boardStatuses({ tasks: [noTitle] }, []).get(noTitle.id).reason, null, "without opts as before");
  assert.equal(nextTask({ tasks: [noTitle, full] }, st, PLACE, { pushFields: fields })?.id, full.id);
  // the step of a worktree at a remote base: the one with a dependency «Done» is skipped too
  const dep = task({ issue: "ISSUE-1", commitTitle: "feat: d", external: true, criteria: ["c"], externalDone: { at: "2026-10-22T10:00:00.000Z", by: "person", note: null } });
  const held = task({ issue: "ISSUE-1", dependsOn: [dep.id] }); // no commitTitle
  const step = (tasks) => autopilotParallelStep({ tasks }, [], PLACE, [], NONE, AUTOPILOT_BUDGET, null, new Set(), [], Date.now(), [], { remoteBase: true, pushFields: fields });
  assert.notEqual(step([dep, held]).kind, "start");
  const okHeld = { ...held, commitTitle: "feat: h" };
  assert.deepEqual([step([dep, okHeld]).kind, step([dep, okHeld]).task?.id], ["start", held.id]);
  for (const locale of ["ru", "en"]) {
    assert.match(taskLine(locale, st.get(noTitle.id), null, null), /commitTitle/);
    assert.match(taskLine(locale, st.get(noIssue.id), null, null), /issue/);
  }
});

test("the place options and the fingerprint: pushFields only while runPush is on; runPush in the fingerprint (absent: as before)", () => {
  assert.deepEqual(placeOptsOf({ runPush: RUN_PUSH({ options: ["t={commitTitle}", "i={issue}"] }) }), { pushFields: ["issue", "commitTitle"] });
  assert.deepEqual(placeOptsOf({ runPush: RUN_PUSH({ enabled: false, options: ["t={commitTitle}"] }) }), {});
  assert.deepEqual(placeOptsOf({ runPush: RUN_PUSH({ options: ["merge_request.create"] }) }), {});
  assert.deepEqual(Object.fromEntries(boardOptsOf({ pushFields: { [placeKey(PLACE)]: ["issue"] } }).pushFields), { [placeKey(PLACE)]: ["issue"] });
  assert.deepEqual(boardOptsOf({ pushFields: {} }), {});
  const p = { access: { claude: "workspace", codex: "workspace" }, workMode: "worktree", checks: ["true"], prepare: { steps: [], auto: true }, env: { direnv: true },
    finish: { commit: true, push: null, qa: null }, grants: [] };
  assert.equal(fingerprint(p), JSON.stringify({ access: p.access, workMode: p.workMode, models: null, finish: p.finish, checks: p.checks, prepare: p.prepare, env: p.env, grants: [] }));
  const on = { ...p, runPush: { ...RUN_PUSH(), remoteUrl: "/r", confirmedAt: null } };
  assert.notEqual(fingerprint(on), fingerprint(p));
  assert.notEqual(fingerprint({ ...on, runPush: { ...on.runPush, enabled: false } }), fingerprint(on));
  assert.notEqual(fingerprint({ ...on, runPush: { ...on.runPush, options: ["x"] } }), fingerprint(on));
});

test("controller: runPush.enabled changed while on → settings_changed before the next start", async () => {
  const t1 = task(), t2 = task();
  const starts = [];
  const base = { access: { claude: "workspace", codex: "workspace" }, workMode: "worktree", checks: ["true"], prepare: { steps: [], auto: true }, env: { direnv: true },
    finish: { commit: true, push: null, qa: null }, grants: [], runBase: { remote: "upstream", branch: "stable", remoteUrl: "/r" }, runPush: { ...RUN_PUSH({ enabled: false }), remoteUrl: "/r", confirmedAt: null } };
  let profile = base;
  const facts = [];
  const LINK = randomUUID();
  const ap = createBoardAutopilot({
    view: async () => ({ board: { v: 1, tasks: [t1, t2], counters: {} }, facts: [...facts] }),
    link: async () => PLACE, profile: async () => profile, optionalChecks: true, journal: async () => [],
    readiness: async () => ({ ok: true, value: { ready: true, items: [] } }),
    start: async ({ requestId, goal }) => {
      starts.push(goal);
      facts.push({ runId: requestId, taskId: goal.task.id, taskKey: goal.task.key, createdAt: ++n, workspaceId: WS, status: "completed", reason: null, newer: false, halted: false, limit: null,
        completion: "confirmed", phase: "work", permission: false, workMode: "worktree", taken: null });
      return { ok: true, value: { runId: requestId, created: true } };
    },
    take: async () => { throw new Error("no take"); }, head: async () => null, ensureHead: async () => { throw new Error("no head"); },
    merge: async () => { throw new Error("no merge"); }, newId: () => randomUUID(), now: () => Date.now(),
    remoteBase: async () => ({ ok: true, value: { branch: "upstream/stable", commit: "b".repeat(40), key: "remote" } })
  }, async () => ({ ...AUTOPILOT_BUDGET, parallel: 1 }), 3_600_000);
  await ap.set(LINK, true, "ru");
  await ap.tick(LINK);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].finish.push, false, "the autopilot's goal asks no push: main puts runPush's in");
  profile = { ...base, runPush: { ...base.runPush, enabled: true } };
  await ap.tick(LINK);
  const st = (await ap.state())[LINK];
  assert.deepEqual([st.on, st.stop?.code, starts.length], [false, "settings_changed", 1]);
  ap.shutdown();
});

// ---------------- the manager: fixtures ----------------

function wrapper(name, mock) {
  const file = path.join(TMP, name);
  fs.writeFileSync(file, `#!/bin/sh\nexec "${NODE}" "${path.join(HERE, "fixtures", "orchestration", mock)}" "$@"\n`, { mode: 0o755 });
  return file;
}
const CODEX = wrapper("codex", "mock-codex.mjs");
const CLAUDE = wrapper("claude", "mock-claude.mjs");
// the login shell: every line to its ledger; `git ls-remote` fails while <flags>/lsfail is there
function ledgerShell() {
  const dir = fs.mkdtempSync(path.join(TMP, "shell-"));
  const file = path.join(dir, "sh");
  fs.writeFileSync(file, `#!/bin/sh
case "$1" in -ilc|-c) shift ;; esac
printf '%s\\n' "$1" >> "${dir}/ledger"
case "$1" in "git ls-remote"*) [ -f "${dir}/lsfail" ] && exit 3 ;; esac
exec /bin/sh -c "$1"
`, { mode: 0o755 });
  const lines = () => (fs.existsSync(path.join(dir, "ledger")) ? fs.readFileSync(path.join(dir, "ledger"), "utf8").split("\n").filter(Boolean) : []);
  return { path: file, lines, count: (re) => lines().filter((l) => re.test(l)).length,
    set: (what, on = true) => (on ? fs.writeFileSync(path.join(dir, what), "") : fs.rmSync(path.join(dir, what), { force: true })) };
}
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
const PLAN_ONLY = turns("x.txt").slice(0, 1);
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
function manager(script, { root = path.join(TMP, `root-${++n}`), shell } = {}) {
  const file = path.join(TMP, `providers-${++n}.json`);
  const p = { path: `${TMP}:/usr/bin:/bin`, env: { HOME: TMP, MOCK_STATE: fs.mkdtempSync(path.join(TMP, "state-")), MOCK_SCRIPT: script, MOCK_SCRIPT_PER_CWD: "1" } };
  fs.writeFileSync(file, JSON.stringify({ codex: { executable: CODEX, version: "codex-cli 0.155.1", ...p }, claude: { executable: CLAUDE, version: "2.1.281 (Claude Code)", ...p },
    shell: shell ?? ledgerShell().path, checkEnv: { ...CHECK_ENV, HOME: TMP } }));
  const m = createRunManager({ platform: "darwin", arch: "arm64", root, gitPath: () => GIT, launch: () => LAUNCH, nodePath: () => NODE, stopGraceMs: 2000,
    agents: async () => { throw new Error("not used"); }, native: testNativeRuntime(file, () => LAUNCH), leadSandbox: false, journalV2: true,
    workspaceOpen: () => true, workspaceKnown: (id) => id === WS });
  return Object.assign(m, { root });
}
// a project on main with a bare remote «upstream» whose «stable» is main; the bare remote advertises push options and
// its pre-receive hook writes each one it got, one per line; <bare>/reject makes it refuse the push
function project() {
  const dir = path.join(TMP, `project-${++n}`);
  const bare = path.join(TMP, `remote-${n}.git`);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "a.txt"), "1\n");
  fs.writeFileSync(path.join(dir, "keep.txt"), "keep\n");
  for (const a of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) g(dir, ...a);
  g(TMP, "init", "-q", "--bare", bare);
  g(bare, "config", "receive.advertisePushOptions", "true");
  const got = path.join(TMP, `options-${n}.txt`);
  fs.writeFileSync(path.join(bare, "hooks", "pre-receive"), `#!/bin/sh
i=0
while [ "$i" -lt "\${GIT_PUSH_OPTION_COUNT:-0}" ]; do eval "printf '%s\\\\n' \\"\\$GIT_PUSH_OPTION_$i\\"" >> "${got}"; i=$((i+1)); done
cat > /dev/null
[ -f "${bare}/reject" ] && { echo "rejected by the fixture" >&2; exit 1; }
exit 0
`, { mode: 0o755 });
  g(dir, "remote", "add", "upstream", bare);
  g(dir, "push", "-q", "upstream", "main:stable");
  return { dir, bare, got: () => (fs.existsSync(got) ? fs.readFileSync(got, "utf8").split("\n").filter(Boolean) : []), reset: () => fs.rmSync(got, { force: true }) };
}
const bounds = { position: { x: 0, y: 0 }, size: { width: 280, height: 160 } };
async function linkOn(m, src) {
  const lead = (await m.createAgent({ agentId: randomUUID(), provider: "codex", project: src, bounds })).value.agentId;
  const exec = (await m.createAgent({ agentId: randomUUID(), provider: "claude", project: src, bounds })).value.agentId;
  return (await m.createLink({ linkId: randomUUID(), fromAgentId: lead, toAgentId: exec })).value.linkId;
}
const goalOf = (root, runId) => {
  const first = JSON.parse(fs.readFileSync(path.join(root, "runs", runId, "journal.jsonl"), "utf8").split("\n")[0]);
  return JSON.parse(fs.readFileSync(path.join(root, "runs", runId, "texts", first.data.goal.sha256), "utf8"));
};
// the goal of a run rewritten in its journal, every record rebuilt on the chain (as scripts/f-rollback-fixtures.mjs does)
function withGoal(root, runId, edit) {
  const rd = path.join(root, "runs", runId), j = path.join(rd, "journal.jsonl");
  const recs = fs.readFileSync(j, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const buf = Buffer.from(canonical(edit(goalOf(root, runId))), "utf8");
  const ref = { sha256: sha256Hex(buf), bytes: buf.length };
  fs.writeFileSync(path.join(rd, "texts", ref.sha256), buf);
  let prev = null, out = "";
  for (const r of recs) {
    const { v, seq, ts, runId: id, type, prevHash: _p, data, hash: _h, ...head } = r;
    const { record, line } = buildRecord(prev, id, ts, type, seq === 0 ? { ...data, goal: ref } : data, v, seq === 0 ? head : null);
    prev = { seq: record.seq, hash: record.hash };
    out += line.toString("utf8");
  }
  fs.writeFileSync(j, out);
}
const until = async (fn, what, ms = 120_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`timed out waiting for ${what}`);
};
const boardFile = (root, tasks) => { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, "board.json"), JSON.stringify({ v: 1, tasks, counters: { [WS]: 99 } })); };
const autoGoal = (t, over = {}) => ({ text: t.text, criteria: t.criteria, checks: [], commands: ["test -f keep.txt"], mode: "autopilot", reviewPlan: false, workMode: "worktree",
  task: { id: t.id, key: t.key }, finish: { commit: true, push: false, qa: false }, ...over });
const remoteRef = (dir) => ({ base: { branch: "upstream/stable", commit: g(dir, "rev-parse", "refs/remotes/upstream/stable").trim(), key: "remote" } });
const ended = (m, runId) => until(async () => { const v = (await m.get(runId)).value?.view; return v && ["completed", "paused", "failed", "stopped"].includes(v.status) ? v : null; }, `run ${runId} to end`);
const apOff = (m, linkId, ms) => until(async () => { const s = (await m.board()).value.autopilot[linkId]; return s && !s.on ? s : null; }, "the autopilot to stop", ms);
const resume = async (m, runId) => m.command(runId, { commandId: randomUUID(), expectedRevision: (await m.get(runId)).value.view.revision, command: { kind: "resume" } });
const remoteHead = (bare, b) => { try { return g(bare, "rev-parse", "--verify", "-q", `refs/heads/${b}`).trim(); } catch { return null; } };
function ipc(m) {
  const wc = Object.assign(new EventEmitter(), { id: 1, mainFrame: { id: "frame" }, isDestroyed: () => false, send() {} });
  const handlers = new Map();
  registerOrchestrationIpc((channel, listener) => handlers.set(channel, (event, ...args) => {
    assertMainRenderer(event, () => ({ isDestroyed: () => false, webContents: wc }));
    return listener(event, ...args);
  }), m);
  return { invoke: (channel, ...args) => Promise.resolve().then(() => handlers.get(channel)({ sender: wc, senderFrame: wc.mainFrame }, ...args)) };
}
const OPTIONS = ["merge_request.create", "merge_request.target={base}", "merge_request.title={commitTitle}", "x.ref={ref}"];
const PUSH_PROFILE = (over = {}) => PROFILE({ checks: ["test -f keep.txt"], branchTemplate: "{issue}-{ref}", runBase: { remote: "upstream", branch: "stable" },
  runPush: RUN_PUSH({ options: OPTIONS, protected: ["release"] }), ...over });

// ---------------- the manager ----------------

test("saveProfile: runPush's address read by get-url --all and --push --all (insteadOf expanded; a pushurl elsewhere — remote_url_unreadable); confirmPush to turn it on and to change remote or options; the same values and addGrant keep confirmedAt", OPTS, async () => {
  const { dir, bare } = project();
  const m = manager(scripts());
  const linkId = await linkOn(m, dir);
  g(dir, "config", `url.${path.dirname(bare)}/.insteadOf`, "fixture:");
  g(dir, "remote", "set-url", "upstream", `fixture:${path.basename(bare)}`);
  const rp = (over = {}) => PROFILE({ runPush: RUN_PUSH({ options: ["merge_request.create"], remoteUrl: "anything", confirmedAt: "1999-01-01T00:00:00.000Z", ...over }) });
  const off = await m.saveProfile(linkId, rp({ enabled: false }));
  assert.ok(off.ok, JSON.stringify(off));
  assert.deepEqual([off.value.runPush.remoteUrl, off.value.runPush.confirmedAt], [null, null], "turned off: nothing read, nothing the caller sent is kept");
  const asked = await m.saveProfile(linkId, rp());
  assert.equal(asked.code, "push_not_confirmed");
  const on = await m.saveProfile(linkId, { ...rp(), confirmPush: true });
  assert.ok(on.ok, JSON.stringify(on));
  const at = on.value.runPush.confirmedAt;
  assert.match(at, /^\d{4}-\d\d-\d\dT/);
  assert.equal("confirmPush" in (await createProfileStore(m.root).get(dir)), false, "not saved");
  // the same values again: no confirmation, confirmedAt kept; addGrant writes the profile whole and keeps it too
  const same = await m.saveProfile(linkId, rp({ confirmedAt: null }));
  assert.deepEqual([same.ok, same.value?.runPush.confirmedAt], [true, at]);
  await createProfileStore(m.root).addGrant(dir, { provider: "codex", kind: "command", tool: "shell", summary: "x", fingerprint: "a".repeat(64) });
  assert.equal((await createProfileStore(m.root).get(dir)).runPush.confirmedAt, at);
  // the options or the remote changed while on — asked again
  assert.equal((await m.saveProfile(linkId, rp({ options: ["merge_request.create", "merge_request.draft=false"] }))).code, "push_not_confirmed");
  g(dir, "remote", "add", "other", bare);
  assert.equal((await m.saveProfile(linkId, rp({ remote: "other" }))).code, "push_not_confirmed");
  // a pushurl to another address: not one address — refused; a remote that is not there — refused
  g(dir, "remote", "set-url", "--push", "upstream", path.join(TMP, "elsewhere.git"));
  assert.equal((await m.saveProfile(linkId, { ...rp(), confirmPush: true })).code, "remote_url_unreadable");
  assert.equal((await m.saveProfile(linkId, { ...rp({ remote: "nope" }), confirmPush: true })).code, "remote_url_unreadable");
  // runPush.remote and runBase.remote apart, each with its own address
  g(dir, "remote", "set-url", "--delete", "--push", "upstream", "elsewhere");
  const pushTo = path.join(TMP, `push-${++n}.git`);
  g(TMP, "init", "-q", "--bare", pushTo);
  g(dir, "remote", "add", "review", pushTo);
  const apart = await m.saveProfile(linkId, { ...PROFILE({ runBase: { remote: "upstream", branch: "stable" }, runPush: RUN_PUSH({ remote: "review" }) }), confirmPush: true });
  assert.ok(apart.ok, JSON.stringify(apart));
  assert.deepEqual([apart.value.runBase.remoteUrl, apart.value.runPush.remoteUrl], [bare, pushTo]);
  // the profile's own refusals come back with their codes
  assert.equal((await m.saveProfile(linkId, { ...PROFILE({ runPush: RUN_PUSH({ options: ["ci.skip"] }) }), confirmPush: true })).code, "push_option_forbidden");
  assert.equal((await m.saveProfile(linkId, { ...PROFILE({ workMode: "copy", runPush: RUN_PUSH() }), confirmPush: true })).code, "work_mode_not_worktree");
  await m.shutdown();
});

test("the window cannot send a push, its options, its protected list or a branch: parseGoal refuses them (invalid_argument)", OPTS, async () => {
  const { dir } = project();
  const m = manager(scripts());
  const linkId = await linkOn(m, dir);
  const bus = ipc(m);
  const t1 = task({ project: dir });
  const send = (goal) => bus.invoke(IPC.orchestrationLinkStart, { linkId, requestId: randomUUID(), goal });
  for (const finish of [{ commit: true, push: { remote: "upstream", branch: "x", options: ["a"] }, qa: false }, { commit: true, push: { protected: [] }, qa: false }]) {
    assert.equal((await send(autoGoal(t1, { finish }))).code, "invalid_argument");
  }
  assert.equal((await send(autoGoal(t1, { branch: "main" }))).code, "invalid_argument");
  await m.shutdown();
});

test("the autopilot pushes the run's branch with the profile's options: the remote branch is the run's commit, the options reached the remote as filled (quotes and $ in one string), frozen with the protected list in the goal; a task without commitTitle is skipped (push_option_field), a person's start of it refused", OPTS, async () => {
  const { dir, bare, got } = project();
  const t0 = task({ project: dir, ref: "T0", issue: "ISSUE-1", text: "write z", criteria: ["z.txt says done"] }); // no commitTitle
  const t1 = task({ project: dir, ref: "T1", issue: "ISSUE-1", commitTitle: TITLE, text: "write x", criteria: ["x.txt says done"] });
  const root = path.join(TMP, `root-${++n}`);
  boardFile(root, [t0, t1]);
  const sh = ledgerShell();
  const m = manager(scripts(turns("x.txt")), { root, shell: sh.path });
  const linkId = await linkOn(m, dir);
  assert.ok((await m.saveProfile(linkId, { ...PUSH_PROFILE(), confirmPush: true })).ok);
  // the card and the person's start
  const v0 = (await m.board()).value;
  assert.deepEqual(v0.pushFields, { [placeKey({ workspaceId: WS, project: dir })]: ["commitTitle"] });
  const st0 = boardStatuses(v0.board, v0.facts, [], boardOptsOf(v0)).get(t0.id);
  assert.deepEqual([st0.reason, st0.field], ["push_option_field", "commitTitle"]);
  g(dir, "fetch", "-q", "upstream");
  const refused = await m.create({ requestId: randomUUID(), source: dir, goal: autoGoal(t0, remoteRef(dir)) });
  assert.deepEqual([refused.code, refused.message.split(": ").at(-1)], ["push_option_field", "commitTitle"]);
  // the autopilot: T0 skipped, T1 pushed
  assert.equal((await m.boardBudget(linkId, { ...AUTOPILOT_BUDGET, parallel: 1 })).ok, true);
  assert.ok((await m.boardAutopilot(linkId, true, "ru")).ok);
  const end = await apOff(m, linkId, 240_000);
  assert.equal(end.stop.code, "others_wait", JSON.stringify(end));
  const v = (await m.board()).value;
  assert.deepEqual(v.facts.map((f) => f.taskId), [t1.id], "T0 never started");
  const runId = v.facts[0].runId;
  assert.equal((await m.get(runId)).value.view.status, "completed");
  const commit = g(dir, "rev-parse", "ISSUE-1-T1").trim();
  assert.equal(remoteHead(bare, "ISSUE-1-T1"), commit, "the remote branch is the run's commit");
  assert.deepEqual(got(), ["merge_request.create", "merge_request.target=stable", `merge_request.title=${TITLE}`, "x.ref=T1"]);
  assert.deepEqual(goalOf(root, runId).finish.push, {
    remote: "upstream", branch: "ISSUE-1-T1", remoteUrl: bare, options: ["merge_request.create", "merge_request.target=stable", `merge_request.title=${TITLE}`, "x.ref=T1"],
    protected: ["main", "master", "stable", "release"]
  });
  assert.equal(sh.count(/^git push -o 'merge_request\.create' -o 'merge_request\.target=stable' /), 1);
  assert.equal(sh.count(/--no-verify/), 0);
  assert.equal(sh.count(/^git ls-remote /), 1, "confirmed by the remote itself");
  await m.shutdown();
});

test("protected: a template's name in runPush.protected (any case) is refused at the start; a goal whose push branch is in its frozen list pauses needs_user_action push_protected before the push", OPTS, async () => {
  const { dir, bare } = project();
  const t2 = task({ project: dir, ref: "T2", issue: "ISSUE-1", commitTitle: "feat: two", text: "write y", criteria: ["y.txt says done"] });
  const rel = task({ project: dir, ref: "T1", issue: "Release", commitTitle: "feat: one" }); // Release-T1, after T2 on the board
  const root = path.join(TMP, `root-${++n}`);
  boardFile(root, [rel, t2]);
  const sh = ledgerShell();
  let m = manager(scripts(turns("y.txt")), { root, shell: sh.path });
  const linkId = await linkOn(m, dir);
  assert.ok((await m.saveProfile(linkId, { ...PUSH_PROFILE({ runPush: RUN_PUSH({ protected: ["release-t1"] }) }), confirmPush: true })).ok);
  g(dir, "fetch", "-q", "upstream");
  const refused = await m.create({ requestId: randomUUID(), source: dir, goal: autoGoal(rel, remoteRef(dir)) });
  assert.equal(refused.code, "protected_branch");
  // T2's push refused by the remote: the run pauses before any second push; its goal then names its own branch protected
  fs.writeFileSync(path.join(bare, "reject"), "");
  assert.equal((await m.boardBudget(linkId, { ...AUTOPILOT_BUDGET, parallel: 1 })).ok, true);
  assert.ok((await m.boardAutopilot(linkId, true, "ru")).ok);
  const end = await apOff(m, linkId, 240_000);
  assert.equal(end.stop.code, "run_paused", JSON.stringify(end));
  const runId = (await m.board()).value.facts.find((f) => f.taskId === t2.id).runId;
  assert.deepEqual([(await m.get(runId)).value.view.status, (await m.get(runId)).value.view.reason], ["paused", "finish_unconfirmed"]);
  assert.equal(sh.count(/^git push /), 1);
  await m.shutdown();
  fs.rmSync(path.join(bare, "reject"));
  withGoal(root, runId, (goal) => ({ ...goal, finish: { ...goal.finish, push: { ...goal.finish.push, protected: [...goal.finish.push.protected, "issue-1-t2"] } } }));
  m = manager(scripts(), { root, shell: sh.path });
  assert.equal((await resume(m, runId)).ok, true);
  const v = await until(async () => { const x = (await m.get(runId)).value?.view; return x?.status === "paused" && x.reason === "needs_user_action" ? x : null; }, "the protected pause");
  assert.equal(v.reason, "needs_user_action");
  assert.match(JSON.stringify((await m.activity(runId, 0, 500)).value ?? ""), /push_protected: the branch ISSUE-1-T2 is protected/);
  assert.equal(sh.count(/^git push /), 1, "no push into the protected branch");
  assert.equal(remoteHead(bare, "ISSUE-1-T2"), null);
  await m.shutdown();
});

test("after an unknown outcome of the push only ls-remote runs: pushed once, confirmed when the remote answers", OPTS, async () => {
  const { dir, bare, got } = project();
  const t1 = task({ project: dir, ref: "T1", issue: "ISSUE-1", commitTitle: "feat: one", text: "write x", criteria: ["x.txt says done"] });
  const root = path.join(TMP, `root-${++n}`);
  boardFile(root, [t1]);
  const sh = ledgerShell();
  const m = manager(scripts(turns("x.txt")), { root, shell: sh.path });
  const linkId = await linkOn(m, dir);
  assert.ok((await m.saveProfile(linkId, { ...PUSH_PROFILE(), confirmPush: true })).ok);
  sh.set("lsfail");
  assert.equal((await m.boardBudget(linkId, { ...AUTOPILOT_BUDGET, parallel: 1 })).ok, true);
  assert.ok((await m.boardAutopilot(linkId, true, "ru")).ok);
  const end = await apOff(m, linkId, 240_000);
  assert.equal(end.stop.code, "run_paused", JSON.stringify(end));
  const runId = (await m.board()).value.facts[0].runId;
  const paused = (await m.get(runId)).value.view;
  assert.deepEqual([paused.status, paused.reason], ["paused", "finish_unconfirmed"]);
  assert.deepEqual([sh.count(/^git push /), sh.count(/^git ls-remote /)], [1, 1]);
  assert.equal(remoteHead(bare, "ISSUE-1-T1"), g(dir, "rev-parse", "ISSUE-1-T1").trim(), "it reached the remote");
  sh.set("lsfail", false);
  assert.equal((await resume(m, runId)).ok, true);
  const v = await ended(m, runId);
  assert.equal(v.status, "completed", JSON.stringify([v.status, v.reason]));
  assert.deepEqual([sh.count(/^git push /), sh.count(/^git ls-remote /)], [1, 2], "pushed once, then only ls-remote");
  assert.equal(got().length, OPTIONS.length, "the options went once");
  await m.shutdown();
});

test("runPush is the autopilot's only: a dialog's start of a board task in a profile that pushes keeps finish.push (the profile's, no options); without runPush the autopilot's goal has no push, as before", OPTS, async () => {
  const { dir } = project();
  const t1 = task({ project: dir, ref: "T1", issue: "ISSUE-1", commitTitle: "feat: one" });
  const t2 = task({ project: dir, ref: "T2", issue: "ISSUE-1", commitTitle: "feat: two" });
  const root = path.join(TMP, `root-${++n}`);
  boardFile(root, [t1, t2]);
  const m = manager(scripts(PLAN_ONLY, PLAN_ONLY), { root });
  const linkId = await linkOn(m, dir);
  // no remote base here (the dialog starts board tasks); finish.push is the profile's own
  const profile = PROFILE({ checks: ["test -f keep.txt"], branchTemplate: "{issue}-{ref}", finish: { commit: true, push: { remote: "upstream", branch: "qa" }, qa: null },
    runPush: RUN_PUSH({ options: ["merge_request.create"] }) });
  assert.ok((await m.saveProfile(linkId, { ...profile, confirmPush: true })).ok);
  const r1 = randomUUID();
  assert.ok((await m.startOnLink({ linkId, requestId: r1, goal: autoGoal(t1, { reviewPlan: true, finish: { commit: true, push: true, qa: false } }) })).ok);
  const bare = g(dir, "remote", "get-url", "upstream").trim();
  assert.deepEqual(goalOf(root, r1).finish.push, { remote: "upstream", branch: "qa", remoteUrl: bare });
  await ended(m, r1);
  const r2 = randomUUID();
  assert.ok((await m.startOnLink({ linkId, requestId: r2, goal: autoGoal(t2, { reviewPlan: true }) })).ok);
  assert.equal(goalOf(root, r2).finish.push, null, "the dialog asked no push: none");
  await ended(m, r2);
  await m.shutdown();
});

test("import: a task's push options are not a field of the format — invalid_task for the row; the task cannot set them", async () => {
  const dir = path.join(TMP, `repo-${++n}`);
  fs.mkdirSync(dir);
  execFileSync(GIT, ["init", "-q", dir], { env: GIT_ENV });
  const row = (ref, over = {}) => ({ ref, project: dir, title: ref, text: ref, criteria: ["c"], ...over });
  const r = await readTasksFile("tasks.json", Buffer.from(JSON.stringify({ format: "board-tasks/v1", workspace: "acme",
    tasks: [row("T1"), row("T2", { options: ["merge_request.create"] }), row("T3", { protected: [] })] })), { open: (id) => id === WS, named: (x) => (x === "acme" ? [WS] : []) });
  assert.deepEqual(r.job.rows.filter((x) => x.refused).map((x) => [x.ref, x.refused.code]), [["T2", "invalid_task"], ["T3", "invalid_task"]]);
});

test("i18n (F4, T-8): the texts of runPush in both languages", () => {
  const keys = ["boardReason_push_option_field", "projRunPush", "projRunPushConfirm", "projRunPushUrlUnread", "projRunPushOptions", "projRunPushProtected", "orchError_push_protected", "orchError_push_option_forbidden",
    "orchError_push_option_field", "orchError_push_option_invalid", "orchError_push_needs_base", "orchError_push_needs_commit", "orchError_push_not_confirmed"];
  for (const locale of ["ru", "en"]) for (const k of keys) assert.ok(words(locale, k), `${locale}: ${k}`);
  assert.equal(words("ru", "projRunPushConfirm"), "Автопилот будет пушить в {remote} ({url}) с options: {options}");
});

// ---------------- review fixes: the push's confirmation, its address and its options ----------------

test("the settings' facts give each remote the address main saves (insteadOf expanded; several addresses — null), not the raw url", OPTS, async () => {
  const { dir, bare } = project();
  const m = manager(scripts());
  const linkId = await linkOn(m, dir);
  g(dir, "config", `url.${path.dirname(bare)}/.insteadOf`, "fixture:");
  g(dir, "remote", "set-url", "upstream", `fixture:${path.basename(bare)}`);
  g(dir, "remote", "add", "split", bare);
  g(dir, "remote", "set-url", "--push", "split", path.join(TMP, "elsewhere.git"));
  const remotes = (await m.profile(linkId)).value.facts.remotes;
  const by = Object.fromEntries(remotes.map((r) => [r.name, r]));
  assert.deepEqual([by.upstream.url, by.upstream.pushUrl], [`fixture:${path.basename(bare)}`, bare]);
  assert.deepEqual([by.split.url, by.split.pushUrl], [bare, null]);
  await m.shutdown();
});

test("saveProfile with runPush turned off reads no address: a remote that is gone does not block it, the saved address and confirmation stay", OPTS, async () => {
  const { dir } = project();
  const m = manager(scripts());
  const linkId = await linkOn(m, dir);
  const pushTo = path.join(TMP, `push-${++n}.git`);
  g(TMP, "init", "-q", "--bare", pushTo);
  g(dir, "remote", "add", "review", pushTo);
  const on = await m.saveProfile(linkId, { ...PROFILE({ runPush: RUN_PUSH({ remote: "review" }) }), confirmPush: true });
  assert.ok(on.ok, JSON.stringify(on));
  g(dir, "remote", "remove", "review");
  const off = await m.saveProfile(linkId, PROFILE({ runPush: RUN_PUSH({ remote: "review", enabled: false }) }));
  assert.ok(off.ok, JSON.stringify(off));
  assert.deepEqual([off.value.runPush.enabled, off.value.runPush.remoteUrl, off.value.runPush.confirmedAt], [false, pushTo, on.value.runPush.confirmedAt]);
  await m.shutdown();
});

test("the autopilot's start refuses a push the profile never confirmed (the file written by hand: no confirmedAt) — push_not_confirmed; and an option that grows past the limits once filled — push_option_invalid", OPTS, async () => {
  const { dir } = project();
  const long = "x".repeat(72);
  const t1 = task({ project: dir, ref: "T1", issue: "ISSUE-1", commitTitle: long, text: "write x", criteria: ["x.txt says done"] });
  const root = path.join(TMP, `root-${++n}`);
  boardFile(root, [t1]);
  const m = manager(scripts(turns("x.txt")), { root });
  const linkId = await linkOn(m, dir);
  assert.ok((await m.saveProfile(linkId, { ...PUSH_PROFILE({ runPush: RUN_PUSH({ options: ["x.t={commitTitle}{commitTitle}{commitTitle}{commitTitle}{commitTitle}"] }) }), confirmPush: true })).ok);
  g(dir, "fetch", "-q", "upstream");
  assert.equal((await m.boardBudget(linkId, { ...AUTOPILOT_BUDGET, parallel: 1 })).ok, true);
  const start = async () => {
    assert.ok((await m.boardAutopilot(linkId, true, "ru")).ok);
    const end = await apOff(m, linkId, 120_000);
    return [end.stop.code, end.stop.detail];
  };
  assert.deepEqual(await start(), ["start_failed", "push_option_invalid"], "5 x 72 characters is past the value's 300");
  const store = createProfileStore(root);
  const was = await store.get(dir);
  assert.ok(await store.save(dir, { ...was, runPush: { ...was.runPush, options: ["merge_request.create"], confirmedAt: null } }));
  assert.deepEqual(await start(), ["start_failed", "push_not_confirmed"]);
  await m.shutdown();
});
