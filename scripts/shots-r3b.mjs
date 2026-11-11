// Frames of stage R3b: the pinned action zone over the tabs and the panel foot; themes sand and bay, canvas colour theme.
// Live (fake CLIs, no model): a run paused on plan_review, then completed. The other states are not reachable without a model:
// they are drawn from the zone fixtures (tests/fixtures/orchestration/zone-sets.mjs) as the real RunPanel's static markup with the built app.css.
// Needs `npm run build` first. Usage: node scripts/shots-r3b.mjs --out <dir> [--before] [--only live|fixtures]
// --before: the same for a build of main (sand only: the live pair and a few fixtures). Frames are written as PNG; the caller shrinks them (sips) to JPEG.
// --out is required: nothing is written into docs by default.
import fs from "node:fs";
import path from "node:path";
import { createRequire, Module } from "node:module";
import { pathToFileURL } from "node:url";
import { FIXTURES, NODE, ROOT, byText, canvasState, createAgent, launch, q, sleep, startGoal, workspace, JOURNAL_V2 } from "./orchestration-app-kit.mjs";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
if (!arg("out")) { console.error("--out <dir> is required"); process.exit(2); }
const OUT = path.resolve(arg("out"));
fs.mkdirSync(OUT, { recursive: true });
const BEFORE = process.argv.includes("--before");
const ONLY = arg("only");
// R4.1: --forms draws only the states with a decision form, in the themes of --themes (default sand,bay), each also at --ui-scale 1.25
const FORMS = process.argv.includes("--forms");
const THEMES = (arg("themes") ?? "sand,bay").split(",");
const FORM_STATES = arg("states")?.split(",") ?? ["05-checks-decision", "06-checks-none", "07-limit-reached", "10-person-decision", "11-coverage-lost", "12-finish-confirmation", "14-check-needs-permissions"];

const { TMP, D, project, script } = workspace("cto-r3bshots-");
const PORT = 9500 + Math.floor(Math.random() * 250);
const node = project("node-app");
const requireApp = createRequire(path.join(ROOT, "package.json"));

const verdict = (v) => ({ report: { verdict: v, findings: [], question: null } });
const planV2 = { report: { stages: [{ title: "Заметка", task: "Add src/note.mjs", conditions: [
  { keep: null, text: "src/note.mjs exists", covers: ["R1"], evidence: { kind: "change", check: null } },
  { keep: null, text: "node --test passes", covers: ["R2"], evidence: { kind: "check", check: "cmd-1" } }] }], dropped: [], dropRequirements: [], question: null } };
const reviewV2 = { report: { conditions: [{ id: "C1", status: "met", paths: ["src/note.mjs"], note: "src/note.mjs exports note" }], findings: [], request: "none", question: null } };
const finalV2 = { report: { conditions: [], findings: [], request: "none", question: null, requirements: ["R1", "R2"].map((id) => ({ id, status: "met", note: "done" })) } };
const codexScript = script("codex", JOURNAL_V2 ? [planV2, reviewV2, finalV2]
  : [{ report: { stages: [{ title: "Заметка", task: "Add src/note.mjs" }], question: null } }, verdict("accept"), verdict("complete")]);
const claudeScript = script("claude", [{ report: { summary: "note added", done: true }, writes: [["src/note.mjs", "export const note = 'a';\n"]] }]);
fs.mkdirSync(D("mock-state", ".codex"), { recursive: true });
const ledger = D("ledger.jsonl");
const wrap = (p) => {
  const f = D(`${p}-mock`);
  fs.writeFileSync(f, `#!/bin/sh\nexec "${NODE}" "${path.join(FIXTURES, `mock-${p}.mjs`)}" "$@"\n`, { mode: 0o755 });
  return f;
};
const PATHS = `${path.dirname(NODE)}:/usr/bin:/bin`;
const SHELL = D("login-shell");
fs.writeFileSync(SHELL, `#!/bin/sh\n[ "$1" = "-ilc" ] && shift\nexec /bin/sh -c "$1"\n`, { mode: 0o755 });
const env = (extra) => ({ HOME: D("mock-state"), MOCK_STATE: D("mock-state"), MOCK_LEDGER: ledger, ...extra });
const providers = D("providers.json");
fs.writeFileSync(providers, JSON.stringify({
  codex: { executable: wrap("codex"), version: "codex-cli 0.155.1", path: PATHS, env: env({ MOCK_SCRIPT: codexScript, CODEX_HOME: D("mock-state", ".codex") }) },
  claude: { executable: wrap("claude"), version: "2.1.281 (Claude Code)", path: PATHS, env: env({ MOCK_SCRIPT: claudeScript }) },
  shell: SHELL, checkEnv: { PATH: PATHS, HOME: D("mock-state") }
}));

