// Frames of stage R2 (--before: the same screens, sand/theme, for a build of main without links bend, onboarding and the new card rules); themes sand and bay x canvas colours theme and linen; the first-run card (nothing done, a terminal opened), the canvas with a terminal and two agent cards (card header 44px, status footer), the minimap over a card.
// The app is the real window with fake CLIs (no model); terminals and the launch dialog use a /private/tmp folder, the prompt is "$ ".
// Needs `npm run build` first. Usage: node scripts/shots-r2.mjs --out <dir>
// Frames are written as PNG (<dir>/<combo>-<screen>.png); the caller shrinks them (sips) to JPEG.
import fs from "node:fs";
import path from "node:path";
import { FIXTURES, NODE, byText, canvasState, card, createAgent, launch, q, sleep, startGoal, workspace, JOURNAL_V2 } from "./orchestration-app-kit.mjs";

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
const BEFORE = process.argv.includes("--before");
const combos = BEFORE ? [{ name: "before", patch: { palette: "sand", canvasColor: "theme" } }]
  : ["sand", "bay"].flatMap((t) => ["theme", "linen"].map((c) => ({ name: `${t}-${c}`, patch: { palette: t, canvasColor: c } })));
const laptop = (app) => app.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const ids = (app) => app.ev(`window.canvasTTY.terminal.list().then((l) => l.map((s) => s.id))`);
let app;
try {
  app = await launch({ userData: D("user-data"), providers, port: PORT, shots: OUT });
  await laptop(app);
  await app.waitFor(`${q(".workspace")} && true`, "window", 30_000);
  const settle = async (patch) => {
    await app.ev(`window.canvasTTY.settings.update(${JSON.stringify({ homeAccentPreset: "theme", lastDirectory: termDir, ...patch })}).then(() => true)`);
    await app.call("Page.reload", {}); await sleep(1500); await laptop(app);
    await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas after reload", 30_000);
    await app.key("Home", "Home", 36); await sleep(1200);
  };
  const shot = async (name, screen) => { await sleep(500); await app.shot(`${name}-${screen}`); };
  // phase 1: the first-run card on an empty canvas (main has none; the "before" frame is the empty HOME)
  for (const c of combos) {
    await settle({ ...c.patch, onboardingDismissed: false });
    console.log(`[shots-r2] ${c.name}: onboarding ${await app.ev(`!!document.querySelector("[data-onboarding]")`)}`);
    await shot(c.name, "canvas");
  }
  // phase 2: a terminal, a note, a browser, two agents with a link and one finished run
  await settle({ ...combos[0].patch, onboardingDismissed: true, persistStickyNotes: true,
    stickyNotes: [{ id: "r2-note", text: "Заметка\nпроверить связь агентов", position: { x: 900, y: 1150 }, size: { width: 300, height: 220 } }] });
  const t = await app.ev(`window.canvasTTY.terminal.create({ provider: "terminal", profile: "normal", cwd: ${JSON.stringify(termDir)}, position: { x: 400, y: 760 } })`);
  await app.waitFor(`${q(".terminal-card .xterm-rows")} && true`, "terminal drawn", 20_000);
  await sleep(800);
  const say = (x) => app.ev(`window.canvasTTY.terminal.input(${JSON.stringify(t.id)}, ${JSON.stringify(x)})`);
  await say("PS1='$ ' PROMPT='$ '; clear\r"); await sleep(500);
  await say("printf '\\033[31mred \\033[32mgreen \\033[33myellow\\033[0m\\n'; ls\r"); await sleep(800);
  await app.ev(`window.canvasTTY.browser.open("about:blank").then(() => true)`).catch(() => {});
  await createAgent(app, "Агент Codex (лид)", node);
  await createAgent(app, "Агент Claude (исполнитель)", node);
  await app.key("Home", "Home", 36); await sleep(1200);
  const cs = await canvasState(app);
  const lead = cs.agents.find((a) => a.provider === "codex"), exec = cs.agents.find((a) => a.provider === "claude");
  await app.reveal(card(exec.agentId));
  await app.drag(await app.center(card(lead.agentId, ".agent-card__port")), await app.center(card(exec.agentId, ".agent-card__body")), 20);
  await app.waitFor(`window.canvasTTY.orchestration.canvas().then((r) => r.value.links.length === 1)`, "link");
  const linkId = (await canvasState(app)).links[0].linkId;
  let chip = false;
  if (!BEFORE) {
    try {
      await startGoal(app, linkId);
      await app.waitFor(`${q(".orch-panel__status--completed")} && true`, "run completed", 90_000);
      await app.clickEl(q(".orch-panel__close"));
      chip = true;
    } catch (e) { console.log(`[shots-r2] run not made: ${String(e).slice(0, 160)}`); }
  }
  const leadId = lead.agentId, execId = exec.agentId;
  const fit = async () => { // both agent cards in one view: zoom out and pan so their centre is mid-window
    const b = await app.ev(`(() => { const r = [...document.querySelectorAll("[data-agent-id]")].map((e) => e.getBoundingClientRect()); return { cx: (Math.min(...r.map((x) => x.left)) + Math.max(...r.map((x) => x.right))) / 2, cy: (Math.min(...r.map((x) => x.top)) + Math.max(...r.map((x) => x.bottom))) / 2 }; })()`);
    await app.panBy({ x: 720 - b.cx, y: 470 - b.cy }); await sleep(700);
  };
  for (const c of combos) {
    await settle({ ...c.patch, onboardingDismissed: true });
    if (c.name !== "before" || true) await shot(c.name, "canvas-cards-home");
    await app.reveal(card(leadId)); await fit();
    await shot(c.name, "agents-link");
    if (!BEFORE) {
      await app.ev(`window.canvasTTY.orchestration.setLinkBend(${JSON.stringify(linkId)}, null).then(() => true)`);
      await sleep(500); await shot(c.name, "link-plain");
      await app.click(...Object.values(await app.ev(`(() => { const p = document.querySelector(".agent-link__line"); const m = p.getScreenCTM(); const q = p.getPointAtLength(p.getTotalLength() * 0.3); return { x: m.a * q.x + m.e, y: m.d * q.y + m.f }; })()`)));
      await sleep(500); await shot(c.name, "link-selected");
      await app.ev(`window.canvasTTY.orchestration.setLinkBend(${JSON.stringify(linkId)}, { along: 0.1, across: 0.6 }).then(() => true)`);
      await sleep(700); await shot(c.name, "link-bent-selected");
      await app.key("Escape", "Escape", 27); await app.click(40, 880); await sleep(500);
      await shot(c.name, "link-bent");
    }
    // terminal, note, browser, agents: the cards' view, then a selected card
    await app.key("Home", "Home", 36); await sleep(900);
    await app.reveal(`document.querySelector(".terminal-card")`); await sleep(500);
    await shot(c.name, "cards-terminal");
    await app.clickEl(`document.querySelector(".terminal-card__header")`); await sleep(500);
    await shot(c.name, "card-selected");
    await app.click(40, 880);
    const noteSel = `document.querySelector("[data-sticky-note-id]")`;
    if (await app.ev(`!!${noteSel}`)) { await app.reveal(noteSel); await sleep(500); await shot(c.name, "cards-note"); }
  }
  if (!BEFORE) {
    await settle({ palette: "sand", canvasColor: "theme", homeAccentPreset: "dusk", onboardingDismissed: true });
    await shot("sand-dusk", "home");
  }
  console.log(`[shots-r2] done into ${OUT}; chip ${chip}`);
} catch (error) {
  await app?.shot("failure").catch(() => {});
  console.error(String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  await app?.stop().catch(() => {});
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.rmSync(termDir, { recursive: true, force: true });
}
