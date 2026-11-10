// Screenshot matrix of stage R0 (stage-r-redesign.md §7.3): 2 themes x (7 canvas colours + 7 HOME palettes), three screens each
// (canvas with HOME and a terminal, the open run panel, Settings -> Appearance) = 84 frames; `--before` takes the three
// "before" frames with the settings as they are (run it against a build of main). The app is the real window with fake CLIs
// (no model); the terminal opens in a /private/tmp folder with the prompt "$ ", so no user name or home path is in a frame.
// Needs `npm run build` first. Usage: node scripts/shots-r0.mjs --out <dir> [--before] [--only <substring of the frame name>]
// Frames are written as PNG (<dir>/<theme>-<canvas>-<home>-<screen>.png); the caller shrinks them (sips) to JPEG.
import fs from "node:fs";
import path from "node:path";
import { FIXTURES, NODE, byText, canvasState, card, createAgent, launch, q, sleep, startGoal, waitForValue, workspace, JOURNAL_V2 } from "./orchestration-app-kit.mjs";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(arg("out") ?? "r0-shots");
const BEFORE = process.argv.includes("--before");
const ONLY = arg("only");
fs.mkdirSync(OUT, { recursive: true });

const { TMP, D, project, script } = workspace("cto-r0shots-");
const PORT = 9500 + Math.floor(Math.random() * 250);
const node = project("node-app");
const termDir = fs.realpathSync(fs.mkdtempSync("/private/tmp/r0-term-"));
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
const THEMES = ["sand", "bay"];
const CANVAS = ["theme", "stone", "lilac", "night", "graphite", "linen", "mist"];
const HOMES = ["theme", "pastel", "warm", "cool", "mono", "dusk", "custom"];
const CUSTOM = { clock: "#F4C7A1", launcher: "#A8D8B9", browser: "#A9C7F0", settings: "#E3B5E8", media: "#F0E3A1" };
const combos = BEFORE ? [{ name: "before", patch: null }] : [
  ...THEMES.flatMap((t) => CANVAS.map((c) => ({ name: `${t}-${c}-theme`, patch: { palette: t, canvasColor: c, homeAccentPreset: "theme" } }))),
  ...THEMES.flatMap((t) => HOMES.map((h) => ({ name: `${t}-theme-${h}`, patch: { palette: t, canvasColor: "theme", homeAccentPreset: h, homeAccentColors: CUSTOM } })))
].filter((c) => !ONLY || c.name.includes(ONLY));
// the two (theme, theme) combos are in both families: one frame set each
const seen = new Set();
const todo = combos.filter((c) => !seen.has(c.name) && seen.add(c.name));

const laptop = (app) => app.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
let app;
try {
  app = await launch({ userData: D("user-data"), providers, port: PORT, shots: OUT });
  await laptop(app);
  await app.waitFor(`${q(".workspace")} && true`, "window", 30_000);

  // an agent pair and a goal run once: the run panel then has content in every frame
  await createAgent(app, "Агент Codex (лид)", node);
  await createAgent(app, "Агент Claude (исполнитель)", node);
  const c = await canvasState(app);
  const lead = c.agents.find((a) => a.provider === "codex"), exec = c.agents.find((a) => a.provider === "claude");
  const ends = () => Promise.all([app.center(card(lead.agentId, ".agent-card__port")), app.center(card(exec.agentId, ".agent-card__body"))]);
  let prev = null;
  const [from, to] = await waitForValue(async () => {
    const [f, t] = await ends();
    const still = prev && f.x === prev[0].x && f.y === prev[0].y && t.x === prev[1].x && t.y === prev[1].y;
    prev = [f, t];
    return still ? [f, t] : null;
  }, "the cards laid out");
  await app.drag(from, to, 20);
  await app.waitFor(`window.canvasTTY.orchestration.canvas().then((r) => r.value.links.length > 0)`, "link");
  const link = (await canvasState(app)).links[0];
  await startGoal(app, link.linkId, { task: "Добавить src/note.mjs", criteria: "src/note.mjs есть\nnode --test проходит", commands: ["node --test"] });
  await app.waitFor(`window.canvasTTY.orchestration.list().then((r) => r.value.some((s) => ["completed", "paused", "failed"].includes(s.view.status)))`, "run end", 90_000);

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
      if (await app.ev(`!!${q(".orch-panel__close")}`)) await app.clickEl(q(".orch-panel__close"));
      if (await app.ev(`!!${q(".settings-backdrop--open")}`)) { await app.key("Escape", "Escape", 27); await sleep(400); }
    }
  };
  const shot = async (name, screen) => { await sleep(500); await app.shot(`${name}-${screen}`); };

  for (const { name, patch } of todo) {
    if (patch) {
      await app.ev(`window.canvasTTY.settings.update(${JSON.stringify(patch)}).then(() => true)`);
      await app.call("Page.reload", {});
      await sleep(1500);
      await laptop(app);
      await app.waitFor(`${q(".workspace")} && ${q("[data-agent-link-id]")} && true`, "canvas after reload", 30_000);
      const cls = await app.ev(`${q(".app")}.className`);
      console.log(`[shots-r0] ${name}: ${cls}`);
    }
    await ensureTerminal();
    await closeAll();
    await app.key("Home", "Home", 36); // the camera back to HOME (the agent drag panned it)
    await sleep(1200);
    await shot(name, "canvas");
    await app.clickEl(byText(`[data-agent-link-id="${link.linkId}"] button`, "Открыть запуск"));
    await app.waitFor(`${q(".orch-panel")} && true`, "run panel", 20_000);
    await shot(name, "launch");
    await closeAll();
    await app.clickEl(q(".settings-button"));
    await app.waitFor(`${q(".settings-backdrop--open")} && true`, "settings open", 10_000);
    await app.clickEl(q("#settings-tab-appearance"));
    await sleep(400);
    await shot(name, "settings");
    await closeAll();
  }
  console.log(`[shots-r0] ${todo.length} combos done into ${OUT}`);
} catch (error) {
  await app?.shot("failure").catch(() => {});
  console.error(String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  await app?.stop().catch(() => {});
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.rmSync(termDir, { recursive: true, force: true });
}