// ---- the fixture states: the 18 of the mock-up 07, by name -> [zone-set, extra view fields]
const permission = { requestId: "p1", role: "executor", provider: "claude", kind: "command", tool: "Bash", summary: "npm test", detail: "npm test", options: ["allow_once", "allow_run", "deny"], questions: [], askedAt: "2026-11-11T10:00:00.000Z" };
const STATES = [
  ["01-working", null, { running: { stage: 2, permission: null, active: { kind: "turn", purpose: "execute" } } }],
  ["02-awaiting-answer", "awaiting_answer"],
  ["03-permission", null, { running: { stage: 2, permission, pendingPermissions: 1 } }],
  ["04-plan-review", "plan_review"],
  ["05-checks-decision", "awaiting_checks_decision"],
  ["06-checks-none", "awaiting_checks_none"],
  ["07-limit-reached", "limit_reached"],
  ["08-outcome-unknown", "outcome_unknown"],
  ["09-loop-suspected", "loop_suspected"],
  ["10-person-decision", "awaiting_person_decision"],
  ["11-coverage-lost", "coverage_lost"],
  ["12-finish-confirmation", "awaiting_finish_confirmation"],
  ["13-finish-unconfirmed", "finish_unconfirmed"],
  ["14-check-needs-permissions", "check_needs_permissions"],
  ["15-lead-modified-tree", "lead_modified_tree"],
  ["16-needs-user-action-mcp", "mcp_present"],
  ["17-completed", null, { completed: true }],
  ["18-failed", null, { failed: true }],
  ["19-newer-readonly", null, { newerV: { version: 3, chain: "ok", goal: "Добавить заметки к задачам доски: создание, список, удаление.", compatible: true } }],
  ["20-newer-fallback", null, { newerV: { version: 3, chain: "ok", goal: "Добавить заметки к задачам доски: создание, список, удаление.", compatible: false, fallback: { line: 41, code: "unknown_kind" } } }]
];
const { fixture, view } = await import(pathToFileURL(path.join(ROOT, "tests/fixtures/orchestration/zone-sets.mjs")).href);
const { legacyView } = await import(pathToFileURL(path.join(ROOT, "src/renderer/src/features/orchestration/panelTabs.ts")).href);

// the plan of two stages the run runs on (the mock-up's "stage 2 of 2" and the numbered list of the plan review)
const PLAN_RECORDS = [{ seq: 1, ts: "2026-11-11T10:00:00.000Z", type: "plan.recorded", data: { plan: { sha256: "pp", bytes: 1 }, firstStage: 1, stageCount: 2 } },
  { seq: 2, ts: "2026-11-11T10:05:00.000Z", type: "review.recorded", data: { stage: null, verdict: "complete", findings: null } }];
const PLAN_TEXTS = { pp: { status: "ready", text: JSON.stringify({ stages: [{ title: "модель заметки", task: "t" }, { title: "API и список", task: "t" }] }) },
  gg: { status: "ready", text: JSON.stringify({ text: "Добавить заметки к задачам доски", commands: [], limits: { runMs: 4 * 3600_000, turns: 40, roundsPerStage: 6 } }) },
  rr: { status: "ready", text: JSON.stringify({ done: true, summary: "заметки добавлены" }) } };
