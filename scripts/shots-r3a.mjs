// Frames of stage R3a (--before: the same tabs, sand, for a build of main (6b4f68e) with the eight-tab run panel); themes sand and bay, canvas colour theme.
// One finished run (fake CLIs, no model): the Summary tab with the Plan and Result sections opened, the Work tab in its three modes, the Changes tab with its badge.
// Not covered here: a newer version's run and two live runs (both need a second journal or a second held run; see the R3a notes).
// Needs `npm run build` first. Usage: node scripts/shots-r3a.mjs --out <dir> [--before]
// Frames are written as PNG (<dir>/<combo>-<screen>.png); the caller shrinks them (sips) to JPEG. --out is required: nothing is written into docs by default.
import fs from "node:fs";
import path from "node:path";
import { FIXTURES, NODE, byText, canvasState, createAgent, launch, openTab, q, sleep, startGoal, workspace, JOURNAL_V2 } from "./orchestration-app-kit.mjs";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
if (!arg("out")) { console.error("--out <dir> is required"); process.exit(2); }
const OUT = path.resolve(arg("out"));
fs.mkdirSync(OUT, { recursive: true });
const BEFORE = process.argv.includes("--before");

const { TMP, D, project, script } = workspace("cto-r3ashots-");
const PORT = 9500 + Math.floor(Math.random() * 250);
const node = project("node-app");

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

const combos = BEFORE ? [{ name: "before", patch: { palette: "sand", canvasColor: "theme" } }]
  : ["paper", "sand", "frost"].map((t) => ({ name: t, patch: { palette: t, canvasColor: "theme" } }));
const laptop = (app) => app.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
let app;
try {
  app = await launch({ userData: D("user-data"), providers, port: PORT, shots: OUT });
  await laptop(app);
  await app.waitFor(`${q(".workspace")} && true`, "window", 30_000);
  const settle = async (patch) => {
    await app.ev(`window.canvasTTY.settings.update(${JSON.stringify({ homeAccentPreset: "theme", onboardingDismissed: true, ...patch })}).then(() => true)`);
    await app.call("Page.reload", {}); await sleep(1500); await laptop(app);
    await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas after reload", 30_000);
    await app.key("Home", "Home", 36); await sleep(1200);
  };
  const shot = async (name, screen) => { await sleep(600); await app.shot(`${name}-${screen}`); };
  await createAgent(app, "Агент Codex (лид)", node);
  await createAgent(app, "Агент Claude (исполнитель)", node);
  await app.key("Home", "Home", 36); await sleep(1200);
  const cs = await canvasState(app);
  const lead = cs.agents.find((a) => a.provider === "codex"), exec = cs.agents.find((a) => a.provider === "claude");
  await app.reveal(`document.querySelector('[data-agent-id="${exec.agentId}"]')`);
  await app.drag(await app.center(`document.querySelector('[data-agent-id="${lead.agentId}"] .agent-card__port')`), await app.center(`document.querySelector('[data-agent-id="${exec.agentId}"] .agent-card__body')`), 20);
  await app.waitFor(`window.canvasTTY.orchestration.canvas().then((r) => r.value.links.length === 1)`, "link");
  const linkId = (await canvasState(app)).links[0].linkId;
  await startGoal(app, linkId);
  await app.waitFor(`${q(".orch-panel__status--completed")} && true`, "run completed", 90_000);
  await app.clickEl(q(".orch-panel__close"));

  const section = async (id) => { // the opened section at the top of the panel body
    await app.ev(`(() => { const d = ${q(`[data-orch-section="${id}"]`)}; if (d) { d.open = true; d.scrollIntoView({ block: "start" }); } return true; })()`);
  };
  for (const c of combos) {
    await settle(c.patch);
    await app.clickEl(byText(`[data-agent-link-id="${linkId}"] button`, "Открыть запуск"));
    await app.waitFor(`${q(".orch-panel")} && true`, "the run panel");
    await shot(c.name, "1-summary");
    if (BEFORE) {
      for (const [key, name] of [["plan", "2-plan"], ["result", "3-result"], ["activity", "4-activity"], ["log", "5-log"], ["history", "6-history"], ["changes", "7-changes"]]) {
        await openTab(app, key); await shot(c.name, name);
      }
    } else {
      await openTab(app, "plan"); await section("plan"); await shot(c.name, "2-summary-plan");
      await openTab(app, "result"); await section("result"); await shot(c.name, "3-summary-result");
      await openTab(app, "activity"); await shot(c.name, "4-work-feed");
      await openTab(app, "log"); await shot(c.name, "5-work-journal");
      await openTab(app, "history"); await shot(c.name, "6-work-records");
      await openTab(app, "changes"); await sleep(1500); await shot(c.name, "7-changes");
      await openTab(app, "summary"); await app.clickEl(q("[data-orch-expand]")); await sleep(800); await shot(c.name, "8-expanded"); await app.clickEl(q("[data-orch-expand]"));
    }
    await app.clickEl(q(".orch-panel__close"));
  }
  console.log(`[shots-r3a] done into ${OUT}`);
} catch (error) {
  await app?.shot("failure").catch(() => {});
  console.error(String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  await app?.stop().catch(() => {});
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
