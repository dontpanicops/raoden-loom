// Electron UI smoke for F4, push, MR, the review export and the runs without MCP (docs/agent-orchestration/implementation/
// stage-f-external-projects.md §7.5, §8, §10, §11): the real window at 1280×800, fake Codex/Claude CLIs (one script per
// work folder), a fixture Git project with a bare remote «upstream» that advertises push options and whose pre-receive
// hook writes each option it got (a flag file makes it refuse), the worktree mode, a neutral fixture profile after §7.6:
// branchTemplate {issue}-{ref}, runBase upstream/stable, runPush with options and protected[], reviewExport, runMcp false.
// The fake login shell logs its lines; on request its `git ls-remote` fails. The fake CLIs' wrappers read the MCP servers
// they report from files, and on request fail `--version`. The steps f4.s1–f4.s9:
//   f4.s1 «Автопилот пушит» off by default; the confirmation shows the remote, its address and the options as they are; no
//         confirmPush — push_not_confirmed; changed options — asked again; the same values keep confirmedAt;
//   f4.s2 push_option_forbidden, push_option_invalid, push_needs_base, push_needs_commit, work_mode_not_worktree;
//   f4.s3 the task's cycle and push: the run's branch on the remote is the run's commit, the options reached the remote
//         (merge_request.create: the MR asked for); a task without commitTitle at {commitTitle} — push_option_field on its
//         card, skipped, the autopilot does not stop on it;
//   f4.s4 main and a name of protected[] — protected_branch at the start; a goal whose branch is in its frozen list (the
//         journal rewritten) — no push, a pause needs_user_action/push_protected;
//   f4.s5 the push made, its outcome unknown (ls-remote failed) — «Продолжить» runs only ls-remote, no second push;
//   f4.s6 reviewExport: review.json and review.md outside the tree, review.json by the schema, git status of the worktree and
//         the project the same before and after (the export written again at the next start), «Скопировать путь»;
//         review_export_needs_base, review_export_needs_commit; nothing to commit — no export, the panel says so; a stopped
//         run — none; the CLI not answering — both versions null, the export written; a removed task — title null; each
//         completed run its own export;
//   f4.s7 runMcp false: Claude with --strict-mcp-config and no --mcp-config, its init naming a server — mcp_present; Codex's
//         thread config without MCP keys, a named server — mcp_present with its names, no list — mcp_unchecked, the empty
//         whole list — the turn goes; readiness warns mcp_warning (and «not checked» when Codex does not answer in 30 s);
//   f4.s8 the full example of tasks.json from board-formats.md (project and workspace put in) is imported whole;
//   f4.s9 a board task started from the dialog in a profile with runPush — finish.push as before, no options; the autopilot's
//         start of the same task — with the options; the profile without reviewExport and runMcp — as before.
// Needs `npm run build` first. Starts no real model. Usage: node scripts/smoke-board-f4-ui.mjs [--shots <dir>] [--out <file>]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { buildRecord, canonical, sha256Hex } from "../src/main/services/orchestration/journal.ts";
import { FIXTURES, JOURNAL_V2, NODE, ROOT, byText, canvasState, card, createAgent, launch as launchApp, q, waitForValue, workspace } from "./orchestration-app-kit.mjs";

if (!JOURNAL_V2) throw new Error("the board is journal v2 only (goal.task)");
const { D, git, project, script } = workspace("cto-board-f4-");
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? path.resolve(process.argv[i + 1]) : null; };
const SHOTS = arg("--shots") ?? D("shots");
const OUT = arg("--out");
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 9800 + Math.floor(Math.random() * 150);
const failures = [];
const passed = [];
const ok = (what, cond, got) => { (cond ? passed : failures).push(cond ? what : `${what}: ${JSON.stringify(got)?.slice(0, 600)}`); };
const AjvClass = Ajv2020.default ?? Ajv2020;
const validReview = new AjvClass({ strict: true, strictRequired: false, allErrors: true }).compile(JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "board-review-v1.schema.json"), "utf8")));

// ---------- the fake CLIs' answers: one script per work folder, in the order of the runs ----------
const cond = (file) => ({ keep: null, text: `${file} says done`, covers: ["R1"], evidence: { kind: "change", check: null } });
const plan = (file) => ({ report: { stages: [{ title: "fix", task: `write ${file}`, conditions: [cond(file)] }], dropped: [], dropRequirements: [], question: null } });
const exec = (file) => ({ report: { summary: "done", done: true }, writes: [[file, "done\n"]] });
const review = (file) => ({ report: { conditions: [{ id: "C1", status: "met", paths: [file], note: "written" }], findings: [], request: "none", question: null } });
const final = { report: { conditions: [], findings: [], request: "none", question: null, requirements: [{ id: "R1", status: "met", note: "written" }] } };
const turns = (file) => [plan(file), exec(file), review(file), final];
// a run that changes nothing: its condition stands on the check, its commit has nothing to commit
const nothing = [
  { report: { stages: [{ title: "look", task: "look", conditions: [{ keep: null, text: "nothing to do", covers: ["R1"], evidence: { kind: "check", check: "cmd-1" } }] }], dropped: [], dropRequirements: [], question: null } },
  { report: { summary: "nothing", done: true } },
  { report: { conditions: [], findings: [], request: "none", question: null } },
  { report: { conditions: [], findings: [], request: "none", question: null, requirements: [{ id: "R1", status: "met", note: "nothing" }] } }
];
// the run without MCP: Claude reads its script's step before its init, so the turn its init stopped loses one step
const noMcp = (file) => [plan(file), exec(file), exec(file), review(file), final];
// P1, P3, P4, P5, P5B, P6 (nothing), P7 (stopped after its first turn), P8 (MCP), the autopilot's Q1 and the dialog's Q1
const SCRIPTS = [turns("p1.txt"), turns("p3.txt"), turns("p4.txt"), turns("p5.txt"), turns("p5b.txt"), nothing, turns("p7.txt"), noMcp("p8.txt"), turns("q1.txt"), turns("q1.txt")];
for (const [k, s] of SCRIPTS.entries()) script(`f4/${k + 1}`, s);