// R5b3: the journal of the completed run the mock-up 17 draws — the goal with its limits, three plan versions of two stages, both stages accepted, the executor's report
const T0 = Date.parse("2026-11-11T10:00:00.000Z");
const at = (min) => new Date(T0 + min * 60_000).toISOString();
const RECORDS_17 = [{ seq: 1, ts: at(0), type: "run.created", data: { goal: { sha256: "gg", bytes: 1 } } },
  ...[2, 3, 4].map((n) => ({ seq: n, ts: at(n), type: "plan.recorded", data: { plan: { sha256: "pp", bytes: 1 }, firstStage: 1, stageCount: 2, version: n - 1 } })),
  { seq: 5, ts: at(10), type: "orch.turn", data: { turnId: "t1", purpose: "execute", stage: 1 } },
  { seq: 6, ts: at(20), type: "turn.finished", data: { turnId: "t1", outcome: "completed", report: { ref: { sha256: "rr", bytes: 1 } } } },
  { seq: 7, ts: at(21), type: "stage.accepted", data: { stage: 1 } }, { seq: 8, ts: at(40), type: "stage.accepted", data: { stage: 2 } },
  { seq: 9, ts: at(72), type: "review.recorded", data: { stage: null, verdict: "complete", findings: null } }];
const check = (id, title) => ({ id, title, status: "passed", class: null });
const PROGRESS_17 = { mode: "autopilot", branch: "feat/notes", access: { claude: "workspace", codex: "terminal" }, models: null, prepare: null, grantsApplied: 0, completion: "confirmed",
  checks: [check("c1", "npm test"), check("c2", "npm run lint"), check("c3", "npm run build")],
  finish: [{ step: "commit", asked: true, status: "done", established: true, commit: "a1b2c3d4e5f60718", evidence: null }, { step: "push", asked: true, status: "done", established: true, commit: "9f8e7d6c5b4a3921", evidence: null },
    { step: "qa", asked: false, status: "not_started", established: false, commit: null, evidence: null }] };
