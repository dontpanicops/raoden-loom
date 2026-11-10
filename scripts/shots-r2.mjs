// Frames of stage R2: themes sand and bay; the first-run card (nothing done, a terminal opened), the canvas with a terminal and two agent cards (card header 44px, status footer), the minimap over a card.
// The app is the real window with fake CLIs (no model); terminals and the launch dialog use a /private/tmp folder, the prompt is "$ ".
// Needs `npm run build` first. Usage: node scripts/shots-r2.mjs --out <dir>
// Frames are written as PNG (<dir>/<combo>-<screen>.png); the caller shrinks them (sips) to JPEG.
import fs from "node:fs";
import path from "node:path";
import { FIXTURES, NODE, createAgent, launch, q, sleep, workspace, JOURNAL_V2 } from "./orchestration-app-kit.mjs";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(arg("out") ?? "r2-shots");
fs.mkdirSync(OUT, { recursive: true });

const { TMP, D, project, script } = workspace("cto-r2shots-");
const PORT = 9500 + Math.floor(Math.random() * 250);
const node = project("node-app");
const termDir = fs.realpathSync(fs.mkdtempSync("/private/tmp/r2-term-"));
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

// ---------- the frames ----------
const laptop = (app) => app.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
let app;
try {
  app = await launch({ userData: D("user-data"), providers, port: PORT, shots: OUT });
  await laptop(app);
  await app.waitFor(`${q(".workspace")} && true`, "window", 30_000);
  const home = async () => { await app.key("Home", "Home", 36); await sleep(1200); };
  const shot = async (name, screen) => { await sleep(500); await app.shot(`${name}-${screen}`); };
  for (const theme of ["sand", "bay"]) {
    await app.ev(`window.canvasTTY.settings.update(${JSON.stringify({ palette: theme, canvasColor: "theme", homeAccentPreset: "theme", onboardingDismissed: false, lastDirectory: termDir })}).then(() => true)`);
    await app.call("Page.reload", {});
    await sleep(1500);
    await laptop(app);
    await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas after reload", 30_000);
    await home();
    console.log(`[shots-r2] ${theme}: onboarding steps ${await app.ev(`[...document.querySelectorAll("[data-onboarding-step]")].map((e) => e.dataset.onboardingStep + ":" + e.dataset.done).join(" ")`)}`);
    await shot(theme, "onboarding");
    // a terminal ticks step 1
    const t = await app.ev(`window.canvasTTY.terminal.create({ provider: "terminal", profile: "normal", cwd: ${JSON.stringify(termDir)}, position: { x: 500, y: 760 } })`);
    await app.waitFor(`${q(".terminal-card .xterm-rows")} && true`, "terminal drawn", 20_000);
    await sleep(800);
    const say = (x) => app.ev(`window.canvasTTY.terminal.input(${JSON.stringify(t.id)}, ${JSON.stringify(x)})`);
    await say("PS1='$ ' PROMPT='$ '; clear\r");
    await sleep(500);
    await say("printf '\\033[31mred \\033[32mgreen \\033[33myellow\\033[0m\\n'; ls\r");
    await sleep(800);
    await home();
    console.log(`[shots-r2] ${theme}: after terminal ${await app.ev(`[...document.querySelectorAll("[data-onboarding-step]")].map((e) => e.dataset.onboardingStep + ":" + e.dataset.done).join(" ")`)}`);
    await shot(theme, "onboarding-terminal");
    // Hide: the card goes and the setting is kept
    await app.clickEl(`[...document.querySelectorAll(".onboarding footer button")][0]`);
    await sleep(600);
    console.log(`[shots-r2] ${theme}: hidden -> card ${await app.ev(`!!document.querySelector("[data-onboarding]")`)} setting ${await app.ev(`window.canvasTTY.settings.get().then((s) => s.onboardingDismissed)`)}`);
    for (const id of await app.ev(`window.canvasTTY.terminal.list().then((l) => l.map((s) => s.id))`)) await app.ev(`window.canvasTTY.terminal.dispose(${JSON.stringify(id)})`);
    if (theme === "sand") {
      await app.ev(`window.canvasTTY.terminal.create({ provider: "terminal", profile: "normal", cwd: ${JSON.stringify(termDir)}, position: { x: 1100, y: 330 } })`);
      await app.waitFor(`${q(".terminal-card .xterm-rows")} && true`, "terminal drawn", 20_000);
      await createAgent(app, "Агент Codex (лид)", node);
      await createAgent(app, "Агент Claude (исполнитель)", node);
    } else {
      await app.ev(`window.canvasTTY.terminal.create({ provider: "terminal", profile: "normal", cwd: ${JSON.stringify(termDir)}, position: { x: 1100, y: 330 } })`);
      await app.waitFor(`${q(".terminal-card .xterm-rows")} && true`, "terminal drawn", 20_000);
    }
    await home();
    // the minimap over a card: the card is moved under it by its rect, then what the minimap centre hits is read
    const hit = await app.ev(`(() => { const m = document.querySelector(".canvas-minimap").getBoundingClientRect(); const x = m.left + m.width / 2, y = m.top + m.height / 2; const cards = [...document.querySelectorAll(".terminal-card, .agent-card")]; const el = document.elementFromPoint(x, y); return { overCard: cards.some((c) => { const r = c.getBoundingClientRect(); return r.left < m.right && r.right > m.left && r.top < m.bottom && r.bottom > m.top; }), topIsMinimap: !!el?.closest(".canvas-minimap") }; })()`);
    console.log(`[shots-r2] ${theme}: minimap ${JSON.stringify(hit)}`);
    await shot(theme, "canvas");
    await app.panBy({ x: -700, y: 0 });
    await sleep(600);
    await shot(theme, "cards");
    await home();
    for (const id of await app.ev(`window.canvasTTY.terminal.list().then((l) => l.map((s) => s.id))`)) await app.ev(`window.canvasTTY.terminal.dispose(${JSON.stringify(id)})`);
  }
  console.log(`[shots-r2] done into ${OUT}`);
} catch (error) {
  await app?.shot("failure").catch(() => {});
  console.error(String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  await app?.stop().catch(() => {});
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.rmSync(termDir, { recursive: true, force: true });
}