// ---------- the fixture project: a bare remote with options and pre-receive ----------
const app0 = project("board-f4-app");
const bare = D("remote.git");
git(D(), "init", "-q", "--bare", bare);
git(bare, "config", "receive.advertisePushOptions", "true");
const gotFile = D("push-options.txt"), REJECT = D("push-reject");
fs.writeFileSync(path.join(bare, "hooks", "pre-receive"), `#!/bin/sh
i=0
while [ "$i" -lt "\${GIT_PUSH_OPTION_COUNT:-0}" ]; do eval "printf '%s\\\\n' \\"\\$GIT_PUSH_OPTION_$i\\"" >> "${gotFile}"; i=$((i+1)); done
cat > /dev/null
[ -f "${REJECT}" ] && { echo "rejected by the fixture" >&2; exit 1; }
exit 0
`, { mode: 0o755 });
git(app0, "remote", "add", "upstream", bare);
git(app0, "push", "-q", "upstream", "main:stable");
git(app0, "config", "user.name", "smoke");
git(app0, "config", "user.email", "smoke@localhost");
const remoteHead = (b) => { try { return git(bare, "rev-parse", "--verify", "-q", `refs/heads/${b}`).trim(); } catch { return null; } };
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean) : []);
const got = () => lines(gotFile);

fs.mkdirSync(D("mock-state", ".codex"), { recursive: true });
fs.writeFileSync(D("mock-state", ".codex", "config.toml"), "");
const codexConfig0 = sha256Hex(fs.readFileSync(D("mock-state", ".codex", "config.toml")));
const ledger = D("ledger.jsonl");
// the wrappers: `--version` answered here (VERSION_FAIL: not answered); the MCP servers the fake CLI reports from a file
const VERSION_FAIL = D("version-fail"), CODEX_MCP = D("codex-mcp"), CLAUDE_MCP = D("claude-mcp");
fs.writeFileSync(CODEX_MCP, "");
fs.writeFileSync(CLAUDE_MCP, "");
const wrap = (p, version, mcpFile, mcpVar) => {
  const f = D(`${p}-mock`);
  fs.writeFileSync(f, `#!/bin/sh
[ "$1" = "--version" ] && { [ -f "${VERSION_FAIL}" ] && exit 1; echo "${version}"; exit 0; }
${mcpVar}=$(cat "${mcpFile}"); export ${mcpVar}
exec "${NODE}" "${path.join(FIXTURES, `mock-${p}.mjs`)}" "$@"
`, { mode: 0o755 });
  return f;
};
const GIT_DIR = path.dirname(fs.realpathSync(execFileSync("/usr/bin/which", ["git"], { encoding: "utf8" }).trim()));
const PATHS = `${path.dirname(NODE)}:${GIT_DIR}:/usr/bin:/bin`;
const env = (extra) => ({ HOME: D("mock-state"), MOCK_STATE: D("mock-state"), MOCK_LEDGER: ledger, MOCK_CHECKS: "none", MOCK_SCRIPT: D("script", "f4"), MOCK_SCRIPT_PER_CWD: "1",
  MOCK_TURN_DELAY_MS: "300", ...extra });
// the user's login shell: every line logged; ls-remote fails on request
const SHELL = D("login-shell");
const shellLog = D("shell.log"), LS_FAIL = D("ls-fail");
fs.writeFileSync(SHELL, `#!/bin/sh
[ "$1" = "-ilc" ] && shift
printf '%s\\n' "$1" >> "${shellLog}"
case "$1" in *"git ls-remote"*) [ -f "${LS_FAIL}" ] && { echo "fatal: the fixture's remote does not answer" >&2; exit 128; } ;; esac
exec /bin/sh -c "$1"
`, { mode: 0o755 });
const pushes = () => lines(shellLog).filter((l) => /(^|\s)git push /.test(l));
const lsRemotes = () => lines(shellLog).filter((l) => /(^|\s)git ls-remote /.test(l));
const providers = D("providers.json");
fs.writeFileSync(providers, JSON.stringify({
  codex: { executable: wrap("codex", "codex-cli 0.162.0", CODEX_MCP, "MOCK_CODEX_MCP"), version: "codex-cli 0.162.0", path: PATHS, env: env({ CODEX_HOME: D("mock-state", ".codex") }) },
  claude: { executable: wrap("claude", "2.1.281 (Claude Code)", CLAUDE_MCP, "MOCK_CLAUDE_MCP"), version: "2.1.281 (Claude Code)", path: PATHS, env: env({}) },
  shell: SHELL, checkEnv: { PATH: PATHS, HOME: D("mock-state") }
}));
const userData = D("user-data");
const ORCH = path.join(userData, "orchestration");
const BUTTON_FILE = D("chosen", "tasks.json"); // what the smoke's hook names instead of the dialog
fs.mkdirSync(path.dirname(BUTTON_FILE), { recursive: true });
const row = (ref, over = {}) => ({ ref, project: app0, title: `Задача ${ref}`, text: `Сделать ${ref}`, criteria: [`${ref} готово`], ...over });
const file = (tasks) => JSON.stringify({ format: "board-tasks/v1", workspaceId: "common", source: "smoke-f4", tasks });
const OPTIONS = ["merge_request.create", "merge_request.target={base}", "merge_request.title={commitTitle}", "x.ref={ref}"];