const budget = (extra) => ({ calls: { lead: 14, executor: 22, reviewer: 0 }, limits: { turns: 40, runMs: 4 * 3600_000, replans: 3, roundsPerStage: 6 }, used: { turns: 40, replans: 0 }, startedAt: Date.now() - 71.2 * 60_000, deadlineAt: Date.now() + 168 * 60_000, reached: null, ...extra });
async function renderer() { // the built RunPanel to static markup (as tests/orchestration-action-zone-render.test.mjs does)
  const out = await requireApp("esbuild").build({
    // R5b (D-017): the entry also exports ActionZone and the zone model, for the frame of the open "Уточнить" field
    stdin: { contents: 'export * from "./RunPanel"; export { ActionZone } from "./ActionZone"; export { actionZone } from "./runModel";', resolveDir: path.join(ROOT, "src/renderer/src/features/orchestration"), loader: "ts" }, bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent",
    loader: { ".png": "dataurl", ".ico": "dataurl", ".webp": "dataurl", ".jpg": "dataurl" },
    plugins: [{ name: "svg-base64", setup(b) { // esbuild's dataurl leaves raw quotes inside url("..."): the icons drew as squares
      b.onLoad({ filter: /\.svg$/ }, (a) => ({ contents: `export default "data:image/svg+xml;base64,${fs.readFileSync(a.path).toString("base64")}"`, loader: "js" })); } },
      { name: "same-react", setup(b) { b.onResolve({ filter: /^react(\/.*)?$/ }, (a) => ({ path: requireApp.resolve(a.path), external: true })); } }]
  });
  const file = D("run-panel.cjs");
  const mod = new Module(file);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(ROOT);
  mod._compile(out.outputFiles[0].text, file);
  const React = requireApp("react");
  const { renderToStaticMarkup } = requireApp("react-dom/server");
  const clarifyOpen = (f) => { // the real ActionZone of a working run with the clarify field opened (its initial state when the zone says "open")
    const zone = { ...mod.exports.actionZone("ru", f.view, f.entries, true), title: "Claude делает этап 2 из 2", clarify: "open" };
    const noop = () => {};
    return renderToStaticMarkup(React.createElement(mod.exports.ActionZone, { locale: "ru", zone, runKey: "25931336", headline: "working", status: f.view.status, task: null, compact: true, flash: false, zoneRef: null,
      sending: false, disabled: () => false, onButton: noop, confirmText: () => null, clarify: { value: "Список заметок без пагинации, до 200 записей.", onChange: noop, onSend: noop }, who: "Claude",
      words: (x) => x }));
  };
  const propsOf = (f) => {
    const v = { ...f.view };
    if (v.progress) v.progress = { mode: "autopilot", checks: [], finish: [], ...v.progress };
    return {
      orch: { runs: { "25931336": { view: v, open: true, seq: 9, tick: 0 }, ...(f.live ? { "7c41e09a": { view: { ...v, runId: "7c41e09a", status: "paused" }, open: true, seq: 1, tick: 0 }, b2e0f115: { view: { ...v, runId: "b2e0f115", status: "completed" }, open: true, seq: 1, tick: 0 } } : {}) }, activity: { "25931336": { entries: f.entries, gaps: [], firstId: f.entries[0]?.id ?? 0, status: "ready", resyncs: 0 } },
        runErrors: {}, canvas: { links: [{ linkId: "L", fromAgentId: "a1", toAgentId: "a2", createdAt: "2026-11-11T10:00:00.000Z", runIds: ["25931336"] }],
          agents: [{ agentId: "a1", provider: "codex", role: "lead", project: "/work/project-b" }, { agentId: "a2", provider: "claude", role: "executor", project: "/work/project-b" }] }, journals: { "25931336": { records: f.records ?? PLAN_RECORDS, next: 1, status: "ready" } }, texts: { ...PLAN_TEXTS, ...(f.texts ?? {}) },
        commands: { pending: () => [] }, catalog: { checks: [], providers: { lead: { provider: "codex", protocol: "app-server" }, executor: { provider: "claude", protocol: "stream-json" } } }, loadText() {}, syncJournal() {}, retry() {}, stageTitles: () => ({}) },
      runId: "25931336", locale: "ru", liveRunIds: f.live ? ["25931336", "7c41e09a", "b2e0f115"] : undefined, panel: { linkId: "L", mode: "feed", ...(f.tab ? { tab: f.tab, role: "all" } : f.work ? { tab: "work", role: "all" } : legacyView("overview")), role: f.work || f.tab ? "all" : "lead", focus: 1 }, onClose() {}, onNewGoal() {}, onView() {},
      onProjectSettings: () => {}
    };
  };
  const render = (f) => renderToStaticMarkup(React.createElement(mod.exports.RunPanel, propsOf(f)));
  render.props = propsOf;
  render.clarifyOpen = clarifyOpen;
  return render;
}
// R5h-A: the states whose frame needs what the panel loads by itself (the result to take, the changed files): drawn by the real
// RunPanel in the page, with the application's API answered by the fixture, and waited for until nothing says «Загрузка…»
const LIVE_FIXTURES = ["08-outcome-unknown", "15-lead-modified-tree", "17-completed", "18-failed"];
const TAKE = { mode: "worktree", from: "checkpoint", stage: 2, files: 3, allowed: true, suggested: "raoden/notes-api-25931336", runBranch: "feat/notes", branch: null, applied: null };
const CHANGES = { base: "baseline", at: "live_snapshot", atTs: "2026-11-11T10:31:00.000Z", truncated: false, checkpoints: [], baselineRef: "base", transferred: false,
  files: [{ path: "src/api/notes.ts", status: "added" }, { path: "src/api/notes.test.ts", status: "added" }, { path: "src/index.ts", status: "modified" }] };
