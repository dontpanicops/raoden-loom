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
  ["01-working", null, { running: { stage: 1, permission: null } }],
  ["02-awaiting-answer", "awaiting_answer"],
  ["03-permission", null, { running: { stage: 1, permission, pendingPermissions: 1 } }],
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
  ["18-failed", null, { failed: true }]
];
const { fixture, view } = await import(pathToFileURL(path.join(ROOT, "tests/fixtures/orchestration/zone-sets.mjs")).href);
const { legacyView } = await import(pathToFileURL(path.join(ROOT, "src/renderer/src/features/orchestration/panelTabs.ts")).href);

async function renderer() { // the built RunPanel to static markup (as tests/orchestration-action-zone-render.test.mjs does)
  const out = await requireApp("esbuild").build({
    entryPoints: [path.join(ROOT, "src/renderer/src/features/orchestration/RunPanel.tsx")], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent",
    loader: { ".svg": "dataurl", ".png": "dataurl", ".ico": "dataurl", ".webp": "dataurl", ".jpg": "dataurl" },
    plugins: [{ name: "same-react", setup(b) { b.onResolve({ filter: /^react(\/.*)?$/ }, (a) => ({ path: requireApp.resolve(a.path), external: true })); } }]
  });
  const file = D("run-panel.cjs");
  const mod = new Module(file);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(ROOT);
  mod._compile(out.outputFiles[0].text, file);
  const React = requireApp("react");
  const { renderToStaticMarkup } = requireApp("react-dom/server");
  return (f) => {
    const v = { ...f.view };
    if (v.progress) v.progress = { mode: "autopilot", checks: [], finish: [], ...v.progress };
    return renderToStaticMarkup(React.createElement(mod.exports.RunPanel, {
      orch: { runs: { r: { view: v, open: true, seq: 9, tick: 0 } }, activity: { r: { entries: f.entries, gaps: [], firstId: f.entries[0]?.id ?? 0, status: "ready", resyncs: 0 } },
        runErrors: {}, canvas: { links: [], agents: [] }, journals: { r: { records: [], next: 0, status: "ready" } }, texts: {},
        commands: { pending: () => [] }, catalog: { checks: [] }, loadText() {}, syncJournal() {}, retry() {}, stageTitles: () => ({}) },
      runId: "r", locale: "ru", panel: { linkId: "L", mode: "feed", ...legacyView("overview"), role: "lead", focus: 1 }, onClose() {}, onNewGoal() {}, onView() {},
      onProjectSettings: () => {}
    }));
  };
}
const cssFile = () => { const dir = path.join(ROOT, "out/renderer/assets"); return path.join(dir, fs.readdirSync(dir).find((f) => /^index-.*\.css$/.test(f))); };
const fixtureOf = ([, set, o]) => {
  if (set === "awaiting_answer") return { view: view("paused", "awaiting_answer", { stage: 1, permission: { ...permission, kind: "question", tool: "AskUserQuestion", summary: "Где хранить заметки?", detail: null, options: [],
    questions: [{ id: "q1", question: "Где хранить заметки: в SQLite (~/.loom/notes.db) или JSON-файлами в папке проекта?", options: [], multiple: false, other: true }] } }), entries: [], onMac: true };
  if (set === "awaiting_person_decision") return { view: view("paused", set, { stage: 1, decisions: { runKey: "k".repeat(64), tree: "t".repeat(40), findings: true,
    disputed: [{ reviewTurnId: "t1", index: 0, problem: "Заметка не проверяет пустое имя", evidence: "src/note.mjs:4", paths: ["src/note.mjs"], candidates: [{ id: "F1", problem: "Пустое имя принимается", paths: ["src/note.mjs"] }] }],
    conditions: [{ id: "C2", text: "Интерфейс читаем при масштабе 1.25", stage: 1 }], proposal: null } }), entries: [], onMac: true };
  if (set === "coverage_lost") return { view: view("paused", set, { stage: 1, decisions: { runKey: "k".repeat(64), tree: "t".repeat(40), disputed: [], conditions: [], findings: false,
    proposal: { proposalTurnId: "t1", stages: [{ stage: 1, title: "Заметка", conditions: ["C1"] }], dropped: [{ id: "C2", text: "Работает без сети", covers: ["R2"], why: "лид счёл условие избыточным" }],
      dropRequirements: [], uncovered: ["R2"], findings: [{ id: "F2", condition: "C2", problem: "Нет теста на удаление заметки" }] } } }), entries: [], onMac: true };
  if (set === "awaiting_finish_confirmation") return { ...fixture(set), view: { ...fixture(set).view, confirm: { tree: "t".repeat(40), commit: "c0ffee1234567890".repeat(2).slice(0, 40), push: true, qa: true } } };
  if (set === "check_needs_permissions") return { ...fixture(set), view: { ...fixture(set).view, refused: { checkId: "c1", command: "npm test -- --runInBand && curl http://localhost:3000/health" } } };
  if (set) return fixture(set === "finish_unconfirmed" ? "awaiting_finish_confirmation" : set);
  if (o.running) return { view: view("running", null, o.running), entries: [], onMac: true };
  if (o.completed) return { view: view("completed", null, { stage: 1, completion: { kind: "confirmed" } }), entries: [], onMac: true };
  return { view: view("failed", "environment_error", { stage: 1 }), entries: [], onMac: true };
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
    const todo = FORMS ? STATES.filter((s) => FORM_STATES.includes(s[0])) : BEFORE ? STATES.filter((s) => ["02-awaiting-answer", "07-limit-reached", "10-person-decision", "17-completed"].includes(s[0])) : STATES;
    for (const theme of BEFORE ? ["sand"] : THEMES) {
      for (const s of todo) {
        let html;
        try { html = render(fixtureOf(s)); } catch (e) { console.error(`[shots-r3b] ${s[0]} not drawn: ${e.message}`); continue; }
        await draw(s[0], html, theme === "sand" && BEFORE ? "sand" : theme, 1);
      }
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
