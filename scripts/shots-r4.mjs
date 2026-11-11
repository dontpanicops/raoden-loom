// Frames of stage R4b: Settings -> Appearance (and two more sections) in the 4 themes, custom HOME colours,
// and the canvas with a terminal under paper/frost glass over dark/mid canvases. Real window, fake CLIs, no model.
// Needs `npm run build` first. Usage: node scripts/shots-r4.mjs --out <dir> [--only <substring of the frame name>]
import fs from "node:fs";
import path from "node:path";
import { FIXTURES, NODE, byText, canvasState, card, createAgent, launch, q, sleep, startGoal, waitForValue, workspace, JOURNAL_V2 } from "./orchestration-app-kit.mjs";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(arg("out") ?? "r4-shots");
const ONLY = arg("only");
fs.mkdirSync(OUT, { recursive: true });

const { TMP, D, project, script } = workspace("cto-r4shots-");
const PORT = 9500 + Math.floor(Math.random() * 250);
const node = project("node-app");
const termDir = fs.realpathSync(fs.mkdtempSync("/private/tmp/r4-term-"));
fs.writeFileSync(path.join(termDir, "README.md"), "demo\n");

// ---------- fake CLIs (as in smoke-native-ui) ----------
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

// ---------- the matrix ----------
const CUSTOM = { clock: "#F4C7A1", launcher: "#A8D8B9", browser: "#A9C7F0", settings: "#E3B5E8", media: "#F0E3A1" };
const THEMES = ["sand", "bay", "paper", "frost"];
const combos = [
  ...THEMES.map((t) => ({ name: `${t}-theme`, patch: { palette: t, followSystem: false, canvasColor: "theme", homeAccentPreset: "theme" }, tabs: ["appearance", "general", "notifications"] })),
  { name: "paper-custom", patch: { palette: "paper", followSystem: false, canvasColor: "night", homeAccentPreset: "custom", homeAccentColors: CUSTOM }, tabs: ["appearance"] },
  ...["paper", "frost"].flatMap((t) => ["night", "graphite", "stone"].map((c) => ({ name: `${t}-${c}`, patch: { palette: t, followSystem: false, canvasColor: c, homeAccentPreset: "theme" }, tabs: [] })))
].filter((c) => !ONLY || c.name.includes(ONLY));

const laptop = (app) => app.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
let app;
try {
  app = await launch({ userData: D("user-data"), providers, port: PORT, shots: OUT });
  await laptop(app);
  await app.waitFor(`${q(".workspace")} && true`, "window", 30_000);
  const ensureTerminal = async () => {
    if (await app.ev(`document.querySelectorAll(".terminal-card .xterm-rows").length`)) return;
    const t = await app.ev(`window.canvasTTY.terminal.create({ provider: "terminal", profile: "normal", cwd: ${JSON.stringify(termDir)}, position: { x: 500, y: 760 } })`);
    await app.waitFor(`${q(".terminal-card .xterm-rows")} && true`, "terminal drawn", 20_000);
    await sleep(800);
    const say = (s) => app.ev(`window.canvasTTY.terminal.input(${JSON.stringify(t.id)}, ${JSON.stringify(s)})`);
    await say("PS1='$ ' PROMPT='$ '; clear\r");
    await sleep(500);
    await say("printf '\\033[31mred \\033[32mgreen \\033[33myellow \\033[34mblue \\033[35mmagenta \\033[36mcyan\\033[0m\\n'; ls\r");
    await sleep(800);
  };
  const closeAll = async () => {
    for (let i = 0; i < 3; i++) {
      if (await app.ev(`!!${q(".settings-backdrop--open")}`)) { await app.key("Escape", "Escape", 27); await sleep(400); }
    }
  };
  const shot = async (name, screen) => { await sleep(500); await app.shot(`${name}-${screen}`); };

  for (const { name, patch, tabs } of combos) {
    await app.ev(`window.canvasTTY.settings.update(${JSON.stringify(patch)}).then(() => true)`);
    await app.call("Page.reload", {});
    await sleep(1500);
    await laptop(app);
    await app.waitFor(`${q(".workspace")} && true`, "canvas after reload", 30_000);
    console.log(`[shots-r4] ${name}: ${await app.ev(`${q(".app")}.className`)}`);
    await ensureTerminal();
    await closeAll();
    await app.key("Home", "Home", 36);
    await sleep(1200);
    if (!tabs.length) await shot(name, "canvas");
    if (tabs.length) {
      await app.clickEl(q(".settings-button"));
      await app.waitFor(`${q(".settings-backdrop--open")} && true`, "settings open", 10_000);
    }
    for (const tab of tabs) {
      await app.clickEl(q(`#settings-tab-${tab}`));
      await sleep(400);
      await shot(name, `settings-${tab}`);
    }
    await closeAll();
  }
  console.log(`[shots-r4] ${combos.length} combos done into ${OUT}`);
} finally {
  await app?.stop().catch(() => {});
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.rmSync(termDir, { recursive: true, force: true });
}