async function browserBundle() {
  const out = await requireApp("esbuild").build({
    stdin: { contents: 'import * as React from "react"; import { createRoot } from "react-dom/client"; import { RunPanel } from "./RunPanel"; window.__mount = (props) => { const orch = props.orch; orch.commands = { pending: () => [], request: (runId, revision, command) => ({ runId, commandId: "c", expectedRevision: revision, command }), settle() {} }; Object.assign(orch, { loadText() {}, syncJournal() {}, retry() {}, refreshRun() {}, stageTitles: () => ({}) }); createRoot(document.getElementById("root")).render(React.createElement(RunPanel, { ...props, onClose() {}, onNewGoal() {}, onView() {}, onProjectSettings() {} })); };',
      resolveDir: path.join(ROOT, "src/renderer/src/features/orchestration"), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", logLevel: "silent", define: { "process.env.NODE_ENV": '"production"', "window.canvasTTY": "window.__fxApi" }, // the real preload owns window.canvasTTY: the fixture answers instead
    loader: { ".png": "dataurl", ".ico": "dataurl", ".webp": "dataurl", ".jpg": "dataurl" },
    plugins: [{ name: "svg-base64", setup(b) { b.onLoad({ filter: /\.svg$/ }, (a) => ({ contents: `export default "data:image/svg+xml;base64,${fs.readFileSync(a.path).toString("base64")}"`, loader: "js" })); } }]
  });
  return out.outputFiles[0].text;
}
const cssFile = () => { const dir = path.join(ROOT, "out/renderer/assets"); return path.join(dir, fs.readdirSync(dir).find((f) => /^index-.*\.css$/.test(f))); };
// the mock-up opens a run that works (and most pauses) on "Work" and the checks / finish / refused ones on "Summary"
const SUMMARY_STATES = ["04-plan-review", "10-person-decision", "05-checks-decision", "06-checks-none", "12-finish-confirmation", "13-finish-unconfirmed", "14-check-needs-permissions", "17-completed", "11-coverage-lost"];
const TURN = (id, kind, text) => ({ id, ts: "2026-11-11T07:31:0" + id + ".000Z", turnId: "t1", role: "executor", provider: "claude", kind, text });
const WORKING_ENTRIES = [TURN(1, "thinking", ""), TURN(2, "tool_started", "Edit src/api/notes.ts"), TURN(3, "tool_started", "Bash npm test")];
const CHANGES_STATES = ["08-outcome-unknown", "15-lead-modified-tree"]; // D-017: the pauses about the tree open on "Changes"
// R5h-A (D-026): the pauses show where the run stands under the zone — their journals carry the plan (and the accepted stages, the round, the refused check)
const rec = (seq, type, data) => ({ seq, ts: at(seq), type, data });
const REC_PLAN = [rec(1, "run.created", { goal: { sha256: "gg", bytes: 1 } }), rec(2, "plan.recorded", { plan: { sha256: "pp", bytes: 1 }, firstStage: 1, stageCount: 2, version: 1 })];
const REC_PLAN_PR = [rec(1, "run.created", { goal: { sha256: "gg", bytes: 1 } }), rec(2, "plan.recorded", { plan: { sha256: "pq", bytes: 1 }, firstStage: 1, stageCount: 2, version: 1 }), rec(3, "stage.accepted", { stage: 1 })];
const PAUSE_EXTRA = {
  "02-awaiting-answer": { records: REC_PLAN },
  "03-permission": { records: REC_PLAN_PR, texts: { pq: { status: "ready", text: JSON.stringify({ stages: [{ title: "модель заметки", task: "t" }, { title: "PR и описание", task: "t" }] }) } } },
  "05-checks-decision": { records: REC_PLAN },
  "09-loop-suspected": { records: [...REC_PLAN, rec(3, "stage.accepted", { stage: 1 }), rec(4, "orch.turn", { turnId: "t9", purpose: "execute", stage: 2, round: 4 })] },
  "18-failed": { records: [...REC_PLAN, rec(3, "stage.accepted", { stage: 1 })] },
  "07-limit-reached": { records: [...REC_PLAN, rec(3, "stage.accepted", { stage: 1 }), rec(4, "orch.turn", { turnId: "t7", purpose: "execute", stage: 2, round: 3 })] },
  "12-finish-confirmation": { records: [...REC_PLAN, rec(3, "stage.accepted", { stage: 1 }), rec(4, "stage.accepted", { stage: 2 })] },
  "14-check-needs-permissions": { records: [...REC_PLAN, rec(3, "stage.accepted", { stage: 1 }), rec(4, "check.started", { checkRunId: "x1", checkId: "c1" }), rec(5, "check.finished", { checkRunId: "x1", checkId: "c1", status: "failed" })],
    progress: { checks: [{ id: "c1", title: "npm run test:e2e", status: "failed", class: "sandbox" }] }, refusedCommand: "npm run test:e2e" }
};
const withExtra = (f, name) => {
  const x = PAUSE_EXTRA[name];
  if (!x) return f;
  return { ...f, records: x.records, ...(x.texts ? { texts: x.texts } : {}), view: { ...f.view, ...(x.progress ? { progress: { ...(f.view.progress ?? {}), ...x.progress } } : {}), ...(x.refusedCommand && f.view.refused ? { refused: { ...f.view.refused, command: x.refusedCommand } } : {}) } };
};
const fixtureOf = (state) => withExtra(fixtureOf1(state), state[0]);
const fixtureOf1 = (state) => { const f = fixtureOf0(state); return CHANGES_STATES.includes(state[0]) ? { ...f, tab: "changes" } : SUMMARY_STATES.includes(state[0]) ? f : { ...f, work: true, live: state[0] === "01-working", entries: state[0] === "01-working" ? WORKING_ENTRIES : f.entries }; };
const fixtureOf0 = ([, set, o]) => {
  if (set === "awaiting_answer") return { view: view("paused", "awaiting_answer", { stage: 1, permission: { ...permission, kind: "question", tool: "AskUserQuestion", summary: "Где хранить заметки?", detail: null, options: ["allow_once", "deny"],
    questions: [{ id: "q1", question: "Где хранить заметки: в SQLite (~/.loom/notes.db) или JSON-файлами в папке проекта?", options: [], multiple: false, other: true }] } }), entries: [], onMac: true };
  if (set === "awaiting_person_decision") return { view: view("paused", set, { stage: 1, decisions: { runKey: "k".repeat(64), tree: "t".repeat(40), findings: true,
    disputed: [{ reviewTurnId: "t1", index: 0, problem: "Заметка не проверяет пустое имя", evidence: "src/note.mjs:4", paths: ["src/note.mjs"], candidates: [{ id: "F1", problem: "Пустое имя принимается", paths: ["src/note.mjs"] }] }],
    conditions: [{ id: "C2", text: "Интерфейс читаем при масштабе 1.25", stage: 1 }], proposal: null } }), entries: [], onMac: true };
  if (set === "coverage_lost") return { view: view("paused", set, { stage: 1, decisions: { runKey: "k".repeat(64), tree: "t".repeat(40), disputed: [], conditions: [], findings: false,
    proposal: { proposalTurnId: "t1", stages: [{ stage: 1, title: "Заметка", conditions: ["C1"] }], dropped: [{ id: "C2", text: "Работает без сети", covers: ["R2"], why: "лид счёл условие избыточным" }],
      dropRequirements: [], uncovered: ["R2"], findings: [{ id: "F2", condition: "C2", problem: "Нет теста на удаление заметки" }] } } }), entries: [], onMac: true };
  if (set === "awaiting_finish_confirmation") return { ...fixture(set), view: { ...fixture(set).view, confirm: { tree: "t".repeat(40), commit: "c0ffee1234567890".repeat(2).slice(0, 40), push: true, qa: true } } };
  if (set === "check_needs_permissions") return { ...fixture(set), view: { ...fixture(set).view, refused: { checkId: "c1", command: "npm test -- --runInBand && curl http://localhost:3000/health" } } };
  if (set === "limit_reached") { const f = fixture(set); return { ...f, view: { ...f.view, stage: 2, progress: { mode: "autopilot", checks: [], finish: [], budget: budget({ reached: "turns" }) } } }; }
  if (set === "loop_suspected") return { view: view("paused", set, { stage: 2 }), entries: [], onMac: true };
  if (set === "finish_unconfirmed") return { view: view("paused", "finish_unconfirmed", { stage: 2, progress: { mode: "autopilot", checks: [], finish: [
    { step: "commit", asked: true, status: "done", established: true, commit: "a1b2c3d4e5f60718", evidence: null },
    { step: "push", asked: true, status: "unconfirmed", established: false, commit: "a1b2c3d4e5f60718", evidence: null }] } }), entries: [], onMac: true };
  if (set) return fixture(set === "finish_unconfirmed" ? "awaiting_finish_confirmation" : set);
  if (o.newerV) return { view: view("paused", "user_request", { stage: 2, newer: o.newerV }), entries: [], onMac: true };
  if (o.running) return { view: view("running", null, o.running), entries: [], onMac: true };
  if (o.completed) return { view: view("completed", null, { stage: 2, turns: 22, workMode: "worktree", workDir: "~/dev/project-b", completion: { kind: "confirmed" }, progress: { ...PROGRESS_17, budget: budget({ used: { turns: 22, replans: 0 } }) } }),
    entries: [{ id: 1, ts: at(1), runId: "r", role: "lead", provider: "codex", turnId: null, kind: "session", text: "", detail: { reported: true, sandbox: "read-only", model: "gpt-5" } },
      { id: 2, ts: at(2), runId: "r", role: "executor", provider: "claude", turnId: null, kind: "session", text: "", detail: { reported: true, permissionMode: "acceptEdits", model: "sonnet" } }], records: RECORDS_17, onMac: true };
  // the failure: the executor's turn ended with an error the zone quotes
  return { view: view("failed", "environment_error", { stage: 2 }), entries: [{ id: 1, ts: at(30), runId: "r", role: "executor", provider: "claude", turnId: "t1", kind: "turn_finished", text: "failed" },
    { id: 2, ts: at(30), runId: "r", role: "executor", provider: "claude", turnId: "t1", kind: "error", text: "Error: API rate limit reached\nat runTurn (claude:1:4412)" },
    { id: 3, ts: at(30), runId: "r", role: "executor", provider: "claude", turnId: "t1", kind: "process_exited", text: "", detail: { code: 1 } }], onMac: true };
};

const combos = BEFORE ? [{ name: "before", patch: { palette: "sand", canvasColor: "theme" } }]
  : ["sand", "bay"].map((t) => ({ name: t, patch: { palette: t, canvasColor: "theme" } }));
const laptop = (app) => app.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: Number(arg("height") ?? 900), deviceScaleFactor: 1, mobile: false });
let app;
try {
  app = await launch({ userData: D("user-data"), providers, port: PORT, shots: OUT });
  await laptop(app);
  await app.waitFor(`${q(".workspace")} && true`, "window", 30_000);
  const appUrl = await app.ev("location.href");
  const settle = async (patch) => {
    await app.ev(`window.canvasTTY.settings.update(${JSON.stringify({ homeAccentPreset: "theme", onboardingDismissed: true, uiScale: 1, ...patch })}).then(() => true)`);
    await app.call("Page.reload", {}); await sleep(1500); await laptop(app);
    await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas after reload", 30_000);
    await app.key("Home", "Home", 36); await sleep(1200);
  };
  const shot = async (name, screen) => { await sleep(1800); await app.shot(`${name}-${screen}`); };

  if (ONLY !== "fixtures") {
    await createAgent(app, "Агент Codex (лид)", node);
    await createAgent(app, "Агент Claude (исполнитель)", node);
    await app.key("Home", "Home", 36); await sleep(1200);
    const cs = await canvasState(app);
    const lead = cs.agents.find((a) => a.provider === "codex"), exec = cs.agents.find((a) => a.provider === "claude");
    await app.reveal(`document.querySelector('[data-agent-id="${exec.agentId}"]')`);
    await app.drag(await app.center(`document.querySelector('[data-agent-id="${lead.agentId}"] .agent-card__port')`), await app.center(`document.querySelector('[data-agent-id="${exec.agentId}"] .agent-card__body')`), 20);
    await app.waitFor(`window.canvasTTY.orchestration.canvas().then((r) => r.value.links.length === 1)`, "link");
    const linkId = (await canvasState(app)).links[0].linkId;
    await startGoal(app, linkId, { reviewPlan: true });
    await app.waitFor(`${q(".orch-panel__status--paused")} && true`, "paused on plan review", 90_000);
    await app.clickEl(q(".orch-panel__close"));
    const open = async () => { await app.clickEl(byText(`[data-agent-link-id="${linkId}"] button`, "Открыть запуск")); await app.waitFor(`${q(".orch-panel")} && true`, "the run panel"); };
    const stage = async (label) => {
      for (const c of combos) { await settle(c.patch); await open(); await shot(c.name, `live-${label}`); await app.clickEl(q(".orch-panel__close")); }
      if (!BEFORE) { await settle({ palette: "sand", canvasColor: "theme", uiScale: 1.25 }); await open(); await shot("sand-scale125", `live-${label}`); await app.clickEl(q(".orch-panel__close")); }
    };
    await stage("plan-review");
    await settle({ palette: "sand", canvasColor: "theme" });
    await open();
    await app.clickEl(q("[data-orch-primary]")); // the main button: continue
    await app.waitFor(`${q(".orch-panel__status--completed")} && true`, "run completed", 90_000);
    await app.clickEl(q(".orch-panel__close"));
    await stage("completed");
  }

  if (ONLY !== "live") {
    const render = await renderer();
    const css = pathToFileURL(cssFile()).href;
    const page = (html, theme, scale) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="${css}"></head>
<body style="margin:0"><div class="app app--${theme} app--macos" style="--ui-scale:${scale};position:fixed;inset:0"><div class="workspace" style="position:absolute;inset:0">${html}</div></div></body></html>`;
    const draw = async (name, html, theme, scale) => {
      const f = D(`page-${name}.html`);
      fs.writeFileSync(f, page(html, theme, scale));
      await app.call("Page.navigate", { url: pathToFileURL(f).href });
      await sleep(900);
      await shot(`${theme}${scale === 1 ? "" : "-scale125"}`, `fx-${name}`);
    };
    const bundleJs = fs.existsSync(D("panel.js")) ? null : await browserBundle();
    if (bundleJs) fs.writeFileSync(D("panel.js"), bundleJs);
    const drawLive = async (name, f, theme, scale) => {
      const file = D(`page-live-${name}.html`);
      const api = `const ok = (value) => Promise.resolve({ ok: true, value }); const none = () => Promise.resolve({ ok: false, error: { code: "fixture" } });
        window.__fxApi = new Proxy({}, { get: () => new Proxy({ take: () => ok(${JSON.stringify(TAKE)}), changes: () => ok(${JSON.stringify(CHANGES)}) }, { get: (t, k) => t[k] ?? none }) });`;
      fs.writeFileSync(file, `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="${css}"></head>
<body style="margin:0"><div class="app app--${theme} app--macos" style="--ui-scale:${scale};position:fixed;inset:0"><div class="workspace" style="position:absolute;inset:0"><div id="root"></div></div></div>
<script>${api}</script><script src="${pathToFileURL(D("panel.js")).href}"></script><script>window.__mount(${JSON.stringify(render.props(f))});</script></body></html>`);
      await app.call("Page.navigate", { url: pathToFileURL(file).href });
      await app.waitFor(`document.querySelector(".orch-panel") && !document.body.innerText.includes("Загрузка")`, `${name}: the panel without «Загрузка…»`, 15_000);
      await sleep(600);
      await shot(`${theme}${scale === 1 ? "" : "-scale125"}`, `fx-${name}`);
    };
    const todo = FORMS ? STATES.filter((s) => FORM_STATES.includes(s[0])) : BEFORE ? STATES.filter((s) => ["02-awaiting-answer", "07-limit-reached", "10-person-decision", "17-completed"].includes(s[0])) : STATES;
    for (const theme of BEFORE ? ["sand"] : THEMES) {
      for (const s of todo) {
        if (LIVE_FIXTURES.includes(s[0])) {
          try { await drawLive(s[0], fixtureOf(s), theme, 1); } catch (e) { console.error(`[shots-r3b] ${s[0]} not drawn: ${e.message}`); }
          continue;
        }
        let html;
        try { html = render(fixtureOf(s)); } catch (e) { console.error(`[shots-r3b] ${s[0]} not drawn: ${e.message}`); continue; }
        await draw(s[0], html, theme === "sand" && BEFORE ? "sand" : theme, 1);
      }
    }
    if (!BEFORE && !FORMS) { // mock-up 13, "Поле Уточнить в зоне действия": the working run with the field open
      const f = fixtureOf(STATES[0]);
      const html = render(f).replace(/<section[^>]*data-orch-summary[\s\S]*?<\/section>/, render.clarifyOpen(f));
      await draw("13-clarify", html, "sand", 1);
    }
    if (!BEFORE) for (const name of FORMS ? FORM_STATES : ["07-limit-reached", "10-person-decision", "11-coverage-lost", "05-checks-decision"]) {
      const s = STATES.find((x) => x[0] === name);
      await draw(name, render(fixtureOf(s)), "sand", 1.25);
    }
    await app.call("Page.navigate", { url: appUrl });
  }
  console.log(`[shots-r3b] done into ${OUT}`);
} catch (error) {
  await app?.shot("failure").catch(() => {});
  console.error(String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  await app?.stop().catch(() => {});
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
