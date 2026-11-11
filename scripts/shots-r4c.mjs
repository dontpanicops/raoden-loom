// Frames of stage R4c: the board (tasks, the import report plate, the autopilot's form) and the goal dialog (--ui-scale 1, 1.25).
// Live window with fake CLIs (no model); the themes are set through settings (sand, bay; paper and frost take their tokens from R4 part 2).
// Needs `npm run build` first. Usage: node scripts/shots-r4c.mjs --out <dir> [--themes sand,bay,paper,frost]
import fs from "node:fs";
import path from "node:path";
import { FIXTURES, NODE, canvasState, card, createAgent, launch, q, sleep, waitForValue, workspace } from "./orchestration-app-kit.mjs";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
if (!arg("out")) { console.error("--out <dir> is required"); process.exit(2); }
const OUT = path.resolve(arg("out"));
fs.mkdirSync(OUT, { recursive: true });
const THEMES = (arg("themes") ?? "sand,bay").split(",");

const { D, project } = workspace("cto-r4cshots-");
const node = project("board-app");
const PORT = 9500 + Math.floor(Math.random() * 250);
fs.mkdirSync(D("mock-state", ".codex"), { recursive: true });
const wrap = (p) => {
  const f = D(`${p}-mock`);
  fs.writeFileSync(f, `#!/bin/sh\nexec "${NODE}" "${path.join(FIXTURES, `mock-${p}.mjs`)}" "$@"\n`, { mode: 0o755 });
  return f;
};
const PATHS = `${path.dirname(NODE)}:/usr/bin:/bin`;
const SHELL = D("login-shell");
fs.writeFileSync(SHELL, `#!/bin/sh\n[ "$1" = "-ilc" ] && shift\nexec /bin/sh -c "$1"\n`, { mode: 0o755 });
const env = (extra) => ({ HOME: D("mock-state"), MOCK_STATE: D("mock-state"), MOCK_LEDGER: D("ledger.jsonl"), ...extra });
const providers = D("providers.json");
fs.writeFileSync(providers, JSON.stringify({
  codex: { executable: wrap("codex"), version: "codex-cli 0.155.1", path: PATHS, env: env({ CODEX_HOME: D("mock-state", ".codex") }) },
  claude: { executable: wrap("claude"), version: "2.1.281 (Claude Code)", path: PATHS, env: env({}) },
  shell: SHELL, checkEnv: { PATH: PATHS, HOME: D("mock-state") }
}));
const userData = D("user-data");
const BUTTON_FILE = D("chosen", "tasks.json");
const row = (ref, over = {}) => ({ ref, project: node, title: `Задача ${ref}`, text: `Сделать ${ref}`, criteria: [`${ref} готово`], ...over });
fs.mkdirSync(path.dirname(BUTTON_FILE), { recursive: true });
fs.writeFileSync(BUTTON_FILE, JSON.stringify({ format: "board-tasks/v1", workspaceId: "common", source: "shots", tasks: [
  row("A", { title: "Экспорт заметок в Markdown" }), row("B", { title: "Поиск по заметкам", dependsOn: ["A"] }),
  row("C", { title: "Удаление заметок" }), row("D", { title: "Модель заметки и хранилище", dependsOn: ["A"] })] }));

let app;
const settings = (patch) => app.ev(`window.canvasTTY.settings.update(${JSON.stringify({ onboardingDismissed: true, uiScale: 1, ...patch })}).then(() => true)`);
async function frame(name, selectors) { // a clip of the union of the elements, twice the pixels
  const r = await app.ev(`(() => { const els = ${JSON.stringify(selectors)}.map((s) => document.querySelector(s)).filter(Boolean).map((e) => e.getBoundingClientRect());
    const x = Math.min(...els.map((b) => b.left)), y = Math.min(...els.map((b) => b.top)); return { x, y, width: Math.max(...els.map((b) => b.right)) - x, height: Math.max(...els.map((b) => b.bottom)) - y }; })()`);
  const shot = await app.call("Page.captureScreenshot", { format: "png", clip: { ...r, scale: 2 } });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.data, "base64"));
}

