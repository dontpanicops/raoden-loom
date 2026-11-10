// Frames of stage R1: themes sand and bay x canvas colours theme and linen (a light canvas checks the glass); per combo: the canvas
// with the title bar, workspaces strip, minimap, zoom, hints and a toast; the workspace dialog; the launch dialog (Normal and YOLO);
// the canvas context menu; the palette (Cmd+K). Sand/theme adds "Reduce transparency" (canvas and Settings -> Appearance).
// `--before` takes the same screens with the settings as they are, sand/theme (run it against a build of main 0865aa7).
// The app is the real window with fake CLIs (no model); terminals and the launch dialog use a /private/tmp folder, the prompt is "$ ".
// Needs `npm run build` first. Usage: node scripts/shots-r1.mjs --out <dir> [--before] [--only <substring of the frame name>]
// Frames are written as PNG (<dir>/<combo>-<screen>.png); the caller shrinks them (sips) to JPEG.
import fs from "node:fs";
import path from "node:path";
import { FIXTURES, NODE, byText, canvasState, card, createAgent, launch, q, sleep, startGoal, waitForValue, workspace, JOURNAL_V2 } from "./orchestration-app-kit.mjs";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(arg("out") ?? "r1-shots");
const BEFORE = process.argv.includes("--before");
const ONLY = arg("only");
fs.mkdirSync(OUT, { recursive: true });

const { TMP, D, project, script } = workspace("cto-r1shots-");
const PORT = 9500 + Math.floor(Math.random() * 250);
const node = project("node-app");
const termDir = fs.realpathSync(fs.mkdtempSync("/private/tmp/r1-term-"));
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
const combos = BEFORE ? [{ name: "before", patch: { palette: "sand", canvasColor: "theme", homeAccentPreset: "theme", lastDirectory: termDir } }] : [
  ...["sand", "bay"].flatMap((t) => ["theme", "linen"].map((c) => ({ name: `${t}-${c}`, patch: { palette: t, canvasColor: c, homeAccentPreset: "theme", lastDirectory: termDir } }))),
  { name: "sand-theme-reduce", patch: { palette: "sand", canvasColor: "theme", homeAccentPreset: "theme", reduceTransparency: true, lastDirectory: termDir }, reduce: true }
].filter((c) => !ONLY || c.name.includes(ONLY));

const laptop = (app) => app.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
let app;
try {
  app = await launch({ userData: D("user-data"), providers, port: PORT, shots: OUT });
  await laptop(app);
  await app.waitFor(`${q(".workspace")} && true`, "window", 30_000);
  await createAgent(app, "Агент Codex (лид)", node);
  await createAgent(app, "Агент Claude (исполнитель)", node);

  const sessions = () => app.ev(`window.canvasTTY.terminal.list().then((l) => l.map((s) => s.id))`);
  let mainTerm = null;
  const ensureTerminal = async () => {
    if (mainTerm && (await app.ev(`document.querySelectorAll(".terminal-card .xterm-rows").length`))) return;
    const t = await app.ev(`window.canvasTTY.terminal.create({ provider: "terminal", profile: "normal", cwd: ${JSON.stringify(termDir)}, position: { x: 500, y: 760 } })`);
    mainTerm = t.id;
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
      await app.key("Escape", "Escape", 27);
      await sleep(300);
    }
  };
  const shot = async (name, screen) => { await sleep(500); await app.shot(`${name}-${screen}`); };
  const home = async () => { await app.key("Home", "Home", 36); await sleep(1200); };
  const emptyPoint = async () => {
    const W = await app.ev("innerWidth"), H = await app.ev("innerHeight");
    for (let y = 160; y < H - 120; y += 40) for (let x = 40; x < W - 400; x += 40) if (await app.isEmpty(x, y)) return { x, y };
    throw new Error("no empty canvas point");
  };

  for (const { name, patch, reduce } of combos) {
    await app.ev(`window.canvasTTY.settings.update(${JSON.stringify(patch)}).then(() => true)`);
    await app.call("Page.reload", {});
    await sleep(1500);
    await laptop(app);
    await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas after reload", 30_000);
    console.log(`[shots-r1] ${name}: ${await app.ev(`${q(".app")}.className`)}`);
    mainTerm = null;
    await ensureTerminal();
    await closeAll();
    await home();
    // a toast: the launcher's terminal button; the extra terminal is disposed at once, the toast stays
    await app.clickEl(q(".launcher-button--terminal"));
    await sleep(350);
    for (const id of await sessions()) if (id !== mainTerm) await app.ev(`window.canvasTTY.terminal.dispose(${JSON.stringify(id)})`);
    await home();
    await shot(name, "canvas");
    await sleep(4500); // the toast is gone for the screens below

    await app.clickEl(q("[data-workspace-new]"));
    await app.waitFor(`${q("[data-ws-form]")} && true`, "workspace dialog", 10_000);
    await shot(name, "ws-dialog");
    await closeAll();

    await app.ev(`${q(".launcher-button:not(.launcher-button--terminal):not(.launcher-button--browser)")}.click()`);
    await app.waitFor(`${q(".agent-launch-dialog, .launch-dialog, [role=dialog]")} && true`, "launch dialog", 10_000);
    await shot(name, "launch-normal");
    await app.clickEl(`document.querySelectorAll(".profile-button")[1]`);
    await sleep(300);
    await shot(name, "launch-yolo");
    await closeAll();

    const p = await emptyPoint();
    await app.click(p.x, p.y, "right");
    await app.waitFor(`${q(".canvas-menu")} && true`, "context menu", 10_000);
    await shot(name, "context-menu");
    await closeAll();

    await app.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "k", code: "KeyK", windowsVirtualKeyCode: 75, modifiers: 4 });
    await app.call("Input.dispatchKeyEvent", { type: "keyUp", key: "k", code: "KeyK", windowsVirtualKeyCode: 75, modifiers: 4 });
    await app.waitFor(`${q(".canvas-command-palette")} && true`, "palette", 10_000);
    await shot(name, "palette");
    await closeAll();

    if (reduce) {
      await app.clickEl(q(".settings-button"));
      await app.waitFor(`${q(".settings-backdrop--open")} && true`, "settings open", 10_000);
      await app.clickEl(q("#settings-tab-appearance"));
      await sleep(400);
      await app.ev(`${q("#settings-panel-appearance, .settings-panel")}?.scrollTo?.(0, 0)`);
      await shot(name, "settings");
      await closeAll();
    }
  }
  console.log(`[shots-r1] ${combos.length} combos done into ${OUT}`);
} catch (error) {
  await app?.shot("failure").catch(() => {});
  console.error(String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  await app?.stop().catch(() => {});
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.rmSync(termDir, { recursive: true, force: true });
}