let app;
const view = () => app.ev("window.canvasTTY.orchestration.board().then((r) => r.value)");
const taskOf = async (ref) => (await view()).board.tasks.find((t) => t.ref === ref);
const sel = (key, inner = "") => q(`[data-board-task="${key}"] ${inner}`.trim());
const ipc = (call) => app.ev(`window.canvasTTY.orchestration.${call}`);
const J = (v) => JSON.stringify(v);
const click = async (selector) => { await app.ev(`${selector}?.scrollIntoView({ block: "center" })`); await app.clickEl(selector); };
const shot = (name) => app.shot(`f4-${name}`).catch((e) => console.log(`[smoke] screenshot ${name}: ${String(e?.message ?? e)}`));
const setValue = (selector, value) => app.ev(`(() => { const el = ${selector}; const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${J(value)}); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); })()`);
const apState = async () => Object.values((await view()).autopilot ?? {})[0] ?? null;
const runsOf = async (ref) => { const v = await view(); const t = v.board.tasks.find((x) => x.ref === ref); return v.facts.filter((f) => f.taskId === t.id); };
const runDir = (runId) => path.join(ORCH, "runs", runId);
const goalOf = (runId) => {
  const first = JSON.parse(fs.readFileSync(path.join(runDir(runId), "journal.jsonl"), "utf8").split("\n")[0]);
  return JSON.parse(fs.readFileSync(path.join(runDir(runId), "texts", first.data.goal.sha256), "utf8"));
};
// the goal of a run rewritten in its journal, every record rebuilt on the chain (as scripts/f-rollback-fixtures.mjs does)
function withGoal(runId, edit) {
  const j = path.join(runDir(runId), "journal.jsonl");
  const recs = fs.readFileSync(j, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const buf = Buffer.from(canonical(edit(goalOf(runId))), "utf8");
  const ref = { sha256: sha256Hex(buf), bytes: buf.length };
  fs.writeFileSync(path.join(runDir(runId), "texts", ref.sha256), buf);
  let prev = null, out = "";
  for (const r of recs) {
    const { v, seq, ts, runId: id, type, prevHash: _p, data, hash: _h, ...head } = r;
    const { record, line } = buildRecord(prev, id, ts, type, seq === 0 ? { ...data, goal: ref } : data, v, seq === 0 ? head : null);
    prev = { seq: record.seq, hash: record.hash };
    out += line.toString("utf8");
  }
  fs.writeFileSync(j, out);
}
const exportDir = (runId) => path.join(runDir(runId), "export");
const readExport = (runId) => { try { return JSON.parse(fs.readFileSync(path.join(exportDir(runId), "review.json"), "utf8")); } catch { return null; } };
const status = (dir) => git(dir, "status", "--porcelain", "--untracked-files=all");
const runCount = () => (fs.existsSync(path.join(ORCH, "runs")) ? fs.readdirSync(path.join(ORCH, "runs")).length : 0);
let linkId = null;
let base = null; // the profile as F4 sets it

async function start() {
  app = await launchApp({ userData, providers, port: PORT, shots: SHOTS, env: { CANVASTTY_USER_DATA_DIR: userData, CANVASTTY_SMOKE_IMPORT_FILE: BUTTON_FILE } });
  await app.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await app.waitFor("!!window.canvasTTY?.orchestration", "the orchestration API");
}
async function restart() {
  await app.quit();
  await start();
  if (!(await app.ev(`!!${q("[data-board]")}`))) await app.clickEl(q("[data-board-button]"));
  await app.waitFor(`${q("[data-board]")} && true`, "the board on the canvas");
}
async function importFile(tasks, raw = null) {
  fs.writeFileSync(BUTTON_FILE, raw ?? file(tasks));
  await app.clickEl(q("[data-board-import]"));
  const r = await waitForValue(() => app.ev(`${q("[data-board-import-report]")}?.dataset.boardImportReport ?? null`), "the import's report");
  await app.clickEl(q(".launch-dialog__close"));
  await app.waitFor(`!${q("[data-board-import-report]")}`, "the report window closed");
  return r;
}
async function runBoard() {
  await app.waitFor(`${q("[data-board-autopilot-start]")} && true`, "the autopilot off in the window", 20_000);
  await app.clickEl(q("[data-board-autopilot-start]"));
  await app.waitFor(`${q("[data-board-autopilot-confirm]")} && true`, "the autopilot's explanation");
  await app.clickEl(q("[data-board-autopilot-yes]"));
  await app.waitFor(`${q('[data-board-autopilot="on"]')} && true`, "the autopilot on");
}
const stopped = (ms = 240_000) => waitForValue(async () => { const s = await apState(); return s && !s.on && s.stop ? s.stop : null; }, "the autopilot to stop", ms);
const saveProfile = (over, extra = {}) => ipc(`saveProfile(${J(linkId)}, ${J({ ...base, ...over, ...extra })}).then((r) => r.ok ? r.value : { code: r.code })`);
const runView = (runId) => ipc(`get(${J(runId)}).then((r) => r.value.view)`);
const command = async (runId, kind) => {
  const v = await runView(runId);
  return ipc(`command(${J({ runId, commandId: crypto.randomUUID(), expectedRevision: v.revision, command: { kind } })})`);
};
const settle = (runId, what, ms = 120_000) => waitForValue(async () => { const v = await runView(runId); return ["paused", "completed", "stopped", "failed"].includes(v.status) ? v : null; }, what, ms);
const stopRun = async (runId) => {
  await command(runId, "stop");
  return waitForValue(() => ipc(`get(${J(runId)}).then((r) => ["stopped", "failed", "completed"].includes(r.value.view.status) ? r.value.view.status : null)`), `${runId} stopped`, 60_000);
};
const archive = async (...refs) => { for (const r of refs) { const t = await taskOf(r); if (t && !t.archivedAt) await ipc(`boardArchive(${J(t.id)}, true)`); } };
const feedOf = async (runId) => (await ipc(`activity(${J(runId)}, 0, 500).then((r) => r.value.entries)`)) ?? [];
async function closeDialogs() {
  for (let i = 0; i < 4 && (await app.ev(`!!${q(".orch-dialog")}`)); i++) await app.clickEl(`[...document.querySelectorAll(".launch-dialog__close")].at(-1)`);
}
async function openPanel(key) {
  await click(sel(key, "[data-board-open]"));
  await app.waitFor(`${q("[data-orch-run-id]")} && true`, `${key}: the run's panel`);
  await app.clickEl(q('[data-orch-tab="overview"]'));
}
const readyItem = (id) => app.ev(`(() => { const el = ${q(`[data-ready-id="${id}"]`)}; return el ? { level: el.dataset.readyLevel, text: el.textContent } : null; })()`);
async function goalDialogReadiness(ms = 45_000) {
  await app.clickEl(byText(`[data-agent-link-id="${linkId}"] button`, "Новая цель"));
  await app.waitFor(`${q(".orch-dialog textarea")} && true`, "goal dialog");
  await app.type(`document.querySelectorAll(".orch-dialog textarea")[0]`, "a free run");
  await app.type(`document.querySelectorAll(".orch-dialog textarea")[1]`, "free.txt says done");
  await app.waitFor(`["ready", "confirm", "blocked", "error"].includes(${q("[data-orch-readiness]")}?.dataset.orchReadiness)`, "readiness", ms);
}

try {
  await start();
  await createAgent(app, "Агент Codex (лид)", app0);
  await createAgent(app, "Агент Claude (исполнитель)", app0);
  const c = await canvasState(app);
  const lead = c.agents.find((a) => a.provider === "codex"), execAgent = c.agents.find((a) => a.provider === "claude");
  const ends = () => Promise.all([app.center(card(lead.agentId, ".agent-card__port")), app.center(card(execAgent.agentId, ".agent-card__body"))]);
  let prev = null;
  const [from, to] = await waitForValue(async () => { const e = await ends(); const still = prev && J(prev) === J(e); prev = e; return still ? e : null; }, "the cards laid out");
  await app.drag(from, to, 20);
  await app.waitFor("window.canvasTTY.orchestration.canvas().then((r) => r.value.links.length === 1)", "link");
  linkId = (await canvasState(app)).links[0].linkId;
  if (!(await app.ev(`!!${q("[data-board]")}`))) await app.clickEl(q("[data-board-button]"));
  await app.waitFor(`${q("[data-board]")} && true`, "the board on the canvas");
  const p0 = await ipc(`profile(${J(linkId)}).then((r) => r.value.profile)`);
  base = { ...p0, workMode: "worktree", checks: ["true"], prepare: { auto: false, steps: [] }, finish: { ...p0.finish, commit: true },
    branchTemplate: "{issue}-{ref}", runBase: { remote: "upstream", branch: "stable", remoteUrl: null } };
  const saved0 = await saveProfile({});
  ok("the profile: worktree, {issue}-{ref}, runBase upstream/stable", saved0.runBase?.remoteUrl === bare, saved0);
  base = saved0;
  ok("one place", (await ipc(`boardBudget(${J(linkId)}, { runs: 40, minutes: 240, parallel: 1 }).then((r) => r.ok)`)) === true);

  // ---------- f4.s1: «Автопилот пушит» in the window ----------
  await app.clickEl(byText(`[data-agent-link-id="${linkId}"] button`, "Новая цель"));
  await app.waitFor(`${q("[data-orch-profile]")} && ${q("[data-orch-profile]")}.dataset.orchProfile !== "loading"`, "project settings", 20_000);
  await app.clickEl(q("[data-orch-open-settings]"));
  await app.waitFor(`${q("[data-orch-settings]")} && true`, "settings");
  await app.ev(`document.querySelectorAll("[data-orch-settings] details").forEach((d) => { d.open = true; })`);
  const off = await app.ev(`({ push: ${q("[data-orch-settings-run-push-enabled]")}?.checked ?? null, review: ${q("[data-orch-settings-review-export]")}?.checked ?? null, mcp: ${q("[data-orch-settings-run-mcp]")}?.checked ?? null })`);
  ok("f4.s1 the settings: «Автопилот пушит», «Выгрузка ревью» and «Без MCP» there, all off by default", J(off) === J({ push: false, review: false, mcp: false }), off);
  await click(q("[data-orch-settings-run-push-enabled]"));
  await app.waitFor(`${q("[data-orch-settings-run-push-options]")} && true`, "the push's fields");
  await setValue(q("[data-orch-settings-run-push-options]"), OPTIONS.join("\n"));
  const confirmText = await waitForValue(() => app.ev(`${q("[data-orch-push-confirm]")}?.textContent ?? null`), "the confirmation");
  ok("f4.s1 the confirmation names the remote, its address and the options as they are", confirmText.includes("upstream") && confirmText.includes(bare) && confirmText.includes(OPTIONS.join(" ")), confirmText);
  await app.ev(`${q("[data-orch-settings]")}.requestSubmit()`);
  const notConfirmed = await waitForValue(() => app.ev(`${q("[data-orch-settings] [role=alert]")}?.textContent ?? null`), "the refusal");
  ok("f4.s1 «Сохранить» without the confirmation — push_not_confirmed, nothing saved", notConfirmed === "Включение push не подтверждено: подтвердите в окне"
    && (await ipc(`profile(${J(linkId)}).then((r) => r.value.profile.runPush ?? null)`)) === null, notConfirmed);
  await shot("s1-confirm");
  await closeDialogs();
  const runPush = { enabled: true, remote: "upstream", remoteUrl: null, options: OPTIONS, protected: ["release-p9"], confirmedAt: null };
  const asked = await saveProfile({ runPush });
  const on = await saveProfile({ runPush }, { confirmPush: true });
  const same = await saveProfile({ runPush: { ...runPush, confirmedAt: null } });
  const changed = await saveProfile({ runPush: { ...runPush, options: [...OPTIONS, "merge_request.draft"] } });
  ok("f4.s1 main: no confirmPush — push_not_confirmed; confirmed — confirmedAt; the same values — kept; options changed — asked again",
    asked.code === "push_not_confirmed" && /^\d{4}-/.test(on.runPush?.confirmedAt ?? "") && on.runPush.remoteUrl === bare && same.runPush?.confirmedAt === on.runPush.confirmedAt
    && changed.code === "push_not_confirmed", [asked, on.runPush, same.runPush?.confirmedAt, changed]);
  base = on;

  // ---------- f4.s2: the profile's refusals ----------
  const rp = (over, p = {}) => saveProfile({ ...p, runPush: { ...runPush, ...over } }, { confirmPush: true }).then((r) => r.code ?? "saved");
  const s2 = {
    forbidden: await rp({ options: ["merge_request.merge_when_pipeline_succeeds"] }),
    ciSkip: await rp({ options: ["ci.skip"] }),
    invalid: await rp({ options: ["a b=c"] }),
    unknown: await rp({ options: ["a={foo}"] }),
    needsBase: await rp({ options: ["merge_request.target={base}"] }, { runBase: undefined }),
    needsCommit: await rp({}, { finish: { ...base.finish, commit: false } }),
    copy: await rp({}, { workMode: "copy", runBase: undefined, branchTemplate: undefined }),
    project: await rp({}, { workMode: "project", runBase: undefined, branchTemplate: undefined })
  };
  ok("f4.s2 push_option_forbidden, push_option_invalid, push_needs_base, push_needs_commit, work_mode_not_worktree", J(s2) === J({ forbidden: "push_option_forbidden", ciSkip: "push_option_forbidden",
    invalid: "push_option_invalid", unknown: "push_option_invalid", needsBase: "push_needs_base", needsCommit: "push_needs_commit", copy: "work_mode_not_worktree", project: "work_mode_not_worktree" }), s2);
  ok("f4.s2 the profile after the refusals is the confirmed one", J((await ipc(`profile(${J(linkId)}).then((r) => r.value.profile.runPush)`))) === J(base.runPush));

  // ---------- f4.s3: the cycle and the push ----------
  await importFile([row("P1", { issue: "ISSUE-1", commitTitle: "feat: \"первая\" задача $HOME" }), row("P2", { issue: "ISSUE-1" })]);
  const p2 = await taskOf("P2");
  await app.waitFor(`${q(`[data-board-task="${p2.key}"][data-board-reason="push_option_field"]`)} && true`, "P2: push_option_field");
  const p2line = await app.ev(`${sel(p2.key, "[data-board-line-text]")}?.textContent ?? null`);
  ok("f4.s3 P2 without commitTitle: push_option_field on its card, the field named", /commitTitle/.test(p2line ?? ""), p2line);
  await runBoard();
  const end3 = await stopped();
  const [r1] = await runsOf("P1");
  const g1 = goalOf(r1.runId);
  const commit1 = git(app0, "rev-parse", "ISSUE-1-P1").trim();
  ok("f4.s3 the autopilot did not stop on P2: P1 done, then others_wait; P2 never started", end3.code === "others_wait" && r1.status === "completed" && (await runsOf("P2")).length === 0, end3);
  ok("f4.s3 the run's branch on the remote is the run's commit", remoteHead("ISSUE-1-P1") === commit1, [remoteHead("ISSUE-1-P1"), commit1]);
  ok("f4.s3 the options reached the remote as filled (the MR asked for: merge_request.create)", J(got()) === J(["merge_request.create", "merge_request.target=stable", "merge_request.title=feat: \"первая\" задача $HOME", "x.ref=P1"]), got());
  ok("f4.s3 the goal: the push with its options and the frozen protected list", J(g1.finish.push?.protected) === J(["main", "master", "stable", "release-p9"]) && g1.finish.push?.options?.length === 4, g1.finish.push);
  ok("f4.s3 one git push, no --no-verify", pushes().length === 1 && !lines(shellLog).some((l) => l.includes("--no-verify")), pushes());
  await shot("s3-pushed");
  await archive("P2");

  // ---------- f4.s4: protected names ----------
  await importFile([row("P9", { issue: "Release", commitTitle: "feat: p9" })]);
  const before4 = runCount();
  await runBoard();
  const prot = await stopped(60_000);
  ok("f4.s4 a name of protected[] (another case): Release-P9 — protected_branch, no run", prot.code === "start_failed" && prot.detail === "protected_branch" && runCount() === before4, prot);
  await archive("P9");
  base = await saveProfile({ branchTemplate: "{ref}" });
  await importFile([row("main", { commitTitle: "feat: main" })]);
  await runBoard();
  const mainRefused = await stopped(60_000);
  ok("f4.s4 the branch name main — protected_branch, no run", mainRefused.code === "start_failed" && mainRefused.detail === "protected_branch" && runCount() === before4, mainRefused);
  await archive("main");
  base = await saveProfile({ branchTemplate: "{issue}-{ref}" });
  // P3: the remote refuses its push; then its goal names its own branch protected
  await importFile([row("P3", { issue: "ISSUE-1", commitTitle: "feat: p3" })]);
  fs.writeFileSync(REJECT, "");
  await runBoard();
  const end4 = await stopped();
  const [r3] = await runsOf("P3");
  const v3 = await runView(r3.runId);
  ok("f4.s4 the remote refused: paused finish_unconfirmed", end4.code === "run_paused" && v3.status === "paused" && v3.reason === "finish_unconfirmed", [end4, v3.status, v3.reason]);
  const pushes4 = pushes().length;
  fs.rmSync(REJECT);
  await app.quit();
  withGoal(r3.runId, (g) => ({ ...g, finish: { ...g.finish, push: { ...g.finish.push, protected: [...g.finish.push.protected, "issue-1-p3"] } } }));
  await restart();
  await command(r3.runId, "resume");
  const v4 = await waitForValue(async () => { const x = await runView(r3.runId); return x.status === "paused" && x.reason === "needs_user_action" ? x : null; }, "the protected pause", 60_000);
  const feed4 = await feedOf(r3.runId);
  ok("f4.s4 the goal's branch in its frozen list: no push, needs_user_action/push_protected", v4.reason === "needs_user_action" && feed4.some((e) => (e.text ?? "").includes("push_protected: the branch ISSUE-1-P3 is protected"))
    && pushes().length === pushes4 && remoteHead("ISSUE-1-P3") === null, [feed4.slice(-3), pushes().length, pushes4]);
  await shot("s4-push-protected");
  await stopRun(r3.runId);
  await archive("P3");

  // ---------- f4.s5: the push's outcome unknown ----------
  await importFile([row("P4", { issue: "ISSUE-1", commitTitle: "feat: p4" })]);
  const [push5, ls5, got5] = [pushes().length, lsRemotes().length, got().length];
  fs.writeFileSync(LS_FAIL, "");
  await runBoard();
  const end5 = await stopped();
  const [r4] = await runsOf("P4");
  const v5 = await runView(r4.runId);
  ok("f4.s5 ls-remote failed after the push: paused finish_unconfirmed; pushed once, it reached the remote", end5.code === "run_paused" && v5.reason === "finish_unconfirmed" && pushes().length === push5 + 1
    && lsRemotes().length > ls5 && remoteHead("ISSUE-1-P4") === git(app0, "rev-parse", "ISSUE-1-P4").trim(), [end5, v5.reason, pushes().length - push5]);
  fs.rmSync(LS_FAIL);
  const ls5b = lsRemotes().length;
  await command(r4.runId, "resume");
  const v5b = await settle(r4.runId, "P4 after «Продолжить»");
  ok("f4.s5 «Продолжить»: only ls-remote, no second push; the options went once; completed", v5b.status === "completed" && pushes().length === push5 + 1 && lsRemotes().length === ls5b + 1
    && got().length === got5 + 4, [v5b.status, v5b.reason, pushes().length - push5, lsRemotes().length - ls5b, got().length - got5]);

  // ---------- f4.s6: the review export ----------
  const needsBase = await saveProfile({ reviewExport: true, runBase: undefined, runPush: undefined });
  const needsCommit = await saveProfile({ reviewExport: true, runPush: undefined, finish: { ...base.finish, commit: false } });
  ok("f4.s6 reviewExport without runBase — review_export_needs_base; without the commit — review_export_needs_commit", needsBase.code === "review_export_needs_base" && needsCommit.code === "review_export_needs_commit", [needsBase, needsCommit]);
  base = await saveProfile({ reviewExport: true });
  ok("f4.s6 reviewExport saved", base.reviewExport === true, base);
  await importFile([row("P5", { issue: "ISSUE-1", commitTitle: "feat: p5", scope: ["docs/**", "p5.txt"] }), row("P5B", { issue: "ISSUE-1", commitTitle: "feat: p5b" })]);
  await runBoard();
  const end6 = await stopped();
  const [r5] = await runsOf("P5"), [r5b] = await runsOf("P5B");
  const e5 = await waitForValue(() => readExport(r5.runId), "P5's export", 10_000).catch(() => null);
  const e5b = await waitForValue(() => readExport(r5b.runId), "P5B's export", 10_000).catch(() => null);
  ok("f4.s6 two completed runs, two exports", end6.code === "all_done" && e5 && e5b && e5.run === r5.runId && e5b.run === r5b.runId, [end6, !!e5, !!e5b]);
  const commit5 = git(app0, "rev-parse", "ISSUE-1-P5").trim();
  ok("f4.s6 review.json passes board-review/v1", !!e5 && validReview(e5) && validReview(e5b), validReview.errors);
  ok("f4.s6 its fields from their sources: commit, tree, branch, base, scope, push confirmed, the CLIs' versions",
    e5?.commit === commit5 && e5.tree === git(app0, "rev-parse", `${commit5}^{tree}`).trim() && e5.branch === "ISSUE-1-P5" && e5.base.branch === "upstream/stable" && J(e5.scope) === J(["docs/**", "p5.txt"])
    && e5.push?.remote === "upstream" && e5.push.result === "confirmed" && e5.lead?.cliVersionAtExport === "0.162.0" && e5.executor?.cliVersionRaw === "2.1.281 (Claude Code)" && e5.task.issue === "ISSUE-1", e5);
  ok("f4.s6 the export outside the project's tree, review.md beside it", path.relative(app0, exportDir(r5.runId)).startsWith("..") && fs.existsSync(path.join(exportDir(r5.runId), "review.md"))
    && fs.readFileSync(path.join(exportDir(r5.runId), "review.md"), "utf8").includes("ISSUE-1-P5"));
  const p5 = await taskOf("P5");
  await openPanel(p5.key);
  await app.waitFor(`${q('[data-orch-export="paths"]')} && true`, "the export's paths in the panel");
  const paths = await app.ev(`[...document.querySelectorAll("[data-orch-export-path]")].map((e) => e.dataset.orchExportPath)`);
  ok("f4.s6 the panel: the paths of review.json and review.md", J(paths) === J([path.join(exportDir(r5.runId), "review.json"), path.join(exportDir(r5.runId), "review.md")]), paths);
  const copyBtn = q("[data-orch-run-id] [data-orch-export-copy]");
  await click(copyBtn);
  const copied = await waitForValue(() => app.ev(`${copyBtn}?.textContent === "Скопировано" || null`), "«Скопировано»", 5_000).catch(() => false);
  ok("f4.s6 «Скопировать путь» copies", copied === true, await app.ev(`({ n: document.querySelectorAll("[data-orch-export-copy]").length, text: ${copyBtn}?.textContent,
    at: (() => { const r = ${copyBtn}.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e?.outerHTML?.slice(0, 120); })() })`));
  await shot("s6-export");
  // nothing to commit: no export, the panel says so; a stopped run: none
  base = await saveProfile({ runPush: { ...base.runPush, enabled: false } });
  await importFile([row("P6", { issue: "ISSUE-1", commitTitle: "feat: p6" })]);
  await runBoard();
  await stopped();
  const [r6] = await runsOf("P6");
  const v6 = await runView(r6.runId);
  ok("f4.s6 P6 completed with nothing to commit: no export", v6.status === "completed" && v6.export === null && !fs.existsSync(exportDir(r6.runId)), [v6.status, v6.reason, v6.export]);
  await openPanel((await taskOf("P6")).key);
  const none = await waitForValue(() => app.ev(`${q('[data-orch-export="none"]')}?.textContent ?? null`), "the panel's «no export»").catch(() => null);
  ok("f4.s6 the panel says: «Выгрузки нет: нечего было коммитить»", (none ?? "").includes("Выгрузки нет: нечего было коммитить"), none);
  await shot("s6-no-export");
  await importFile([row("P7", { issue: "ISSUE-1", commitTitle: "feat: p7" })]);
  await runBoard();
  const r7 = await waitForValue(async () => (await runsOf("P7"))[0] ?? null, "P7 started", 60_000);
  // stopped once its first turn has claimed its script (the next runs' scripts stay in their order)
  await waitForValue(() => fs.existsSync(D("script", "f4", "7", "counter")) || null, "P7's first turn", 60_000);
  ok("f4.s6 P7 stopped", (await stopRun(r7.runId)) === "stopped");
  await stopped(60_000);
  ok("f4.s6 a stopped run: no export", !fs.existsSync(exportDir(r7.runId)) && (await runView(r7.runId)).export === null, (await runView(r7.runId)).export);
  await archive("P7");
  // the next start writes what a crash left: P5 again (the CLI not answering), P5B removed from the board
  const work5 = (await runView(r5.runId)).workDir;
  const status5 = [fs.existsSync(work5 ?? "") ? status(work5) : null, status(app0)];
  await app.quit();
  fs.rmSync(exportDir(r5.runId), { recursive: true });
  fs.rmSync(exportDir(r5b.runId), { recursive: true });
  fs.mkdirSync(path.join(runDir(r5.runId), "export.tmp-crash"));
  const boardJson = path.join(ORCH, "board.json");
  const b = JSON.parse(fs.readFileSync(boardJson, "utf8"));
  const p5bKey = b.tasks.find((t) => t.ref === "P5B").key;
  b.tasks = b.tasks.filter((t) => t.ref !== "P5B");
  fs.writeFileSync(boardJson, JSON.stringify(b));
  fs.writeFileSync(VERSION_FAIL, "");
  await restart();
  const again5 = await waitForValue(() => readExport(r5.runId), "P5's export written again at the start", 30_000).catch(() => null);
  const again5b = await waitForValue(() => readExport(r5b.runId), "P5B's export written again at the start", 30_000).catch(() => null);
  fs.rmSync(VERSION_FAIL);
  ok("f4.s6 after the restart the export is written, the crash's temporary folder gone", !!again5 && validReview(again5) && !fs.readdirSync(runDir(r5.runId)).some((n) => n.startsWith("export.tmp-")), again5);
  ok("f4.s6 the CLI did not answer: cliVersionAtExport and cliVersionRaw null", again5?.lead?.cliVersionAtExport === null && again5.lead.cliVersionRaw === null && again5.executor?.cliVersionRaw === null, again5?.lead);
  ok("f4.s6 the removed task: title and issue null, key and ref from the goal", J(again5b?.task) === J({ key: p5bKey, ref: "P5B", title: null, issue: null }) && validReview(again5b), again5b?.task);
  ok("f4.s6 git status of the worktree and the project the same before and after the export", J([fs.existsSync(work5 ?? "") ? status(work5) : null, status(app0)]) === J(status5), status5);
  await archive("P6");

  // ---------- f4.s7: runMcp false ----------
  base = await saveProfile({ reviewExport: undefined, runMcp: false });
  ok("f4.s7 runMcp false saved", base.runMcp === false, base);
  fs.writeFileSync(CODEX_MCP, "alpha,beta");
  await goalDialogReadiness();
  const warn = await readyItem("mcp_warning");
  ok("f4.s7 readiness: mcp_warning naming Codex's servers", warn?.level === "warning" && warn.text.includes("alpha, beta"), warn);
  await shot("s7-readiness");
  await closeDialogs();
  const argv0 = lines(D("mock-state", "claude-argv.jsonl")).length;
  const asked0 = lines(D("mock-state", "codex-mcp.jsonl")).length; // the readiness's own list: no thread
  await importFile([row("P8", { issue: "ISSUE-1", commitTitle: "feat: p8" })]);
  await runBoard();
  await stopped();
  const [r8] = await runsOf("P8");
  const pause = async (what) => {
    const v = await runView(r8.runId);
    const f = (await feedOf(r8.runId)).filter((e) => e.kind === "error" && e.detail?.mcp).at(-1) ?? null;
    return { status: v.status, reason: v.reason, mcp: f?.detail ?? null, what };
  };
  const a = await pause("codex named");
  ok("f4.s7 Codex names servers (runtimeStatus not read): paused needs_user_action/mcp_present with the names", a.status === "paused" && a.reason === "needs_user_action" && a.mcp?.mcp === "mcp_present"
    && a.mcp.cli === "codex" && a.mcp.names === "alpha, beta", a);
  await openPanel((await taskOf("P8")).key);
  const panelText = await app.ev(`${q("[data-orch-run-id]")}?.textContent ?? ""`);
  ok("f4.s7 the panel says it: «У Codex включены MCP-серверы: alpha, beta»", panelText.includes("У Codex включены MCP-серверы: alpha, beta"), panelText.slice(0, 400));
  await shot("s7-mcp-present");
  fs.writeFileSync(CODEX_MCP, "no_data");
  await command(r8.runId, "resume");
  await settle(r8.runId, "the next pause");
  const b8 = await pause("no list");
  ok("f4.s7 an answer without the whole list: mcp_unchecked", b8.reason === "needs_user_action" && b8.mcp?.mcp === "mcp_unchecked", b8);
  fs.writeFileSync(CODEX_MCP, "");
  fs.writeFileSync(CLAUDE_MCP, "gamma");
  await command(r8.runId, "resume");
  await settle(r8.runId, "Claude's pause");
  const c8 = await pause("claude named");
  ok("f4.s7 Codex's empty whole list: the turn goes; Claude's init naming a server — mcp_present of Claude", c8.reason === "needs_user_action" && c8.mcp?.mcp === "mcp_present" && c8.mcp.cli === "claude" && c8.mcp.names === "gamma", c8);
  fs.writeFileSync(CLAUDE_MCP, "");
  await command(r8.runId, "resume");
  const d8 = await settle(r8.runId, "P8 completed");
  ok("f4.s7 no server named: P8 completed", d8.status === "completed", [d8.status, d8.reason]);
  const argv8 = lines(D("mock-state", "claude-argv.jsonl")).slice(argv0).map((l) => JSON.parse(l));
  ok("f4.s7 Claude with --strict-mcp-config and no --mcp-config", argv8.length >= 2 && argv8.every((x) => x.includes("--strict-mcp-config") && !x.some((y) => y.startsWith("--mcp-config"))), argv8.length);
  const asked8 = lines(D("mock-state", "codex-mcp.jsonl")).slice(asked0).map((l) => JSON.parse(l));
  // each turn of Codex asks in its thread (threadId); a request without one is a readiness's (no thread there)
  ok("f4.s7 Codex asked for its thread's servers (threadId) before its turns", asked8.filter((p) => typeof p.threadId === "string" && p.threadId.length > 0).length >= 4, asked8);
  const configs = lines(D("mock-state", "codex-thread-config.jsonl")).map((l) => JSON.parse(l));
  ok("f4.s7 thread/start and thread/resume: no MCP key in config; ~/.codex/config.toml untouched", configs.length > 0 && configs.every((x) => x.config === null || x.config === undefined || Object.keys(x.config).every((k) => k === "projects"))
    && sha256Hex(fs.readFileSync(D("mock-state", ".codex", "config.toml"))) === codexConfig0, configs.slice(0, 3));
  fs.writeFileSync(CODEX_MCP, "hang");
  const t0 = Date.now();
  await goalDialogReadiness(90_000);
  const hung = await readyItem("mcp_warning");
  ok("f4.s7 Codex does not answer in 30 s: readiness «не проверено»", hung?.level === "warning" && /не проверен/.test(hung.text) && Date.now() - t0 >= 29_000, [hung, Math.round((Date.now() - t0) / 1000)]);
  await closeDialogs();
  fs.writeFileSync(CODEX_MCP, "");
  await archive("P8");

  // ---------- f4.s8: the full example of the format's document ----------
  const app1 = project("board-f4-example");
  const doc = fs.readFileSync(path.join(ROOT, "docs", "agent-orchestration", "board-formats.md"), "utf8");
  const full = JSON.parse(doc.match(/<!-- example: tasks-full -->\s*```json\n([\s\S]*?)\n```/)[1]);
  delete full.workspace;
  full.workspaceId = "common";
  for (const t of full.tasks) t.project = app1;
  const imported8 = await importFile(null, JSON.stringify(full));
  const tasks8 = (await view()).board.tasks.filter((t) => t.project === app1);
  const t2 = tasks8.find((t) => t.ref === "T2");
  ok("f4.s8 the full example (project and workspace put in) imported whole: T1, T1-MR, T2 with scope and models", imported8 === "imported" && J(tasks8.map((t) => t.ref)) === J(["T1", "T1-MR", "T2"])
    && J(t2?.scope) === J(["docs/**"]) && t2?.models?.executor === "opus" && t2.issue === "ISSUE-1" && t2.commitTitle === "feat: second task", [imported8, tasks8.map((t) => [t.ref, t.scope])]);
  await shot("s8-full-example");
  for (const t of tasks8) await ipc(`boardArchive(${J(t.id)}, true)`);

  // ---------- f4.s9: the dialog's start, the autopilot's start; the profile without the new keys ----------
  const { runBase: _r, runMcp: _m, reviewExport: _e, ...plain } = base;
  base = await saveProfile({ ...plain, runBase: undefined, runMcp: undefined, reviewExport: undefined, finish: { ...plain.finish, push: { remote: "upstream", branch: "qa" } },
    runPush: { ...plain.runPush, enabled: true, options: ["merge_request.create", "x.ref={ref}"] } }, { confirmPush: true });
  ok("f4.s9 the profile: no runBase, reviewExport or runMcp; finish.push to qa; runPush on", base.runPush?.enabled === true && !("runBase" in base) && !("reviewExport" in base) && !("runMcp" in base), base);
  await importFile([row("Q1", { issue: "ISSUE-1", commitTitle: "feat: q1" })]);
  const q1 = await taskOf("Q1");
  const argv9 = lines(D("mock-state", "claude-argv.jsonl")).length;
  const got9 = got().length;
  await runBoard();
  const end9 = await stopped();
  const [auto] = await runsOf("Q1");
  const ga = goalOf(auto.runId);
  ok("f4.s9 the autopilot's start: the push with the profile's options, completed", end9.code === "all_done" && J(ga.finish.push?.options) === J(["merge_request.create", "x.ref=Q1"])
    && got().slice(got9).includes("x.ref=Q1"), [end9, ga.finish.push]);
  const argvQ = lines(D("mock-state", "claude-argv.jsonl")).slice(argv9).map((l) => JSON.parse(l));
  ok("f4.s9 without the new keys as before: Claude without --strict-mcp-config, no export, the goal without export/noMcp", argvQ.length > 0 && argvQ.every((x) => !x.includes("--strict-mcp-config"))
    && !fs.existsSync(exportDir(auto.runId)) && !("export" in ga) && !("noMcp" in ga) && (await runView(auto.runId)).export === undefined, argvQ.length);
  // the same task started again from the dialog (a person's start): finish.push as the profile has it, no options
  const dialog = await ipc(`startOnLink(${J({ linkId, requestId: crypto.randomUUID(), goal: { text: q1.text, criteria: q1.criteria, checks: [], commands: ["true"], mode: "autopilot", reviewPlan: true, workMode: "worktree",
    task: { id: q1.id, key: q1.key }, finish: { commit: true, push: true, qa: false } } })})`);
  const dId = dialog.value?.runId;
  const gd = dId ? await waitForValue(() => { try { return goalOf(dId); } catch { return null; } }, "the dialog's run written", 30_000).catch(() => null) : null;
  const sorted = (o) => (o ? Object.fromEntries(Object.entries(o).sort(([x], [y]) => x.localeCompare(y))) : o);
  ok("f4.s9 the dialog's start of the same task: finish.push the profile's, no options; no export, no noMcp", dialog.ok === true && J(sorted(gd?.finish.push)) === J({ branch: "qa", remote: "upstream", remoteUrl: bare })
    && !("export" in gd) && !("noMcp" in gd), [dialog.code, dialog.message, gd?.finish]);
  if (dId) {
    await waitForValue(async () => (await runView(dId)).status === "paused" || null, "the dialog's run shows its plan", 120_000);
    await stopRun(dId);
  }
  await shot("s9-as-before");
} catch (error) {
  failures.push(`error: ${String(error?.stack ?? error).slice(0, 1500)}`);
  try { failures.push(`state: ${J({ autopilot: await apState(), runs: await ipc("list().then((r) => r.value.map((x) => [x.view.runId.slice(0, 8), x.view.status, x.view.reason]))") })}`.slice(0, 1500)); } catch {}
  try { await app?.shot("f4-failure"); } catch {}
} finally {
  await app?.quit?.();
}

const result = { ok: failures.length === 0, passed: passed.length, passedList: passed, failures, fakeCliProcesses: fs.existsSync(ledger) ? fs.readFileSync(ledger, "utf8").split("\n").filter(Boolean).length : 0,
  pushes: pushes().length, lsRemotes: lsRemotes().length, shots: SHOTS };
if (OUT) fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