try {
  app = await launch({ userData, providers, port: PORT, shots: D("shots"), env: { CANVASTTY_USER_DATA_DIR: userData, CANVASTTY_SMOKE_IMPORT_FILE: BUTTON_FILE } });
  await app.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await app.waitFor(`${q(".workspace")} && true`, "window", 30_000);
  await settings({ canvasColor: "theme" });
  await app.ev(`(() => { const s = document.createElement("style"); s.textContent = "[data-onboarding] { display: none !important; }"; document.head.append(s); return true; })()`); // the first-steps card is not the subject
  await sleep(500);
  await createAgent(app, "Агент Codex (лид)", node);
  await createAgent(app, "Агент Claude (исполнитель)", node);
  const c = await canvasState(app);
  const lead = c.agents.find((a) => a.provider === "codex"), exec = c.agents.find((a) => a.provider === "claude");
  let prev = null;
  const [from, to] = await waitForValue(async () => { const e = await Promise.all([app.center(card(lead.agentId, ".agent-card__port")), app.center(card(exec.agentId, ".agent-card__body"))]);
    const still = prev && JSON.stringify(prev) === JSON.stringify(e); prev = e; return still ? e : null; }, "the cards laid out");
  await app.drag(from, to, 20);
  await app.waitFor("window.canvasTTY.orchestration.canvas().then((r) => r.value.links.length === 1)", "link");
  await app.clickEl(q("[data-board-button]"));
  await app.waitFor(`${q("[data-board]")} && true`, "the board");
  await app.clickEl(q("[data-board-import]"));
  await app.waitFor(`${q("[data-board-import-report]")} && true`, "the report");
  const linkId = (await canvasState(app)).links[0].linkId;

  // the settings reach the window by a reload (as shots-r3b does); the board is shown again after it
  const settle = async (patch) => {
    await settings(patch);
    await app.call("Page.reload", {}); await sleep(1500);
    await app.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await app.waitFor(`${q(".workspace")} && ${q("[data-board-button]")} && true`, "canvas after reload", 30_000);
    await app.ev(`(() => { const s = document.createElement("style"); s.textContent = "[data-onboarding] { display: none !important; }"; document.head.append(s); return true; })()`);
    if (!(await app.ev(`!!${q("[data-board]")}`))) await app.clickEl(q("[data-board-button]"));
    await app.waitFor(`${q("[data-board]")} && true`, "the board");
    await sleep(800);
  };
  for (const theme of THEMES) {
    await settle({ palette: theme, canvasColor: "theme" });
    await app.clickEl(q("[data-board-import]"));
    await app.waitFor(`${q("[data-board-import-report]")} && true`, "the report");
    await frame(`${theme}-board-report`, ["[data-board]", "[data-board-aside]"]);
    await app.clickEl(q("[data-board-import-close]"));
    await frame(`${theme}-board`, ["[data-board]"]);
    await app.clickEl(q("[data-board-autopilot-start]"));
    await frame(`${theme}-board-autopilot-form`, ["[data-board]"]);
    for (const uiScale of [1, 1.25]) {
      await settle({ palette: theme, uiScale });
      await app.clickEl(`[...document.querySelectorAll('[data-agent-link-id="${linkId}"] button')].find((b) => /Новая цель/.test(b.textContent))`);
      await app.waitFor(`${q(".orch-dialog textarea")} && true`, "goal dialog");
      await app.waitFor(`${q("[data-orch-profile]")}?.dataset.orchProfile !== "loading"`, "profile", 20_000);
      await app.type(`document.querySelectorAll(".orch-dialog textarea")[0]`, "Добавить заметки к задачам доски: создание, список и удаление. Хранить локально.");
      await app.type(`document.querySelectorAll(".orch-dialog textarea")[1]`, "Без новых зависимостей\nТесты на пустой список заметок");
      await app.type(q("[data-orch-commands]"), "node --test\nnpm run lint");
      await sleep(1500);
      await frame(`${theme}-goal-dialog-${uiScale}`, [".orch-dialog"]);
      await app.ev(`${q(".orch-dialog .orch-advanced")}.open = true`);
      await sleep(300);
      await frame(`${theme}-goal-dialog-${uiScale}-advanced`, [".orch-dialog"]);
    }
  }
  console.log(`frames in ${OUT}`);
} finally {
  try { await app?.quit?.(); } catch { /* the app is gone */ }
}
