// Frames for the mock-up conformance audit (every screen except the run panel): first-run, canvas, HOME, cards, board,
// goal dialog, overlays, settings, launch card, project settings, workspaces dialogs, canvas bits, links. 1440x900,
// sand and paper. Real window, fake CLIs, no model. A scene that cannot be taken is logged and skipped (see failed.txt).
// Needs `npm run build` first. Usage: node scripts/shots-r5.mjs --out <dir> [--themes sand,paper] [--only <scene substring>]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { FIXTURES, NODE, launch, q, sleep, waitForValue, workspace, byText, card, canvasState, createAgent } from "./orchestration-app-kit.mjs";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
if (!arg("out")) { console.error("--out <dir> is required"); process.exit(2); }
const OUT = path.resolve(arg("out"));
const THEMES = (arg("themes") ?? "sand,paper").split(",");
const ONLY = arg("only");
fs.mkdirSync(OUT, { recursive: true });

const { TMP, D, git, project } = workspace("cto-r5shots-");
const PORT = 9500 + Math.floor(Math.random() * 250);
const node = project("node-app");
const other = project("infra-app");
// R7b: a bare remote «upstream» that takes push options, for the board's push state (a task whose option names a field it has not)
const bare = D("remote.git");
git(D(), "init", "-q", "--bare", bare);
git(bare, "config", "receive.advertisePushOptions", "true");
git(node, "remote", "add", "upstream", bare);
git(node, "push", "-q", "upstream", "main:stable");
const termDir = fs.realpathSync(fs.mkdtempSync("/private/tmp/r5-term-"));
fs.writeFileSync(path.join(termDir, "README.md"), "demo\n");
fs.mkdirSync(D("mock-state", ".codex"), { recursive: true });

// A held CLI waits before the fake starts: its process exists and its turn stays active while the frame is taken.
const HOLD = { codex: D("hold-codex"), claude: D("hold-claude") };
const hold = (p, on) => (on ? fs.writeFileSync(HOLD[p], "") : fs.rmSync(HOLD[p], { force: true }));
const wrap = (p) => {
  const f = D(`${p}-mock`);
  const gate = p === "claude" ? `case "$*" in *--json-schema*) while [ -e "${HOLD[p]}" ]; do sleep 0.1; done ;; esac`
    : `case "$*" in --help*|--version*|*generate-json-schema*) ;; *) while [ -e "${HOLD[p]}" ]; do sleep 0.1; done ;; esac`;
  fs.writeFileSync(f, `#!/bin/sh\n${gate}\nexec "${NODE}" "${path.join(FIXTURES, `mock-${p}.mjs`)}" "$@"\n`, { mode: 0o755 });
  return f;
};
// scripted turns (R5h-B, D-026): the lead of the run on «project-b» asks a question (the person is needed); the board's
// first run plans, its executor is held (a task «Работает»)
const script = (p, turns) => {
  const d = D(`script-${p}`);
  fs.mkdirSync(d, { recursive: true });
  for (const [i, t] of turns.entries()) {
    fs.writeFileSync(path.join(d, `${i + 1}.json`), JSON.stringify(t.report));
    if (t.writes) fs.writeFileSync(path.join(d, `${i + 1}.writes.json`), JSON.stringify(t.writes.map(([rel, text]) => ({ rel, base64: Buffer.from(text).toString("base64") }))));
  }
  return d;
};
// R6-C (M10): the plans are well-formed (a report that does not pass the check sent the run to «отчёт не прочитан»): the
// board's run has two stages, so its executor is «Работает · этап 1 из 2»; every later plan is the same, for any run that starts
const cond = (text, covers) => ({ keep: null, text, covers, evidence: { kind: "change", check: null } });
const plan = (stages) => ({ report: { stages: stages.map(([title, task, covers]) => ({ title, task, conditions: [cond(`${task} сделано`, covers)] })), dropped: [], dropRequirements: [], question: null } });
// R12d (mock 24): the review of the board's second run (the 4th call of the lead's CLI) finds two blocking problems — «Проверка» shows them
const finding = (problem) => ({ id: null, severity: "blocking", condition: null, problem, evidence: "src/model.mjs", closeWhen: "исправлено", status: "open", paths: ["src/model.mjs"], relation: null });
const reviewBlocking = { report: { conditions: [{ id: "C1", status: "not_met", paths: [], note: "модель без миграции" }], findings: [finding("гонка при записи"), finding("нет миграции")], request: "none", question: null } };
const codexScript = script("codex", [
  plan([["Заметки в Markdown", "Добавить src/notes.mjs", ["R1"]]]), // the run on project-b (its lead asks a question first)
  ...Array.from({ length: 8 }, (_, i) => i === 2 ? reviewBlocking : plan([["Модель заметки", "Добавить src/model.mjs", ["R1"]], ["Экспорт в Markdown", "Добавить src/export.mjs", []]])) // the board's runs, a failing run
]);
fs.writeFileSync(path.join(codexScript, "1.asks.json"), JSON.stringify([{ tool: "question", question: "Какой формат экспорта поддержать первым?", options: ["Markdown", "JSON"] }]));
const claudeScript = script("claude", Array.from({ length: 6 }, (_, i) => ({ report: { summary: "Готово.", done: true }, writes: [[`src/note${i}.mjs`, "export const x = 1;\n"]] })));
// a CLI that is "found" (the launch card of an installed agent); the others stay missing (the "CLI not found" card)
const cliBin = D("cli-bin");
fs.mkdirSync(cliBin, { recursive: true });
// its window title tells the app what it does: a folder named *waiting* asks for approval, *working* works (mock 10 palette)
const installClaudeStub = () => fs.writeFileSync(path.join(cliBin, "claude"), `#!/bin/sh\ncase "$PWD" in *waiting*) printf '\\033]0;✳ Claude\\007';; *working*) printf '\\033]0;◐ Claude\\007';; esac\nexec sleep 3000\n`, { mode: 0o755 });
installClaudeStub();
const PATHS = `${path.dirname(NODE)}:/usr/bin:/bin`;
const SHELL = D("login-shell");
fs.writeFileSync(SHELL, `#!/bin/sh\n[ "$1" = "-ilc" ] && shift\nexec /bin/sh -c "$1"\n`, { mode: 0o755 });
const env = (extra) => ({ HOME: D("mock-state"), MOCK_STATE: D("mock-state"), MOCK_LEDGER: D("ledger.jsonl"), ...extra });
const providers = D("providers.json");
fs.writeFileSync(providers, JSON.stringify({
  codex: { executable: wrap("codex"), version: "codex-cli 0.155.1", path: PATHS, env: env({ MOCK_SCRIPT: codexScript, CODEX_HOME: D("mock-state", ".codex"), MOCK_CODEX_RATE_LIMITS: "1" }) },
  claude: { executable: wrap("claude"), version: "2.1.281 (Claude Code)", path: PATHS, env: env({ MOCK_SCRIPT: claudeScript }) },
  shell: SHELL, checkEnv: { PATH: PATHS, HOME: D("mock-state") }
}));
const userData = D("user-data");
const BOARD_FILE = D("chosen", "tasks.json");
const row = (ref, over = {}) => ({ ref, project: node, title: `Задача ${ref}`, text: `Сделать ${ref}`, criteria: [`${ref} готово`], ...over });
fs.mkdirSync(path.dirname(BOARD_FILE), { recursive: true });
const writeBoard = (workspaceId, tasks) => fs.writeFileSync(BOARD_FILE, JSON.stringify({ format: "board-tasks/v1", workspaceId, source: "shots", tasks }));
const firstTasks = [row("A", { title: "Экспорт заметок в Markdown" }), row("B", { title: "Поиск по заметкам", dependsOn: ["A"] }),
  row("C", { title: "Удаление заметок" }), row("D", { title: "Модель заметки и хранилище", dependsOn: ["A"] })];
writeBoard("common", firstTasks);

// the browser card shows a local page (no network in a frame)
const site = http.createServer((req, res) => { res.setHeader("content-type", "text/html; charset=utf-8");
  const light = /[?&]t=(paper|frost)/.test(req.url ?? ""); // a page of the site follows the frame's theme, as a real light site would (R12a)
  res.end(`<title>notes</title><body style='margin:0;height:100vh;display:grid;place-items:center;background:${light ? "#FBFAF7" : "#1c1a17"};color:${light ? "#6B655A" : "#a9a396"};font:14px sans-serif'>страница сайта · нативный слой</body>`); });
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const SITE = `http://localhost:${site.address().port}/notes`;
const failed = [];
let app;
let theme = "sand";
let DSF = 1; // the goal dialog is taken at 2x like the mock PNGs (inventory scene.dpr)
const laptop = () => app.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: DSF, mobile: false });
// R12o (L1): the HUD hints «F2 / ⌘K» lie over the window's top right by design (z 300); mocks 08 / 24 have none, so they are hidden for a board clip
const clipShot = async (clip) => {
  const hints = (v) => app.ev(`(() => { for (const e of document.querySelectorAll(".shortcut-hints")) e.style.visibility = ${JSON.stringify(v)}; return true; })()`);
  await hints("hidden");
  try { return await app.call("Page.captureScreenshot", { format: "png", clip }); } finally { await hints(""); }
};
const SCROLL_DIALOG = `(() => { for (const el of document.querySelectorAll(".orch-dialog *")) if (el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight; })()`;
const wanted = (name) => !ONLY || ONLY.split(",").some((x) => name.includes(x) || (x === "overlay" && name === "radial")) || (name === "board" && ONLY.split(",").some((x) => "cards-agents-working".includes(x) || x.includes("agents-working") || x.includes("link-executor-left") || x.includes("zoom-out"))); // R12n: the working agents need the board's run, so «--only cards» takes the board along // R12l: its frame is «overlay-radial», the scene is named «radial» // --only a,b: several scenes
const shot = async (name) => {
  await sleep(500);
  await measure(name);
  const z = await app.ev(`(() => { const m = document.querySelector(".workspace__scene")?.style.transform.match(/scale\\(([\\d.]+)\\)/); return m ? Number(m[1]) : null; })()`).catch(() => null);
  console.log(`[shots-r5] frame ${theme}-${name} zoom ${z}`);
  await app.shot(`${theme}-${name}`);
  // R12h: where the dialog, menu, banner or toasts stand in the frame (for the inventory's appCrop); one line per frame
  const rect = await app.ev(`(() => { const el = [...document.querySelectorAll(".orch-dialog, .launch-dialog, .canvas-command-palette, .canvas-menu, .notify-banner, .toast-stack, .radial-launcher__disc, .settings-panel--open")].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").at(-1); if (!el) return null; const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); })()`).catch(() => null);
  if (rect) fs.appendFileSync(path.join(OUT, "rects.txt"), `${theme}-${name} ${rect.join(" ")}\n`);
};
// R12l: the menus of mock 10 / 22 stand on an empty canvas (dots only): the scene (HOME, cards) is hidden while the menu is open
const emptyCanvas = (on) => app.ev(`(() => { document.getElementById("r12l-empty")?.remove(); if (${on}) { const s = document.createElement("style"); s.id = "r12l-empty"; s.textContent = ".workspace__scene { visibility: hidden !important; }"; document.head.append(s); } return true; })()`);
const esc = async () => { for (let i = 0; i < 3; i++) { await app.key("Escape", "Escape", 27); await sleep(150); } };
const hideOnboarding = () => app.ev(`(() => { if (!document.getElementById("r5-hide")) { const s = document.createElement("style"); s.id = "r5-hide"; s.textContent = "[data-onboarding] { display: none !important; }"; document.head.append(s); } return true; })()`);
// R9: computed font sizes of the visible text on the canvas cards, the board and dialogs (MEASURE=1): <out>/fonts-<theme>-<label>.json
const measure = async (label) => {
  if (!process.env.MEASURE) return;
  const rows = await app.ev(`(() => { const out = []; const seen = new Set();
    for (const root of document.querySelectorAll("[data-agent-id], [data-board], [data-board-aside], [data-canvas-layer-id], [role=dialog]")) { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode()); ) { const t = n.textContent.trim(); const e = n.parentElement; if (!t || seen.has(n) || !e) continue; seen.add(n);
        const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); if (!r.width || !r.height || cs.visibility === "hidden" || cs.display === "none" || e.closest(".xterm")) continue;
        out.push({ px: parseFloat(cs.fontSize), w: cs.fontWeight, cls: e.tagName.toLowerCase() + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\\s+/).join(".") : ""), text: t.slice(0, 50) }); } }
    return out; })()`);
  fs.writeFileSync(path.join(OUT, `fonts-${theme}-${label}.json`), JSON.stringify(rows));
};
const WS = { common: "common", alpha: null, beta: null };
const BETA_SCENES = new Set(["link-executor-left", "link-mode", "link-refused-folder"]);
const ALPHA_SCENES = new Set(["cards-agents", "goal", "cards-agents-idle", "link-repeat", "card-focus", "link-selected", "zoom-out", "board", "board-waiting", "board-push", "cards-agents-working", "board-newtask", "board-expanded"]);
// the tab of a space is clicked (the renderer follows its own state); the common canvas is the first tab
const go = async (id) => {
  const st = await app.ev(`window.canvasTTY.workspaces.get()`);
  if (st.activeId === id) return;
  const open = st.workspaces.filter((w) => !w.closed);
  await app.clickEl(`document.querySelectorAll(".workspace-bar__tab")[${open.findIndex((w) => w.id === id)}]`); await sleep(1000);
};
async function scene(name, fn) {
  if (!wanted(name)) return;
  try { if (WS.alpha) await go(BETA_SCENES.has(name) ? WS.beta : ALPHA_SCENES.has(name) ? WS.alpha : WS.common); if (name === "goal") { DSF = 2; await laptop(); } await fn(); console.log(`[shots-r5] ${theme} ${name}: ok`); }
  catch (e) {
    const msg = `${theme} ${name}: ${String(e?.message ?? e).split("\n")[0].slice(0, 200)}`;
    console.log(`[shots-r5] FAILED ${msg}`); failed.push(msg);
    try { await app.shot(`fail-${theme}-${name}`); await esc(); if (await app.ev(`!!document.querySelector(".workspace-bar__menu")`)) await app.clickEl(q("[data-workspace-menu]")); } catch { /* ignore */ }
  } finally { if (DSF !== 1) { DSF = 1; await laptop().catch(() => {}); } }
}
const settle = async (patch = {}) => {
  await app.ev(`window.canvasTTY.settings.update(${JSON.stringify({ palette: theme, followSystem: false, canvasColor: "theme", homeAccentPreset: "theme", uiScale: 1, onboardingDismissed: true, lastDirectory: termDir, homeLauncherProviders: ["codex", "claude", "qwen", "kimi"], homeLimitProviders: ["codex", "claude"], ...patch })}).then(() => true)`);
  await app.call("Page.reload", {}); await sleep(1500); await laptop();
  await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas after reload", 30_000);
  await app.key("Home", "Home", 36); await sleep(1200);
};
const meta = (key, code, keyCode) => app.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: keyCode, modifiers: 4 })
  .then(() => app.call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, modifiers: 4 })).then(() => sleep(300));
const fit = async () => {
  const b = await app.ev(`(() => { const r = [...document.querySelectorAll("[data-agent-id]")].map((e) => e.getBoundingClientRect()); return { cx: (Math.min(...r.map((x) => x.left)) + Math.max(...r.map((x) => x.right))) / 2, cy: (Math.min(...r.map((x) => x.top)) + Math.max(...r.map((x) => x.bottom))) / 2 }; })()`);
  await app.panBy({ x: 720 - b.cx, y: 470 - b.cy }); await sleep(700);
};
let world = {};
// R12a: the mocks marked «1:1» are taken at 100%: the zoom button until the scene is at scale 1, then the card is brought to the middle
const zoom100 = async (target) => {
  // R12f: the card is brought to the middle first: the zoom buttons work about the window's middle, and at 100% there is no empty canvas left to pan by
  if (target) {
    await app.reveal(target).catch(() => {}); await sleep(500);
    const c = await app.center(target).catch(() => null); // reveal leaves a card that is already on the screen where it is: it is brought to the middle by hand
    if (c) { await app.panBy({ x: Math.round(720 - c.x), y: Math.round(450 - c.y) }).catch(() => {}); await sleep(500); }
  }
  for (let i = 0; i < 6; i++) {
    const z = await app.ev(`(() => { const m = document.querySelector(".workspace__scene")?.style.transform.match(/scale\\(([\\d.]+)\\)/); return m ? Number(m[1]) : 1; })()`);
    if (z >= 0.99) break;
    await app.clickEl(`document.querySelectorAll(".canvas-controls button, .zoom-controls button")[2]`).catch(() => {}); await sleep(250);
  }
  // R12f: the buttons step by 1.22 and stop at 99.7%, a hair under 1 (the cards then keep the chrome of the zoomed-out mode, 28 / 24 instead of 44 / 33):
  // the last bit is a ctrl + wheel, its strength learnt from the first turn, until the scene is at 1.000..1.012
  const sceneZoom = () => app.ev(`(() => { const m = document.querySelector(".workspace__scene")?.style.transform.match(/scale\\(([\\d.]+)\\)/); return m ? Number(m[1]) : 1; })()`);
  let k = 0.005;
  for (let i = 0; i < 8; i++) {
    const z = await sceneZoom();
    if (z >= 1 && z < 1.012) break;
    const dy = -Math.log(1.005 / z) / k;
    await app.call("Input.dispatchMouseEvent", { type: "mouseWheel", x: 720, y: 450, deltaX: 0, deltaY: dy, modifiers: 2 }); await sleep(500);
    const z2 = await sceneZoom();
    if (Math.abs(z2 - z) > 1e-4) k = Math.log(z2 / z) / -dy;
  }
  if (target) { await app.reveal(target).catch(() => {}); await sleep(500); }
};
const pairView = async (...ids) => {
  const b = await app.ev(`(() => { const r = ${JSON.stringify(ids)}.map((id) => document.querySelector('[data-agent-id="' + id + '"]')?.getBoundingClientRect()).filter(Boolean);
    return { cx: (Math.min(...r.map((x) => x.left)) + Math.max(...r.map((x) => x.right))) / 2, cy: (Math.min(...r.map((x) => x.top)) + Math.max(...r.map((x) => x.bottom))) / 2 }; })()`);
  await app.panBy({ x: 720 - b.cx, y: 470 - b.cy }); await sleep(700);
};
// R12t (mock 03, gate S10): the Home view of mock 03: HOME's panel in the top-left corner (25, 113), its first slot 16 px inside; the canvas of
// the world is laid out in screen px of this view, so the frame is taken in the same one
const homeView = async () => {
  await app.key("Home", "Home", 36); await sleep(900);
  const slotAt = () => app.ev(`(() => { const r = document.querySelector(".home-widget-slot").getBoundingClientRect(); return { x: r.left, y: r.top }; })()`);
  for (let i = 0; i < 3; i++) { // a drag loses a few px to its threshold: once more until it is there
    const at = await slotAt();
    if (Math.abs(41 - at.x) < 2 && Math.abs(129 - at.y) < 2) break;
    await app.panBy({ x: Math.round(41 - at.x), y: Math.round(129 - at.y) }); await sleep(700);
  }
  console.log(`[shots-r5] HOME view: slot ${JSON.stringify(await slotAt())}, scene ${await app.ev(`document.querySelector(".workspace__scene").style.transform`)}`);
};

// «plugins-list» (R12l: its own scene at the end of the run, so that the empty list of «settings-plugins» is not spoilt): installed plugins written where
// main reads them at start (userData/plugins/<id>, plugins.json), then the app is started again; canvas apps only, so that HOME and the dock stay as they are.
// The update line and the load error need main's help (not seeded). Taken away again by unseedPlugins().
const seedPlugins = () => {
  const reg = {};
  for (const [id, name, version, desc, enabled] of [["com.example.pomodoro", "Pomodoro", "1.2.0", "Таймер для работы и перерывов", true], ["com.example.agent-guard", "Agent Guard", "0.4.1", "Следит за запросами прав у агентов", false]]) {
    const dir = path.join(userData, "plugins", id);
    fs.mkdirSync(path.join(dir, "apps"), { recursive: true });
    fs.writeFileSync(path.join(dir, "apps", "main.html"), "<!doctype html><title>x</title>");
    fs.writeFileSync(path.join(dir, "canvastty.plugin.json"), JSON.stringify({ apiVersion: 1, id, name, version, description: desc, permissions: ["storage"], contributions: [{ id: "main", kind: "canvas-app", title: name, entry: "apps/main.html", defaultSize: { width: 480, height: 320 } }] }));
    reg[id] = { sourceUrl: `https://github.com/example/${id.split(".").pop()}`, enabled, installedAt: Date.now() };
  }
  // F-b (mock 26): a plugin that does not load — its manifest names a kind this version does not know; main keeps it with loadError
  const bad = "com.example.jira-sync";
  fs.mkdirSync(path.join(userData, "plugins", bad), { recursive: true });
  fs.writeFileSync(path.join(userData, "plugins", bad, "canvastty.plugin.json"), JSON.stringify({ apiVersion: 1, id: bad, name: "Jira Sync", version: "0.9.0", description: "Задачи из Jira", permissions: ["storage"], contributions: [{ id: "main", kind: "panel", title: "Jira", entry: "apps/main.html" }] }));
  reg[bad] = { sourceUrl: "https://github.com/example/jira-sync", enabled: true, installedAt: Date.now() };
  fs.writeFileSync(path.join(userData, "plugins.json"), JSON.stringify(reg));
};
// F-b: «Check for updates» answers from this file in a run (no network): the installed version by default
const RELEASE_FILE = D("release.json");
fs.writeFileSync(RELEASE_FILE, JSON.stringify({ tag_name: "v1.5.20", html_url: "https://github.com/dontpanicops/raoden-loom/releases/tag/v1.5.20" }));
const unseedPlugins = () => { fs.rmSync(path.join(userData, "plugins"), { recursive: true, force: true }); fs.rmSync(path.join(userData, "plugins.json"), { force: true }); };
const launchOpts = { userData, providers, port: PORT, shots: OUT, env: { CANVASTTY_SMOKE_CLI_DIR: cliBin, CANVASTTY_USER_DATA_DIR: userData, CANVASTTY_SMOKE_IMPORT_FILE: BOARD_FILE, CANVASTTY_SMOKE_STOP_DELAY_MS: "4000", CANVASTTY_SMOKE_RELEASE_JSON: RELEASE_FILE } };
try {
  app = await launch(launchOpts);
  await laptop();
  await app.waitFor(`${q(".workspace")} && true`, "window", 30_000);

  // ---- phase 1: first run on an empty canvas
  for (theme of THEMES) {
    await scene("firstrun", async () => {
      if (fs.existsSync(path.join(cliBin, "claude"))) fs.renameSync(path.join(cliBin, "claude"), path.join(cliBin, "claude.off")); // mock 04: no CLI found («Как установить»)
      await settle({ onboardingDismissed: false, homeLimitProviders: ["codex", "qwen", "kimi", "opencode", "grok"] }); // Claude's limit row reads the real keychain: out, so «no CLI» is whole as in mock 04
      await shot("firstrun");
      // R12j (gate S7, mock 04): the card at its own width (560, the mock's 100%) needs a wider window; at 1440 it is narrower than 480 and the steps' buttons go under the text
      await app.call("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }); await sleep(1500);
      await shot("firstrun-wide");
      await laptop(); await sleep(1000);
    });
  }
  await app.ev(`window.canvasTTY.settings.update(${JSON.stringify({ homeLimitProviders: ["codex", "claude", "qwen", "kimi", "opencode", "grok"] })}).then(() => true)`);
  if (fs.existsSync(path.join(cliBin, "claude.off"))) fs.renameSync(path.join(cliBin, "claude.off"), path.join(cliBin, "claude"));

  // ---- R10 «home-mock»: the mock's own HOME (05) with the mock's own data, on a bare canvas: two limits (Codex from the fake
  // app-server; Claude's limits come from the real usage API and keychain, which a frame must not touch, so its row is as the app shows it),
  // four sessions (waiting / working / failed / free), the dock of six (Terminal, Browser, Claude, Codex, Qwen, Kimi), three terminals under HOME
  for (theme of THEMES) {
    await scene("home-mock", async () => {
      const mk = (name) => { const d = path.join(termDir, name); fs.mkdirSync(d, { recursive: true }); return d; };
      // Codex is «found» (a stub that runs the fake app-server), so its limit row reads the fake rate limits; removed after the scene
      fs.writeFileSync(path.join(cliBin, "codex"), `#!/bin/sh\nexec "${wrap("codex")}" "$@"\n`, { mode: 0o755 });
      await app.ev(`window.canvasTTY.settings.update(${JSON.stringify({ palette: theme, followSystem: false, canvasColor: "theme", homeAccentPreset: "theme", uiScale: 1, onboardingDismissed: true, lastDirectory: termDir,
        homeLauncherProviders: ["codex", "claude", "qwen", "kimi"], homeLimitProviders: ["codex", "claude"] })}).then(() => true)`);
      await app.call("Page.reload", {}); await sleep(1500); await laptop();
      await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas", 30_000);
      await hideOnboarding(); await app.key("Home", "Home", 36); await sleep(1200);
      // HOME in the top-left corner as in the mock (64, 96); the zoom is the app's own fit (0.67: the HOME sizes are made for it, D-016)
      const at = await app.ev(`(() => { const r = document.querySelector(".home-widget-slot").getBoundingClientRect(); return { x: r.left, y: r.top }; })()`);
      await app.panBy({ x: 80 - at.x, y: 112 - at.y }); await sleep(700);
      const cam = await app.ev(`(() => { const m = document.querySelector(".workspace__scene").style.transform.match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\) scale\\(([\\d.]+)\\)/); return { x: +m[1], y: +m[2], z: +m[3] }; })()`);
      const B = (sx, sy, sw, sh) => ({ position: { x: Math.round((sx - cam.x) / cam.z), y: Math.round((sy - cam.y) / cam.z) }, size: { width: Math.round(sw / cam.z), height: Math.round(sh / cam.z) } });
      const made = [];
      const sess = async (provider, name, title, bounds) => {
        const x = await app.ev(`window.canvasTTY.terminal.create({ provider: ${JSON.stringify(provider)}, profile: "normal", cwd: ${JSON.stringify(mk(name))}, position: ${JSON.stringify(bounds.position)} })`);
        await app.ev(`window.canvasTTY.terminal.setBounds(${JSON.stringify(x.id)}, ${JSON.stringify(bounds)})`);
        await app.ev(`window.canvasTTY.terminal.rename(${JSON.stringify(x.id)}, ${JSON.stringify(title)}).then(() => true)`);
        made.push(x.id); return x;
      };
      const top = Math.round(cam.y + 7 * 90 * cam.z + 30 * cam.z);
      await sess("claude", "project-a-working", "project-a", B(cam.x, top, 330, 190));
      await sess("claude", "project-b-waiting", "project-b", B(cam.x + 350, top, 330, 190));
      const infra = await sess("terminal", "infra", "infra", B(cam.x + 700, top, 330, 190));
      const dev = await sess("terminal", "dev", "~/dev", B(cam.x + 1050, top, 330, 190));
      await sleep(1500);
      await app.ev(`window.canvasTTY.terminal.input(${JSON.stringify(dev.id)}, ${JSON.stringify("PS1='$ ' PROMPT='$ '; clear\r")})`); // no user name in the prompt
      await app.ev(`window.canvasTTY.terminal.input(${JSON.stringify(infra.id)}, ${JSON.stringify("PS1='$ ' PROMPT='$ '; clear; echo \"Error: ENOENT: no such file, open '.env.production'\"; exit 1\r")})`);
      await sleep(3500);
      await shot("home-mock");
      // the dock is the person's own list: «+» opens the agents not on it, a click adds one (the row wraps), a tile shows «×» under the pointer
      const rect = (sel) => app.ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      let c = await rect(".launcher-button--add"); await app.mouse("mouseMoved", c.x, c.y); await app.clickEl(q(".launcher-button--add")); await sleep(500);
      await shot("home-mock-dock-menu");
      await app.clickEl(q(".launcher-add-menu__item")); await sleep(900);
      await shot("home-mock-dock-added");
      c = await rect(".launcher-cell:nth-of-type(4) .launcher-button"); await app.mouse("mouseMoved", c.x, c.y); await sleep(500);
      await shot("home-mock-dock-hover");
      await app.mouse("mouseMoved", 700, 880);
      await app.ev(`window.canvasTTY.settings.update(${JSON.stringify({ homeLauncherProviders: ["codex", "claude", "qwen", "kimi", "opencode", "hermes", "grok", "omp", "pi"], homeLimitProviders: ["codex", "claude", "qwen", "kimi", "opencode", "grok"] })}).then(() => true)`);
      // R12a (mock 20): nine agents, the second row: «+» and the first candidate until none is left
      for (let i = 0; i < 6 && await app.ev(`!!${q(".launcher-button--add")}`); i++) { await app.ev(`${q(".launcher-button--add")}.click(); true`); await sleep(400); await app.ev(`${q(".launcher-add-menu__item")}?.click(); true`); await sleep(400); } // by the DOM: a click by pointer would pan the view
      await app.mouse("mouseMoved", 700, 880); await sleep(800); await shot("home-mock-dock-nine");
      fs.rmSync(path.join(cliBin, "codex"), { force: true });
      for (const id of made) await app.ev(`window.canvasTTY.terminal.dispose(${JSON.stringify(id)}).then(() => true)`);
    });
  }

  // ---- world: terminal with a link in its output, note, two agents with a link
  await app.ev(`window.canvasTTY.settings.update(${JSON.stringify({ palette: "sand", onboardingDismissed: true, lastDirectory: termDir, persistStickyNotes: true, uiScale: 1, homeLauncherProviders: ["codex", "claude", "qwen", "kimi"], homeLimitProviders: ["codex", "claude"], // R12t: HOME as settle() has it, so the world is laid out against the HOME of the frames
    stickyNotes: [{ id: "r5-note", text: "Перед релизом: прогнать e2e оркестрации и обновить UI_CONTRACT.", position: { x: 1150, y: 900 }, size: { width: 300, height: 220 } }] })}).then(() => true)`);
  await app.call("Page.reload", {}); await sleep(1500); await laptop();
  await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas", 30_000);
  const t = await app.ev(`window.canvasTTY.terminal.create({ provider: "terminal", profile: "normal", cwd: ${JSON.stringify(termDir)}, position: { x: 400, y: 760 } })`);
  await app.waitFor(`${q(".terminal-card .xterm-rows")} && true`, "terminal drawn", 20_000);
  await sleep(800);
  const say = (x) => app.ev(`window.canvasTTY.terminal.input(${JSON.stringify(t.id)}, ${JSON.stringify(x)})`);
  await say("PS1='$ ' PROMPT='$ '; clear\r"); await sleep(500);
  await say("echo '  -> Local: http://localhost:5173/'; echo 'ready in 412 ms'\r"); await sleep(800);
  world.term = t.id;
  // ---- the mock-up's canvas (D-026, mock 03): laid out in screen pixels of the Home view (1440x900), clear of the corner slots
  await homeView();
  // R12t: the scene's translate is from the canvas's own corner, under the title bar (y 44): the screen px of the layout are taken from the window's
  const cam = await app.ev(`(() => { const sc = document.querySelector(".workspace__scene"), o = sc.parentElement.getBoundingClientRect(); const m = sc.style.transform.match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\) scale\\(([\\d.]+)\\)/); return { x: +m[1] + o.left, y: +m[2] + o.top, z: +m[3] }; })()`);
  const B = (sx, sy, sw, sh) => ({ position: { x: Math.round((sx - cam.x) / cam.z), y: Math.round((sy - cam.y) / cam.z) }, size: { width: Math.round(sw / cam.z), height: Math.round(sh / cam.z) } });
  await app.ev(`window.canvasTTY.settings.update(${JSON.stringify({
    stickyNotes: [{ id: "r5-note", text: "Перед релизом: прогнать e2e оркестрации и обновить UI_CONTRACT.", ...B(335, 655, 220, 150) }],
    browserCanvas: { ...B(785, 113, 415, 320), workspaceId: "common" }, // R12t (gate S10): mock 03's places, at the app's sizes: right of HOME (740 wide at 67%), above the region
    persistCanvasRegions: true, canvasRegions: [{ id: "r6-region", title: "Оркестрация · project-b", color: "theme", workspaceId: "common", ...B(680, 465, 520, 410) }] })}).then(() => true)`);
  await app.call("Page.reload", {}); await sleep(2500); await laptop();
  await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas", 30_000);
  const R = (c, r) => ({ position: { x: -2100 + c * 670, y: 520 + r * 420 }, size: { width: 640, height: 380 } }); // the card states, left of HOME
  const bst = await waitForValue(() => app.ev(`window.canvasTTY.browser.getState().then((s) => s?.tabs?.length ? s : null)`), "browser tab", 20_000);
  await app.ev(`window.canvasTTY.browser.navigate(${JSON.stringify(bst.tabs[0].id)}, ${JSON.stringify(SITE)}).then(() => true)`);
  await app.ev(`window.canvasTTY.terminal.setBounds(${JSON.stringify(t.id)}, ${JSON.stringify(R(0, 0))})`);
  await app.ev(`window.canvasTTY.terminal.rename(${JSON.stringify(t.id)}, "~/dev")`);
  // sessions: Claude waiting for approval / working (the stub CLI names its state by the folder), a terminal that failed
  const mkdir = (name) => { const d = path.join(termDir, name); fs.mkdirSync(d, { recursive: true }); return d; };
  const session = async (provider, name, title, bounds, workspaceId) => {
    const s = await app.ev(`window.canvasTTY.terminal.create({ provider: ${JSON.stringify(provider)}, profile: "normal", cwd: ${JSON.stringify(mkdir(name))}, position: ${JSON.stringify(bounds.position)} })`);
    await app.ev(`window.canvasTTY.terminal.setBounds(${JSON.stringify(s.id)}, ${JSON.stringify(bounds)})`);
    await app.ev(`window.canvasTTY.terminal.rename(${JSON.stringify(s.id)}, ${JSON.stringify(title)}).then(() => true)`);
    if (workspaceId) await app.ev(`window.canvasTTY.terminal.setWorkspace(${JSON.stringify(s.id)}, ${JSON.stringify(workspaceId)}).then(() => true)`);
    return s;
  };
  // R12t: two rows under HOME as in mock 03, side by side without overlap (a terminal is at least 420 x 260 on the canvas, 281 x 174 here)
  const a = await session("claude", "project-a-working", "project-a", B(25, 465, 290, 175));
  const b = await session("claude", "project-b-waiting", "project-b", B(335, 465, 290, 175));
  const infra = await session("terminal", "infra", "infra", B(25, 655, 290, 175));
  await sleep(1500);
  await app.ev(`window.canvasTTY.terminal.input(${JSON.stringify(infra.id)}, ${JSON.stringify("PS1='$ ' PROMPT='$ '; clear; for i in $(seq 1 30); do echo \"  deploy step $i ok\"; done; echo '$ npm run deploy:qa'; echo \"Error: ENOENT: no such file, open '.env.production'\"; exit 1\r")})`);
  world.mock = { a, b, infra, B };
  // two more spaces (mock 03: Альфа with work going on, Бета waiting): the badges of their tabs come from their sessions
  // F-a (mock 25): Альфа lilac (1), Бета teal (2)
  for (const [title, label] of [["Альфа", 1], ["Бета", 2]]) await app.ev(`window.canvasTTY.workspaces.create({ title: ${JSON.stringify(title)}, root: null, label: ${label}, activate: false }).then((r) => r.ok)`);
  const wsState = await app.ev(`window.canvasTTY.workspaces.get()`);
  WS.alpha = wsState.workspaces.find((w) => w.title === "Альфа").id; WS.beta = wsState.workspaces.find((w) => w.title === "Бета").id;
  const elsewhere = (x, y) => ({ position: { x, y }, size: { width: 640, height: 380 } });
  await session("claude", "alpha-working-1", "alpha-api", elsewhere(3200, 3200), WS.alpha);
  await session("claude", "alpha-working-2", "alpha-web", elsewhere(4000, 3200), WS.alpha);
  await session("claude", "beta-waiting", "beta-infra", elsewhere(3200, 3200), WS.beta);
  writeBoard(WS.alpha, firstTasks);
  // group A (the goal dialog, links): far to the left of HOME, out of every Home frame; group B (the run): next to the browser
  const mkAgent = (provider, project, bounds, workspaceId = "common") => app.ev(`window.canvasTTY.orchestration.createAgent(${JSON.stringify({ agentId: crypto.randomUUID(), provider, project, bounds, workspaceId })}).then((r) => { if (!r.ok) throw new Error(r.code); return r.value; })`);
  const far = (x, y) => ({ position: { x, y }, size: { width: 300, height: 222 } });
  const lead = await mkAgent("codex", node, far(-2300, 200), WS.alpha), exec = await mkAgent("claude", node, far(-1900, 200), WS.alpha);
  const link = await app.ev(`window.canvasTTY.orchestration.createLink(${JSON.stringify({ linkId: crypto.randomUUID(), fromAgentId: lead.agentId, toAgentId: exec.agentId })}).then((r) => { if (!r.ok) throw new Error(r.code); return r.value; })`);
  const linkId = link.linkId;
  const projB = project("project-b");
  const leadB = await mkAgent("codex", projB, B(700, 505, 210, 165)), execB = await mkAgent("claude", projB, B(975, 677, 205, 168)); // R12t: mock 03, the executor lower right
  world.groupB = (await app.ev(`window.canvasTTY.orchestration.createLink(${JSON.stringify({ linkId: crypto.randomUUID(), fromAgentId: leadB.agentId, toAgentId: execB.agentId })}).then((r) => { if (!r.ok) throw new Error(r.code); return r.value; })`)).linkId;
  await app.key("Home", "Home", 36); await sleep(800);
  // the run on project-b: its lead asks a question, so the link needs the person (the bell on the chip, «Ждёт вас»)
  const runB = (await app.ev(`window.canvasTTY.orchestration.startOnLink(${JSON.stringify({ linkId: world.groupB, requestId: crypto.randomUUID(),
    goal: { text: "Добавить заметки в проект: список и экспорт", criteria: ["node --test проходит"], checks: [], commands: ["node --test"], workMode: "project", mode: "autopilot" } })}).then((r) => { if (!r.ok) throw new Error(r.code + " " + r.message); return r.value; })`)).runId;
  await waitForValue(() => app.ev(`window.canvasTTY.orchestration.get(${JSON.stringify(runB)}).then((r) => r.value.view.permission?.kind === "question")`).then((ok) => ok || null), "the lead's question", 60_000);
  await app.key("Home", "Home", 36); await sleep(800);

  for (theme of THEMES) {
    await settle();
    // R12j (gate Z1): the site's page follows the frame's theme in the canvas frames too (a light theme had a black page)
    const siteTheme = async () => { await app.ev(`window.canvasTTY.browser.getState().then((s) => window.canvasTTY.browser.navigate(s.tabs[0].id, ${JSON.stringify(SITE + "?t=" + theme)})).then(() => true)`).catch(() => {}); await sleep(1500); };
    await scene("home-canvas", async () => { await hideOnboarding(); await siteTheme(); await homeView(); await shot("home-canvas"); });

    // the states of mock 06 (D-020): free, working (selected), waiting for approval, exited, failed; then the summary at zoom < 0.5
    await scene("cards", async () => {
      {
        const working = await session("claude", "cards-working", "project-a", R(1, 0));
        const waiting = await session("claude", "cards-waiting", "project-b", R(2, 0));
        const exited = await session("terminal", "notes-api", "notes-api", R(0, 1));
        const failed = await session("terminal", "infra-deploy", "infra", R(1, 1));
        await sleep(2000);
        const run = (s, cmd) => app.ev(`window.canvasTTY.terminal.input(${JSON.stringify(s.id)}, ${JSON.stringify(cmd + "\r")})`);
        await run(exited, "PS1='$ ' PROMPT='$ '; clear; echo 'Готово. Изменения в 2 файлах.'; exit 0");
        await run(failed, "PS1='$ ' PROMPT='$ '; clear; echo '$ npm run deploy:qa'; echo \"Error: ENOENT: no such file or directory, open '.env.production'\"; exit 1");
        world.cards = { working, waiting, exited, failed };
        await sleep(2500);
      }
      await app.key("Home", "Home", 36); await sleep(600);
      // the grid's middle: the working card (column 2, row 1) is brought to the centre, then the view moves half a row up
      await app.reveal(`document.querySelector('[data-canvas-layer-id="terminal:${world.cards.working.id}"]')`).catch((e) => console.log("[shots-r5] reveal", e.message.slice(0, 120)));
      await app.panBy({ x: 0, y: -40 }).catch(() => {}); await sleep(500);
      await shot("cards-terminal-67"); // mock 21 (67%)
      await zoom100(`document.querySelector('[data-canvas-layer-id="terminal:${world.cards.failed.id}"]')`); await shot("cards-terminal"); // mock 06 is 1:1
      await app.key("Home", "Home", 36); await sleep(600);
      await app.reveal(`document.querySelector('[data-canvas-layer-id="terminal:${world.cards.working.id}"]')`).catch(() => {}); await app.panBy({ x: 0, y: -40 }).catch(() => {}); await sleep(500);
      for (let i = 0; i < 2; i++) {
        await app.clickEl(`document.querySelectorAll(".canvas-controls button, .zoom-controls button")[1]`).catch(() => {}); await sleep(200);
        if (i === 0) { await sleep(500); await shot("cards-zoom-mid"); } // R12a (mock 21): the zoom between 100% and the summary
      }
      await app.panBy({ x: 250, y: 60 }).catch(() => {}); // HOME out of the window: nothing but the six cards under the minimap
      await sleep(600); await shot("cards-summary");
      // R12f (mock 21, 28%): two steps further out, the cards are summaries
      for (let i = 0; i < 2; i++) { await app.clickEl(`document.querySelectorAll(".canvas-controls button, .zoom-controls button")[1]`).catch(() => {}); await sleep(300); }
      await sleep(600); await shot("cards-summary-30");
      await app.key("Home", "Home", 36); await sleep(600);
      // R12f (mock 06): every state at 100% and at the mock's size 420x260, one frame per card, the card in the middle of the window
      const sized = { idle: [world.term, R(0, 0)], working: [world.cards.working.id, R(1, 0)], waiting: [world.cards.waiting.id, R(2, 0)], exited: [world.cards.exited.id, R(0, 1)], failed: [world.cards.failed.id, R(1, 1)] };
      for (const [id, r] of Object.values(sized)) await app.ev(`window.canvasTTY.terminal.setBounds(${JSON.stringify(id)}, ${JSON.stringify({ position: r.position, size: { width: 420, height: 260 } })})`);
      await sleep(600);
      const layer = (id) => `document.querySelector('[data-canvas-layer-id="terminal:${id}"]')`;
      for (const [key, [id]] of Object.entries(sized)) {
        await app.key("Home", "Home", 36); await sleep(500); await zoom100(layer(id)); await sleep(600);
        if (key === "working") { await app.clickEl(`${layer(id)}.querySelector(".terminal-card__header")`); await sleep(400); } // mock: the working card is the selected one
        await shot(`cards-terminal-${key}`);
      }
      await app.ev(`window.canvasTTY.terminal.setBounds(${JSON.stringify(world.term)}, ${JSON.stringify(R(0, 0))})`); // the ~/dev terminal stays as the later scenes know it
      await app.key("Home", "Home", 36); await sleep(600);
      for (const x of Object.values(world.cards)) await app.ev(`window.canvasTTY.terminal.dispose(${JSON.stringify(x.id)}).then(() => true)`); // the palette lists sessions: no doubles
    });
    await scene("cards-agents", async () => {
      await app.reveal(card(lead.agentId)); await fit();
      await shot("cards-agents-link");
    });
    await scene("note", async () => {
      await app.reveal(`document.querySelector("[data-sticky-note-id]")`); await sleep(500);
      // R12r (gate S9, mock 03): the note is brought to one spot of the window (its corner at 600,380), where the inventory's crop is; the line of its
      // first sentence against the card's width is logged (mock 03: .84)
      const nb = await app.ev(`(() => { const b = document.querySelector("[data-sticky-note-id]").getBoundingClientRect(); return { x: b.left, y: b.top }; })()`);
      await app.panBy({ x: Math.round(600 - nb.x), y: Math.round(380 - nb.y) }).catch(() => {}); await sleep(600);
      const nm = await app.ev(`(() => { const card = document.querySelector("[data-sticky-note-id]"), ed = card.querySelector(".sticky-note-card__editor"); const cs = getComputedStyle(ed);
        const c = document.createElement("canvas").getContext("2d"); c.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily; const r = card.getBoundingClientRect();
        return { line: +(c.measureText("Перед релизом: прогнать e2e").width / card.offsetWidth).toFixed(3), font: cs.fontSize, card: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }; })()`);
      console.log(`[shots-r5] ${theme} note line/card ${nm.line} font ${nm.font} rect ${nm.card.join(" ")}`);
      await shot("cards-note");
    });

    // overlays
    await scene("overlay-menu", async () => {
      await app.key("Home", "Home", 36); await sleep(900);
      const spot = await app.freeRect(40, 40);
      await emptyCanvas(true);
      await app.click(spot.x + 20, spot.y + 20, "right"); await sleep(500);
      await app.waitFor(`${q(".canvas-menu")} && true`, "menu");
      const launch = await app.ev(`(() => { const b = [...document.querySelectorAll(".canvas-menu [role=menuitem]")].find((e) => /Запустить/.test(e.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (launch) { await app.click(launch.x, launch.y); await sleep(600); }
      await shot("overlay-context-menu");
      await esc(); await emptyCanvas(false);
    });
    await scene("overlay-menu-agent-sub", async () => {
      // mock 22 «Как в макете»: the submenu of «Агент оркестрации ›» open
      await app.key("Home", "Home", 36); await sleep(900);
      const spot = await app.freeRect(40, 40);
      await emptyCanvas(true);
      await app.click(spot.x + 20, spot.y + 20, "right"); await sleep(500);
      await app.waitFor(`${q(".canvas-menu")} && true`, "menu");
      const row = await app.ev(`(() => { const b = [...document.querySelectorAll(".canvas-menu [role=menuitem]")].find((e) => /Агент оркестрации/.test(e.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (!row) throw new Error("no «Агент оркестрации» row in the menu");
      await app.click(row.x, row.y); await sleep(600);
      await shot("overlay-context-menu-agent-sub");
      await esc(); await emptyCanvas(false);
    });
    await scene("overlay-menu-detailed", async () => {
      // «Вид меню: Подробное» (D-037): a row per agent role instead of one «Агент оркестрации»
      await app.ev(`window.canvasTTY.settings.update({ canvasMenuStyle: "detailed" }).then(() => true)`);
      await app.call("Page.reload", {}); await sleep(1500); await laptop();
      await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas", 30_000);
      await app.key("Home", "Home", 36); await sleep(900);
      const spot = await app.freeRect(40, 40);
      await emptyCanvas(true);
      await app.click(spot.x + 20, spot.y + 20, "right"); await sleep(500);
      await app.waitFor(`${q(".canvas-menu")} && true`, "menu");
      // mock 22 highlights «Агент Codex»: the keyboard selection goes down three rows (Регион, Заметка, Запустить, Агент Codex)
      for (let i = 0; i < 3; i++) await app.key("ArrowDown", "ArrowDown", 40);
      await sleep(300);
      await shot("overlay-context-menu-detailed");
      await esc(); await emptyCanvas(false);
      await app.ev(`window.canvasTTY.settings.update({ canvasMenuStyle: "mock" }).then(() => true)`);
    });
    await scene("overlay-palette", async () => {
      await meta("k", "KeyK", 75);
      await app.waitFor(`${q(".canvas-command-palette")} && true`, "palette", 5000);
      await shot("overlay-palette"); await esc();
    });
    await scene("overlay-palette-waiting", async () => {
      // the sessions of the canvas (project-b waits, project-a works, infra failed): the palette's groups and its chips
      await meta("k", "KeyK", 75);
      await app.waitFor(`${q(".canvas-command-palette")} && true`, "palette", 5000);
      await shot("overlay-palette-waiting"); await esc();
    });
    await scene("overlay-region-menu", async () => {
      await app.key("Home", "Home", 36); await sleep(900);
      await app.waitFor(`${q("[data-canvas-region-id]")} && true`, "the region", 10_000);
      // R12r (gate S9): the region is brought to one spot of the window (its corner at 520,225, as in the crop of mock 18) and the right-click lands
      // on a point of the region itself, found from the DOM (no card, no HOME over it) — wherever the region lies on the canvas
      const REG = `document.querySelector("[data-canvas-region-id]")`;
      const b0 = await app.ev(`(() => { const b = ${REG}.getBoundingClientRect(); return { x: b.left, y: b.top }; })()`);
      await app.panBy({ x: Math.round(520 - b0.x), y: Math.round(225 - b0.y) }).catch(() => {}); await sleep(600);
      const reg = await app.ev(`(() => { const el = ${REG}; const b = el.getBoundingClientRect();
        for (const dy of [36, 60, 90, 20, 130, 180]) for (const dx of [130, 160, 200, 100, 240, 60, 300]) {
          const x = b.left + dx, y = b.top + dy; if (x < 0 || y < 50 || x >= innerWidth || y >= innerHeight) continue;
          const h = document.elementsFromPoint(x, y).find((e) => !e.classList.contains("home-zone")); if (h && el.contains(h)) return { x, y }; }
        const h = document.elementFromPoint(b.left + 130, b.top + 36); return { miss: [b.left, b.top, b.width, b.height].map(Math.round).join(","), hit: h ? h.tagName + "." + String(h.className).slice(0, 80) : null, regions: document.querySelectorAll("[data-canvas-region-id]").length }; })()`);
      if (!reg || reg.miss) throw new Error("no free point of the region " + JSON.stringify(reg));
      await app.click(reg.x, reg.y, "right");
      await app.waitFor(`${q('.canvas-menu[data-menu-kind="region"]')} && true`, "the region's menu", 10_000); await sleep(400);
      await shot("canvas-region-menu"); await esc();
    });
    // R12j (gate S7, mock 03): the one toast of the canvas, «Терминал создан»
    await scene("overlay-toast-created", async () => {
      await app.ev(`window.dispatchEvent(new CustomEvent("canvastty:toast", { detail: { message: "Терминал создан", kind: "success" } }))`);
      await sleep(600);
      await shot("overlay-toast-created");
      await app.ev(`document.querySelectorAll(".toast button[aria-label], .toast__close").forEach((b) => b.click())`).catch(() => {});
      await sleep(400);
    });
    await scene("overlay-toast", async () => {
      // the app has no source of «waiting» toasts with an action: the driver hook of App.tsx (inert in a packaged build) shows the three states of mock 10
      await app.ev(`(() => { const t = (message, kind, action, title) => window.dispatchEvent(new CustomEvent("canvastty:toast", { detail: { message, kind, action, title } }));
        t("project-b · разрешение MCP", "waiting", "Перейти", "Claude ждёт разрешения"); t("project-c · Claude CLI, код 1", "error", "Открыть", "Запуск упал"); t("project-a · проверки прошли, ревью принято", "success", "Итог", "Запуск завершён"); return true; })()`);
      await sleep(600);
      await shot("overlay-toast");
      await app.ev(`document.querySelectorAll(".toast button[aria-label], .toast__close").forEach((b) => b.click())`).catch(() => {});
    });
    await scene("overlay-banner", async () => {
      // macOS shows no notification (unsigned build): the window's own banner, the existing mechanism — the flag, a stale record of the waiting run, and a window that is not in focus
      await app.ev(`(() => { localStorage.setItem("orch.notify.unavailable", "1"); const n = JSON.parse(localStorage.getItem("orch.notified.v1") || "{}"); n[${JSON.stringify(runB)}] = "stale"; localStorage.setItem("orch.notified.v1", JSON.stringify(n)); return true; })()`);
      await app.call("Emulation.setFocusEmulationEnabled", { enabled: false });
      await app.call("Page.reload", {}); await sleep(2500); await laptop();
      await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas", 30_000);
      try {
        console.log("[shots-r5] banner state", await app.ev(`JSON.stringify({ focus: document.hasFocus(), un: localStorage.getItem("orch.notify.unavailable"), n: localStorage.getItem("orch.notified.v1") })`));
        await app.waitFor(`${q("[data-notify-banner]")} && true`, "the banner", 15_000);
        await shot("overlay-banner");
        // mock 22 «waiting and failed together»: each its own line; the failed one is added by the driver hook (no failing run in the stand)
        await app.ev(`document.activeElement?.blur()`);
        await app.ev(`window.dispatchEvent(new CustomEvent("canvastty:banner", { detail: { runId: "r12e-failed", signal: "failed", title: "Бета · infra", body: "запуск остановлен ошибкой", place: "Бета" } }))`); await sleep(400);
        await shot("overlay-banner-two");
        // R12h (mock 10 «N запусков ждут»): a second waiting run joins the first: one line for both, the failed one stays
        await app.ev(`window.dispatchEvent(new CustomEvent("canvastty:banner", { detail: { runId: "r12h-wait2", signal: "waiting", title: "Альфа · alpha", body: "агент просит разрешения", place: "Альфа" } }))`); await sleep(500);
        await shot("overlay-banner-many");
        // mock 22 «long text»: a waiting run with the mock's long title and body alone in the banner: the container cuts the line with «…»; focus on it shows the ring
        // (the tooltip is the app's own (Term), shown on focus). R12l: the rows above are dismissed first; the text is the mock's own (the scene's run has a short one)
        await app.ev(`document.querySelectorAll("[data-notify-banner] button[aria-label]").forEach((b) => b.click())`); await sleep(400);
        await app.call("Emulation.setFocusEmulationEnabled", { enabled: true }); // R12h: a window in focus shows the ring and the tooltip (the banner is already on screen)
        await app.ev(`window.dispatchEvent(new CustomEvent("canvastty:banner", { detail: { runId: "r12l-long", signal: "waiting", title: "Ревью релиза · billing-service-monorepo", body: "агент просит разрешения на git push origin release/2026-11", place: "" } }))`); await sleep(500);
        await app.ev(`document.querySelector("[data-notify-banner] .notify-banner__item .orch-term")?.focus()`); await sleep(700);
        await shot("overlay-banner-long");
      } finally {
        await app.call("Emulation.setFocusEmulationEnabled", { enabled: true });
        await app.ev(`(() => { localStorage.removeItem("orch.notify.unavailable"); document.querySelectorAll("[data-notify-banner] button[aria-label]").forEach((b) => b.click()); return true; })()`);
      }
    });

    // settings tabs
    await scene("settings", async () => {
      // mock 16 «Основные» draws «Проверять обновления» on; the app's default is off (D-041), so the frame turns it on
      await app.clickEl(q(".settings-button"));
      await app.waitFor(`${q(".settings-backdrop--open")} && true`, "settings open", 10_000);
      await app.clickEl(q('[role="switch"][aria-label="Проверять обновления"]')); await sleep(500);
      for (const tab of ["general", "notifications", "appearance", "agents", "controls", "browser", "plugins", "about"]) {
        try {
          await app.clickEl(q(`#settings-tab-${tab}`)); await sleep(500);
          if (tab === "about") await app.ev(`(() => { document.querySelector(".about-settings__faq details")?.setAttribute("open", ""); return true; })()`);
          await shot(`settings-${tab}`);
          // below the visible part: scroll the section to its end and take it again
          const more = await app.ev(`(() => { const c = document.querySelector(".settings-panel__content"); if (!c || c.scrollHeight <= c.clientHeight + 4) return false; c.scrollTop = c.scrollHeight; return true; })()`);
          if (more) { await sleep(300); await shot(`settings-${tab}-end`); await app.ev(`(() => { document.querySelector(".settings-panel__content").scrollTop = 0; return true; })()`); }
          if (tab === "controls") {
            await app.ev(`(() => { document.querySelector(".shortcut-block")?.scrollIntoView({ block: "center" }); return true; })()`); await sleep(200);
            await app.clickEl(q(".shortcut-block .shortcut-editor .shortcut-editor__edit")); await sleep(300);
            await shot("settings-controls-capture"); await app.key("Escape", "Escape", 27); await sleep(200);
          }
        } catch (e) { failed.push(`${theme} settings-${tab}: ${String(e.message).slice(0, 120)}`); }
      }
      await app.clickEl(q("#settings-tab-general")); await sleep(300);
      await app.clickEl(q('[role="switch"][aria-label="Проверять обновления"]')); await sleep(300); // back to the default (off)
      await app.clickEl(q(".settings-panel__close")); await sleep(500);
    });

    // F-b: «Check for updates» finds a newer version: «Доступна версия X · Открыть страницу» (the answer comes from RELEASE_FILE)
    await scene("settings-update", async () => {
      fs.writeFileSync(RELEASE_FILE, JSON.stringify({ tag_name: "v1.6.0", html_url: "https://github.com/dontpanicops/raoden-loom/releases/tag/v1.6.0" }));
      await app.clickEl(q(".settings-button"));
      await app.waitFor(`${q(".settings-backdrop--open")} && true`, "settings open", 10_000);
      await app.clickEl(q("#settings-tab-about")); await sleep(500);
      await app.clickEl(q("[data-update-check]"));
      await app.waitFor(`${q('[data-update-status="available"]')} && true`, "the update line", 10_000);
      await shot("settings-about-update");
      await app.clickEl(q(".settings-panel__close")); await sleep(500);
      fs.writeFileSync(RELEASE_FILE, JSON.stringify({ tag_name: "v1.5.20" }));
    });

    // launch card
    await scene("launch-card", async () => {
      await app.key("Home", "Home", 36); await sleep(800);
      const btns = await app.ev(`[...document.querySelectorAll(".launcher-button")].map((b, i) => ({ i, t: b.title, cls: b.className }))`);
      console.log("[shots-r5] launcher buttons", JSON.stringify(btns));
      const click = async (re, name) => {
        const i = btns.findIndex((b) => re.test(b.t));
        if (i < 0) throw new Error(`no launcher button ${re}`);
        await app.clickEl(`document.querySelectorAll(".launcher-button")[${i}]`); await sleep(700);
        await shot(name); await esc(); await sleep(300);
      };
      await click(/Claude/, "launch-card-claude");
      await click(/Qwen/, "launch-card-missing");
    });
    await scene("launch-card-yolo", async () => {
      const i = await app.ev(`[...document.querySelectorAll(".launcher-button")].findIndex((b) => /Claude/.test(b.title))`);
      await app.clickEl(`document.querySelectorAll(".launcher-button")[${i}]`); await sleep(700);
      const yolo = await app.ev(`(() => { const e = [...document.querySelectorAll(".agent-launch-dialog label, .agent-launch-dialog button")].find((x) => /YOLO/.test(x.textContent)); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (!yolo) throw new Error("no YOLO choice");
      await app.click(yolo.x, yolo.y); await sleep(500);
      await app.clickEl(`document.querySelector(".agent-launch-dialog .danger-note__ack input")`); await sleep(300); // mock 14: the box is ticked
      await shot("launch-card-yolo"); await esc();
    });

    // workspaces
    await scene("ws-create", async () => {
      await app.clickEl(q("[data-workspace-new]")); await sleep(700);
      await app.type(q("[data-ws-title]"), "Гамма"); await sleep(300);
      await app.clickEl(q('[data-ws-label-pick="2"]')); await sleep(200); // F-a (mock 25): a label chosen
      await shot("ws-create"); await esc();
    });
    await scene("ws-dialogs", async () => {
      // make two spaces: Альфа, Бета, then dialogs on the active one
      for (const name of ["Альфа", "Бета"]) {
        if (await app.ev(`[...document.querySelectorAll(".workspace-bar__name")].some((e) => e.textContent.trim() === ${JSON.stringify(name)})`)) continue;
        await app.clickEl(q("[data-workspace-new]")); await sleep(500);
        await app.type(q("[data-ws-title]"), name);
        await app.clickEl(q("[data-ws-submit]")); await sleep(1200);
      }
      const menuOpen = () => app.ev(`!!${q(".workspace-bar__menu")}`);
      const open = async (act, name) => {
        if (!(await menuOpen())) await app.clickEl(q("[data-workspace-menu]"));
        await sleep(400);
        await app.clickEl(q(`[data-ws-action="${act}"]`)); await sleep(700);
        await shot(name); await esc(); await sleep(300);
        if (await menuOpen()) { await app.clickEl(q("[data-workspace-menu]")); await sleep(300); }
      };
      // R12p (mock 25): the rename dialog is of «Альфа», not of the common canvas; the active space is restored after
      const activeTab = await app.ev(`document.querySelector('[data-workspace-tab][aria-selected="true"]').dataset.workspaceTab`);
      await app.clickEl(`[...document.querySelectorAll("[data-workspace-tab]")].find((e) => e.querySelector(".workspace-bar__name").textContent.trim() === "Альфа")`); await sleep(700);
      await open("settings", "ws-rename");
      await app.clickEl(q(`[data-workspace-tab="${activeTab}"]`)); await sleep(700);
      await open("close", "ws-hide");
      await open("history", "ws-history");
      await open("arrange", "ws-arrange");
      await open("hidden", "ws-hidden");
      await open("remove", "ws-delete");
      await shot("ws-bar");
      if (await menuOpen()) await app.clickEl(q("[data-workspace-menu]"));
    });
    await scene("ws-dialogs-more", async () => {
      // R12h: a clean state: spaces hidden by earlier scenes or themes come back, so «Скрытые» holds only the two made here (mock 17 shows two)
      const stale = (await app.ev(`window.canvasTTY.workspaces.get()`)).workspaces.filter((x) => x.closed).map((x) => x.id);
      for (const id of stale) await app.ev(`window.canvasTTY.workspaces.reopen(${JSON.stringify(id)}).then(() => true)`);
      await sleep(600);
      // a name that is taken (the error under the field)
      // R12h (mock 17): the RENAME dialog of the active space, a name another space has
      await app.clickEl(q("[data-workspace-menu]")); await sleep(400);
      await app.clickEl(q('[data-ws-action="settings"]')); await sleep(700);
      await app.type(q("[data-ws-title]"), "Альфа"); await sleep(400);
      await app.waitFor(`${q("[data-ws-name-taken]")} && true`, "the taken name", 5000);
      await shot("ws-name-taken"); await esc(); await sleep(300);
      if (await app.ev(`!!${q(".workspace-bar__menu")}`)) await app.clickEl(q("[data-workspace-menu]"));
      // «Скрытые»: a space is made and hidden through the window, then the list of the hidden is opened
      const menuOpen = () => app.ev(`!!${q(".workspace-bar__menu")}`);
      const name = theme === "sand" ? "Гамма" : theme === "paper" ? "Дельта" : "Эпсилон";
      await app.clickEl(q("[data-workspace-new]")); await sleep(500);
      await app.type(q("[data-ws-title]"), name); await app.clickEl(q("[data-ws-submit]")); await sleep(1500);
      // mock 17 «Скрытые»: «Песочница» has work going on (the chip «1 работает»)
      const gid = (await app.ev(`window.canvasTTY.workspaces.get()`)).workspaces.find((w) => w.title === name).id;
      await app.ev(`window.canvasTTY.workspaces.update(${JSON.stringify(gid)}, { label: 3 }).then((r) => r.ok)`); // F-a (mock 25): «Песочница» pink
      await session("claude", `hidden-working-${name}`, "hidden-api", elsewhere(3200, 3200), gid); await sleep(2000);
      const hideActive = async () => {
        await app.clickEl(q("[data-workspace-menu]")); await sleep(400);
        await app.clickEl(q('[data-ws-action="close"]')); await sleep(900);
        if (await app.ev(`!!${q("[data-ws-close]")}`)) { await app.clickEl(q("[data-ws-close-hide]")); await sleep(900); }
        if (await menuOpen()) await app.clickEl(q("[data-workspace-menu]"));
      };
      await hideActive();
      // R7d (mock 17): a second hidden space with no work (no chip), the rows' buttons side by side
      const quiet = theme === "sand" ? "Архив идей" : theme === "paper" ? "Архив" : "Склад";
      await app.clickEl(q("[data-workspace-new]")); await sleep(500);
      await app.type(q("[data-ws-title]"), quiet); await app.clickEl(q('[data-ws-label-pick="5"]')); await app.clickEl(q("[data-ws-submit]")); await sleep(1500); // F-a: «Архив идей» graphite
      await hideActive();
      await app.clickEl(q("[data-workspace-menu]")); await sleep(400);
      await app.clickEl(q('[data-ws-action="hidden"]')); await sleep(700);
      await app.waitFor(`${q("[data-ws-hidden]")} && true`, "the hidden list", 5000);
      await shot("ws-hidden-list"); await esc(); await sleep(300);
      if (await menuOpen()) await app.clickEl(q("[data-workspace-menu]"));
      for (const id of stale) await app.ev(`window.canvasTTY.workspaces.close(${JSON.stringify(id)}).then(() => true)`); // the spaces of earlier scenes go back to hidden
      await sleep(500);
      // «Перенести карточку»: the context menu of a card
      await app.key("Home", "Home", 36); await sleep(700);
      await app.ev(`window.canvasTTY.terminal.rename(${JSON.stringify(t.id)}, "project-a").then(() => true)`); await sleep(400); // mock 17: «Терминал project-a»
      await app.reveal(`document.querySelector('[data-canvas-layer-id="terminal:${t.id}"]')`); await sleep(500);
      const head = await app.center(`document.querySelector('[data-canvas-layer-id="terminal:${t.id}"] header, [data-canvas-layer-id="terminal:${t.id}"] .terminal-card__header')`);
      await app.click(head.x, head.y, "right"); await sleep(500);
      await app.clickEl(`[...document.querySelectorAll(".canvas-menu [role=menuitem], .canvas-menu button")].find((e) => /Перенести в пространство/.test(e.textContent))`); await sleep(800);
      await app.waitFor(`${q("[data-ws-move]")} && true`, "the move dialog", 5000);
      await shot("ws-move"); await esc(); await sleep(300);
      await app.ev(`window.canvasTTY.terminal.rename(${JSON.stringify(t.id)}, "~/dev").then(() => true)`);
      // «Браузер открыт в…»: the browser is on the common canvas, the launcher is pressed in another space
      await go(WS.alpha);
      await app.clickEl(`document.querySelector(".launcher-button--browser")`); await sleep(900);
      await app.waitFor(`${q("[data-ws-browser-elsewhere]")} && true`, "the browser notice", 5000);
      await shot("ws-browser-elsewhere"); await esc(); await sleep(300);
      await go(WS.common);
    });
    // mock 17: the confirmation of deleting an empty space, and the window after «Остановить и скрыть»
    await scene("ws-delete", async () => {
      const menuOpen = () => app.ev(`!!${q(".workspace-bar__menu")}`);
      const name = theme === "sand" ? "Гамма-2" : theme === "paper" ? "Дельта-2" : "Эпсилон-2";
      await app.clickEl(q("[data-workspace-new]")); await sleep(500);
      await app.type(q("[data-ws-title]"), name); await app.clickEl(q("[data-ws-submit]")); await sleep(1500);
      await app.clickEl(q("[data-workspace-menu]")); await sleep(400);
      await app.clickEl(q('[data-ws-action="remove"]')); await sleep(700);
      await app.waitFor(`${q("[data-ws-delete]")} && true`, "the delete dialog", 5000);
      await shot("ws-delete-empty"); await esc(); await sleep(300);
      if (await menuOpen()) await app.clickEl(q("[data-workspace-menu]"));
      // a working session in the same space, then «Скрыть» → «Остановить и скрыть»
      const sid = (await app.ev(`window.canvasTTY.workspaces.get()`)).workspaces.find((w) => w.title === name).id;
      await session("claude", `stop-hide-${name}`, "stop-hide-api", elsewhere(3200, 3200), sid); await sleep(2000);
      await app.clickEl(q("[data-workspace-menu]")); await sleep(400);
      await app.clickEl(q('[data-ws-action="close"]')); await sleep(900);
      await app.waitFor(`${q("[data-ws-close-stop]")} && true`, "the stop button", 5000);
      // the dialog hides the space itself once everything has stopped: the frame is taken right after the click
      await app.clickEl(q("[data-ws-close-stop]")); await sleep(150);
      await shot("ws-stop-hide"); // the fake terminal stops at once: main answers 4 s late (CANVASTTY_SMOKE_STOP_DELAY_MS), so the row reads «останавливается»
      await sleep(5000);
      if (await app.ev(`!!${q("[data-ws-close-hide]")}`)) await app.clickEl(q("[data-ws-close-hide]"));
      await sleep(900);
      if (await menuOpen()) await app.clickEl(q("[data-workspace-menu]"));
    });
    // goal dialog and project settings
    await scene("goal", async () => {
      await app.reveal(card(lead.agentId)); await fit();
      await app.clickEl(byText(`[data-agent-link-id="${linkId}"] button`, "Новая цель"));
      await app.waitFor(`${q("[data-orch-requirements]")} && true`, "goal dialog");
      await app.waitFor(`${q("[data-orch-profile]")}?.dataset.orchProfile !== "loading"`, "profile", 20_000);
      await app.type(`document.querySelectorAll(".orch-dialog textarea")[0]`, "Добавить заметки к задачам доски: создание, список и удаление. Хранить локально.");
      await app.fillRows(q("[data-orch-requirements]"), "Без новых зависимостей\nТесты на пустой список заметок".split("\n"));
      await app.fillRows(q("[data-orch-commands]"), ("node --test\nnpm run lint").split("\n"));
      await sleep(2500);
      // readiness check must finish first, or the footer differs by theme (gate Z3-Z8 control)
      await app.waitFor(`!${q("[data-orch-not-ready]")}`, "readiness checked", 30_000).catch(() => console.log("[shots-r5] goal: readiness still pending"));
      await shot("goal-dialog");
      await app.ev(SCROLL_DIALOG); await sleep(400);
      await shot("goal-scrolled");
      // R12d (mock 23): «Ещё лимиты» opened with «Перепланирований» = 2, then closed again: the row names the value
      await app.clickEl(`document.querySelector(".orch-limits__more > summary")`); await sleep(300);
      await app.type(`document.querySelectorAll(".orch-limits__rare input")[1]`, "2");
      await app.ev(`document.querySelector(".orch-limits").scrollIntoView({ block: "center" })`); await sleep(400);
      await shot("goal-limits-open");
      await app.clickEl(`document.querySelector(".orch-limits__more > summary")`); await sleep(300);
      await app.ev(`document.querySelector(".orch-limits").scrollIntoView({ block: "center" })`); await sleep(300);
      await shot("goal-limits-set");
      // F-c (D-041 p. 5, mock 23): the roles row — who leads, who executes, who reviews — with its words explained
      await app.ev(`document.querySelector("[data-orch-roles]")?.scrollIntoView({ block: "center" })`); await sleep(400);
      await shot("goal-roles");
      // R12d (mock 09): «Готовность» at the top of the body: the heading, the verdict and the first rows
      await app.ev(`(() => { const h = [...document.querySelectorAll(".orch-dialog *")].find((e) => e.children.length === 0 && /^Готовность/.test(e.textContent.trim())); h?.scrollIntoView({ block: "start" }); })()`); await sleep(400);
      await shot("goal-readiness");
      await app.ev(`(() => { for (const el of document.querySelectorAll(".orch-dialog *")) el.scrollTop = 0; })()`); await sleep(200);
      const ps = await app.ev(`(() => { const b = document.querySelector(".orch-dialog [data-orch-open-settings]"); if (!b) return false; b.scrollIntoView(); b.click(); return true; })()`);
      if (!ps) { await esc(); throw new Error("no project settings button in the goal dialog"); }
      await sleep(1500);
      await shot("project-settings");
      // R12d (mock 23): the mouse rests on «Лид» (400 ms), the keyboard is on «.envrc (direnv)»: both explanations are open
      const hasLeadTerm = await app.ev(`!!document.querySelector('.orch-dialog [data-term="lead"]')`);
      if (hasLeadTerm) {
        await app.ev(`(() => { const d = document.querySelector('.orch-dialog [data-term="lead"]'); let el = d; while (el && !(el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
          if (el) el.scrollTop += d.getBoundingClientRect().top - 200; })()`); await sleep(300);
        const c = await app.center(`document.querySelector('.orch-dialog [data-term="lead"]')`);
        await app.mouse("mouseMoved", c.x, c.y); await sleep(700);
      }
      await app.ev(`document.querySelector('.orch-dialog [data-term="direnv"]')?.focus({ preventScroll: true })`); await sleep(400);
      await shot("term-hints");
      await app.ev(`document.activeElement?.blur()`);
      await app.mouse("mouseMoved", 5, 5); await sleep(300);
      // mock 15's lower half: the card «Push» at the top of the body, with «Выгрузка ревью» and «MCP» beside it
      await app.ev(`document.querySelector("[data-orch-settings-branches]")?.scrollIntoView({ block: "start" })`); await sleep(400);
      await shot("project-settings-push");
      // F-c (D-041 p. 2, mock 15): the checklist of «MCP and environment» after the environment check (the CLIs' own answers, no model)
      await app.ev(`document.querySelector("[data-orch-env-check]")?.scrollIntoView({ block: "center" })`); await sleep(300);
      await app.clickEl(`document.querySelector("[data-orch-env-check] > button")`);
      await app.waitFor(`document.querySelector("[data-orch-checklist]") !== null || document.querySelector("[data-orch-env-check]")?.dataset.orchEnvCheck === "error"`, "environment checklist", 90_000);
      await app.ev(`document.querySelector("[data-orch-env-check]")?.scrollIntoView({ block: "center" })`); await sleep(500);
      await shot("project-settings-mcp");
      await app.ev(SCROLL_DIALOG); await sleep(400);
      await shot("project-settings-scrolled");
      await esc(); await sleep(300); await esc();
    });

    // a lead without a link: the hint under the path and the port as a ring
    await scene("cards-agents-idle", async () => {
      await createAgent(app, "Агент Codex (лид)", node);
      const lone = (await canvasState(app)).agents.find((x) => x.provider === "codex" && ![lead.agentId, leadB.agentId, world.leftLead, world.modeLead].includes(x.agentId));
      await app.reveal(card(lone.agentId)); await sleep(600); await zoom100(card(lone.agentId)); await shot("cards-agents-idle");
      await app.clickEl(card(lone.agentId, ".agent-card__close")); await sleep(500);
    });

    // R6-C (M10): the states of mocks 06 and 19 — a failed run, an executor left of its lead, the linking mode, the HOME editor, a resize
    const link = (from, to) => app.ev(`window.canvasTTY.orchestration.createLink(${JSON.stringify({ linkId: crypto.randomUUID(), fromAgentId: from, toAgentId: to })}).then((r) => { if (!r.ok) throw new Error(r.code); return r.value; })`);
    await scene("link-executor-left", async () => {
      if (!world.leftLead) {
        const l = await mkAgent("codex", other, B(700, 700, 201, 149), WS.beta), e = await mkAgent("claude", other, B(420, 920, 201, 149), WS.beta) /* R12a: a clear corridor between the cards, as in mock 19 */;
        world.leftLead = l.agentId; world.leftExec = e.agentId; await link(l.agentId, e.agentId);
        // a lone lead: a free executor of its folder (lit) and one of another folder (dim, with the reason), for the linking mode
        const m = await mkAgent("codex", other, B(1000, 330, 201, 149), WS.beta);
        const fit = await mkAgent("claude", other, B(1230, 450, 201, 149), WS.beta), far = await mkAgent("claude", projB, B(1000, 560, 201, 149), WS.beta);
        world.modeLead = m.agentId; world.modeFit = fit.agentId; world.modeFar = far.agentId;
        await app.call("Page.reload", {}); await sleep(2500); await laptop();
        await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas", 30_000);
      }
      await app.key("Home", "Home", 36); await sleep(800);
      await app.waitFor(`${card(world.leftLead)} && true`, "the pair's cards", 10_000);
      // R12j (gate S7, mock 19): at 100% (the mock's), the pair alone in the middle of the window: the camera is written to the space and the window reads it again
      const stp = await canvasState(app), pb = [world.leftLead, world.leftExec].map((id) => stp.agents.find((a) => a.agentId === id).bounds);
      const px0 = Math.min(...pb.map((b) => b.position.x)), px1 = Math.max(...pb.map((b) => b.position.x + b.size.width));
      const py0 = Math.min(...pb.map((b) => b.position.y)), py1 = Math.max(...pb.map((b) => b.position.y + b.size.height));
      const wsId = (await app.ev(`window.canvasTTY.workspaces.get()`)).activeId;
      await app.ev(`window.canvasTTY.workspaces.setCamera(${JSON.stringify(wsId)}, ${JSON.stringify({ x: Math.round(720 - (px0 + px1) / 2), y: Math.round(480 - (py0 + py1) / 2), zoom: 1 })}).then(() => true)`);
      await app.call("Page.reload", {}); await sleep(2500); await laptop();
      await app.waitFor(`${q(".workspace")} && ${card(world.leftLead)} && true`, "the pair at 100%", 30_000); await sleep(800);
      await shot("link-executor-left");
      await app.key("Home", "Home", 36); await sleep(500);
    });
    // R12f (mock 18, 06): the linking mode at 100%: the lead, the lit executor and the one of another folder fit the window together (300x222 cards)
    const modeView100 = async () => {
      // the camera is written to the space (zoom 1, the three cards in the middle) and the window reads it again: no empty canvas is left to pan by at 100%
      const st = await canvasState(app), bs = [world.modeLead, world.modeFit, world.modeFar].map((id) => st.agents.find((a) => a.agentId === id).bounds);
      const x0 = Math.min(...bs.map((b) => b.position.x)), x1 = Math.max(...bs.map((b) => b.position.x + b.size.width));
      const y0 = Math.min(...bs.map((b) => b.position.y)), y1 = Math.max(...bs.map((b) => b.position.y + b.size.height));
      const active = (await app.ev(`window.canvasTTY.workspaces.get()`)).activeId;
      await app.ev(`window.canvasTTY.workspaces.setCamera(${JSON.stringify(active)}, ${JSON.stringify({ x: Math.round(720 - (x0 + x1) / 2), y: Math.round(480 - (y0 + y1) / 2), zoom: 1 })}).then(() => true)`);
      await app.call("Page.reload", {}); await sleep(2500); await laptop();
      await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas", 30_000);
      await app.waitFor(`${card(world.modeLead, ".agent-card__port")} && true`, "the lead's port", 10_000); await sleep(800);
    };
    await scene("link-mode", async () => {
      await app.key("Home", "Home", 36); await sleep(800);
      await app.waitFor(`${card(world.modeLead, ".agent-card__port")} && true`, "the lead's port", 10_000);
      await modeView100();
      // R12t (gate 18-link-mode): a mouse move without a button from the OS (the real cursor resting over the window) takes the port's pointer capture
      // and ends a mouse gesture silently (lostpointercapture) before the frame, in any theme, depending on where the cursor is. The gesture is made by a
      // touch pointer (the port is touch-action: none, the gesture is the same pointer events), which the OS mouse cannot take; it is traced, and one that
      // did not hold all the same is made again
      const touch = (type, x, y) => app.call("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
      for (let attempt = 1; ; attempt++) {
        await app.ev(`(() => { window.__canvasTTYLinkTrace = []; return true; })()`);
        const from = await app.center(card(world.modeLead, ".agent-card__port"));
        await touch("touchStart", from.x, from.y);
        for (let i = 1; i <= 8; i++) { await touch("touchMove", from.x + 18 * i, from.y + 10 * i); await sleep(40); }
        // over a free executor of the lead's folder: lit, "release to link"; the one of another folder dims, with the reason
        const fit = await app.center(card(world.modeFit, ".agent-card__body")), far = await app.center(card(world.modeFar, ".agent-card__body"));
        await touch("touchMove", fit.x, fit.y); await sleep(500); await shot("link-mode");
        await touch("touchMove", far.x, far.y); await sleep(500); await shot("link-mode-far");
        const trace = await app.ev(`window.__canvasTTYLinkTrace ?? []`);
        await touch("touchMove", 900, 820); await sleep(200);
        await touch("touchEnd", 900, 820); await sleep(300); await esc();
        if (trace.some((e) => e.step === "port.moved") && !trace.some((e) => e.step === "port.end")) break;
        console.log(`[shots-r5] ${theme} link-mode: the gesture did not hold (attempt ${attempt}): ${JSON.stringify(trace.map((e) => e.step + (e.type ? ":" + e.type : "")))}`);
        if (attempt === 4) throw new Error("the link gesture did not hold four times");
        await sleep(500);
      }
    });
    // R12a (mock 06): a link between agents of different folders is refused, the lead's card says why
    // R12a (mock 03): «Меньше прозрачности»
    await scene("reduce-transparency", async () => {
      await app.ev(`window.canvasTTY.settings.update({ reduceTransparency: true }).then(() => true)`); await sleep(900);
      await app.ev(`document.activeElement?.blur?.(), true`); // R12n: no ring on the tab that was clicked, the Home key below would show it
      await homeView(); await shot("home-canvas-reduce");
      await app.ev(`window.canvasTTY.settings.update({ reduceTransparency: false }).then(() => true)`); await sleep(500);
    });
    // R12a (mock 06): the browser under an open run panel: the page is hidden while the panel is open
    await scene("browser-hidden", async () => {
      // the page is hidden while a panel of the card (the downloads) is open: the semantic surface says so (mock 06, SPEC 11)
      await app.key("Home", "Home", 36); await sleep(700);
      await zoom100(q('[data-canvas-layer-id="browser"]')); await sleep(700);
      await app.clickEl(q('[data-canvas-layer-id="browser"] .browser-card__downloads')); await sleep(900);
      await shot("cards-browser-hidden");
      await app.clickEl(q('[data-canvas-layer-id="browser"] .browser-card__downloads')).catch(() => {}); await sleep(400);
      await app.key("Home", "Home", 36); await sleep(500);
    });
    await scene("link-refused-folder", async () => {
      await app.key("Home", "Home", 36); await sleep(800);
      await app.waitFor(`${card(world.modeLead, ".agent-card__port")} && true`, "the lead's port", 10_000);
      await modeView100();
      const from = await app.center(card(world.modeLead, ".agent-card__port"));
      await app.mouse("mouseMoved", from.x, from.y); await app.mouse("mousePressed", from.x, from.y, "left", 1);
      const far = await app.center(card(world.modeFar, ".agent-card__body"));
      for (let i = 1; i <= 8; i++) { await app.mouse("mouseMoved", from.x + (far.x - from.x) * i / 8, from.y + (far.y - from.y) * i / 8, "left", 1); await sleep(40); }
      await app.mouse("mouseReleased", far.x, far.y, "left", 0); await sleep(600);
      await shot("link-refused-folder"); await esc();
    });
    // R12a (mock 06): a card as it is, selected (level 2), with the keyboard focus (Tab, level 3)
    await scene("card-focus", async () => {
      await app.key("Home", "Home", 36); await sleep(700);
      await zoom100(card(lead.agentId)); await sleep(600); await shot("card-focus-plain");
      // R12j (gate Z1, S6): «selected» is the selection by a marquee (Shift-drag on empty canvas), not a click on the header
      const lr = await app.ev(`(() => { const r = ${card(lead.agentId)}.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; })()`);
      const mq = (type, x, y, buttons) => app.call("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: 1, modifiers: 8 });
      const [fx, fy, tx, ty] = [lr.x - 24, lr.y - 24, lr.right - 12, lr.bottom - 12];
      await mq("mouseMoved", fx, fy, 0); await mq("mousePressed", fx, fy, 1);
      for (let i = 1; i <= 10; i++) await mq("mouseMoved", fx + ((tx - fx) * i) / 10, fy + ((ty - fy) * i) / 10, 1);
      await mq("mouseReleased", tx, ty, 0); await mq("mouseMoved", 1000, 800, 0); await sleep(500);
      await app.ev(`document.activeElement?.blur()`); await sleep(300);
      await shot("card-focus-selected");
      // selected + the keyboard focus on the card itself (a key, then the focus: it is the keyboard's), then the selection is taken off by a click on empty canvas: the focus alone
      const kb = async () => { await app.key("Tab", "Tab", 9); await sleep(300); await app.ev(`${card(lead.agentId)}.focus()`); await sleep(500); };
      await kb(); await shot("card-focus-both");
      await app.click(1000, 760); await sleep(400); await esc(); await app.ev(`document.activeElement?.blur()`); await sleep(300);
      await kb(); await shot("card-focus-tab");
      await app.key("Home", "Home", 36); await sleep(300);
    });
    await scene("zoom-waiting", async () => {
      await app.key("Home", "Home", 36); await sleep(600);
      await app.reveal(card(leadB.agentId)); await sleep(500);
      for (let i = 0; i < 7; i++) { await app.clickEl(`document.querySelectorAll(".canvas-controls button, .zoom-controls button")[1]`).catch(() => {}); await sleep(150); }
      await sleep(600); await shot("zoom-waiting");
      await app.key("Home", "Home", 36); await sleep(600);
    });
    await scene("failed-popover", async () => {
      await app.key("Home", "Home", 36); await sleep(700);
      await app.ev(`document.querySelector(".usage-row__failure-trigger")?.scrollIntoView({ block: "center" })`); await sleep(300);
      await app.ev(`document.querySelector(".usage-row__failure-trigger").focus()`);
      await app.waitFor(`document.querySelector(".usage-row__failure-tooltip")?.matches(":popover-open") === true`, "the failure popover", 5000);
      await sleep(300);
      const tail = await app.ev(`document.querySelector(".usage-row__failure-details")?.textContent ?? ""`);
      if (/\/Users\/|@/.test(tail)) throw new Error("the popover tail shows a prompt or a path: " + tail.slice(0, 120));
      await shot("home-failed-popover");
      await app.ev(`document.activeElement?.blur()`); await sleep(500);
    });
    await scene("note-snapshot", async () => {
      // the snapshot of a run's document (mock 18): a note with its source; the run is the one on project-b
      const cur = await app.ev(`window.canvasTTY.settings.get()`);
      if (!cur.stickyNotes.some((n) => n.id === "r6-snap")) {
        await app.ev(`window.canvasTTY.settings.update(${JSON.stringify({ stickyNotes: [...cur.stickyNotes, { id: "r6-snap", text: `Итог запуска ${runB.slice(0, 8)}\n\nЭтапов 2 из 2 · проверки 3/3 · ревью принято · 2 коммита на feat/notes.`, workspaceId: "common", ...R(2, 1), size: { width: 360, height: 300 }, source: { runId: runB, doc: "result", at: new Date().toISOString() } }] })}).then(() => true)`);
        await app.call("Page.reload", {}); await sleep(2500); await laptop();
        await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas", 30_000);
      }
      await app.key("Home", "Home", 36); await sleep(600);
      await app.reveal(q('[data-note-source]') + `.closest("[data-sticky-note-id]")`); await sleep(500);
      await zoom100(`document.querySelector('[data-note-source]').closest("[data-sticky-note-id]")`); await shot("cards-note-snapshot");
      await app.key("Home", "Home", 36); await sleep(600);
    });
    await scene("home-edit", async () => {
      // R12t (gate S8, mock 18): the border close round the tiles: HOME at its smallest, 11 x 6 (HOME_GRID_MIN_*, D-043: as the tiles), as a person
      // who made it smaller has it; the default 16 x 12 is wider than the window at 100%. Given back after the scene
      const grid0 = (await app.ev(`window.canvasTTY.settings.get()`)).homeGridSize;
      await app.ev(`window.canvasTTY.settings.update({ homeGridSize: { columns: 11, rows: 6 } }).then(() => true)`); await sleep(600);
      // R12t: HOME whole in the window at 100%, its corner at 24,120, the bar under it (inventory appCrop). At 100% HOME and its grid cover the
      // window (no empty canvas to drag): the camera is written to the space and the window reads it again
      const zw = await app.ev(`(() => { const sc = document.querySelector(".workspace__scene"), o = sc.parentElement.getBoundingClientRect(), z = document.querySelector(".home-zone").getBoundingClientRect();
        const m = sc.style.transform.match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\) scale\\(([\\d.]+)\\)/); return { x: (z.left - o.left - +m[1]) / +m[3], y: (z.top - o.top - +m[2]) / +m[3], ox: o.left, oy: o.top }; })()`);
      await app.ev(`window.canvasTTY.workspaces.setCamera("common", ${JSON.stringify({ x: Math.round(24 - zw.ox - zw.x), y: Math.round(120 - zw.oy - zw.y), zoom: 1 })}).then(() => true)`);
      await app.call("Page.reload", {}); await sleep(2500); await laptop();
      await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas", 30_000);
      { // the written camera lands HOME a little off (the zone's own offset in the scene): corrected once from where it is
        const z = await app.ev(`(() => { const b = document.querySelector(".home-zone").getBoundingClientRect(); return { x: b.left, y: b.top }; })()`);
        const cam = (await app.ev(`window.canvasTTY.workspaces.get()`)).workspaces.find((w) => w.id === "common").camera;
        await app.ev(`window.canvasTTY.workspaces.setCamera("common", ${JSON.stringify({ x: Math.round(cam.x + 24 - z.x), y: Math.round(cam.y + 120 - z.y), zoom: 1 })}).then(() => true)`);
        await app.call("Page.reload", {}); await sleep(2500); await laptop();
        await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas", 30_000);
      }
      await hideOnboarding();
      await app.clickEl(q(".settings-button"));
      await app.waitFor(`${q(".settings-backdrop--open")} && true`, "settings open", 10_000);
      await app.clickEl(q("#settings-tab-appearance")); await sleep(500);
      const editBtn = `[...document.querySelectorAll(".home-appearance-settings .setting-inline-action")].find((b) => /HOME/.test(b.textContent))`;
      await app.ev(`(() => { ${editBtn}?.scrollIntoView({ block: "center" }); return true; })()`); await sleep(400);
      await app.clickEl(editBtn); await sleep(1200);
      // R12j (gate S7, mock 18): the draft with the «Media» tile dragged out beyond the border: the bar says why it cannot be saved
      const mv = await app.ev(`(() => { const s = [...document.querySelectorAll(".home-widget-slot")].find((e) => e.querySelector(".mini-media")); const r = s.querySelector(".home-widget-slot__move").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      // R12r (gate S8, mock 18 at 1:1): the tile goes to the free row under the dock, a third of it over the right border (R12t: columns 10-12 of 12, row 6); the frame is at 100%
      await app.drag(mv, { x: mv.x + 600, y: mv.y + 270 }, 24); await sleep(700);
      console.log(`[shots-r5] ${theme} home-edit zone ${await app.ev(`(() => { const b = document.querySelector(".home-zone").getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(Math.round).join(" "); })()`)}`);
      // the HUD at the top right (minimap, hints «Home / F2 / ⌘K») lies over HOME's corner; mock 18 draws none (as the board's clip, R12o L1): hidden for the frame
      const hud = (v) => app.ev(`(() => { for (const e of document.querySelectorAll(".shortcut-hints, .canvas-minimap")) e.style.visibility = ${JSON.stringify(v)}; return true; })()`);
      await hud("hidden"); try { await shot("home-edit"); } finally { await hud(""); }
      await app.clickEl(q(".home-editor-toolbar__reset")); await sleep(500); // the draft is reset: the layout is the default again
      // the editor leaves with «Сохранить» (the layout is unchanged)
      await app.clickEl(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Сохранить" && !b.closest(".settings-panel"))`); await sleep(600);
      if (await app.ev(`!!${q(".settings-backdrop--open")}`)) await app.clickEl(q(".settings-panel__close"));
      await app.ev(`window.canvasTTY.settings.update({ homeGridSize: ${JSON.stringify(grid0)} }).then(() => true)`);
      await app.key("Home", "Home", 36); await sleep(600);
    });
    await scene("card-resize", async () => {
      await app.key("Home", "Home", 36); await sleep(600);
      // R7d (mock 18): a plain terminal card of the mock's size, not one of the card states (no «waiting» strip, no failed neighbour)
      const plain = await app.ev(`window.canvasTTY.terminal.create({ provider: "terminal", profile: "normal", cwd: ${JSON.stringify(path.join(termDir, "infra"))}, position: ${JSON.stringify({ x: 3600, y: 3600 })} })`);
      await app.ev(`window.canvasTTY.terminal.setBounds(${JSON.stringify(plain.id)}, ${JSON.stringify({ position: { x: 3600, y: 3600 }, size: { width: 520, height: 300 } })})`);
      await app.ev(`window.canvasTTY.terminal.rename(${JSON.stringify(plain.id)}, "project-a").then(() => true)`);
      await sleep(1200);
      await app.ev(`window.canvasTTY.terminal.input(${JSON.stringify(plain.id)}, ${JSON.stringify("PS1='$ ' PROMPT='$ '; clear; echo '$ npm run dev'\r")})`); await sleep(800);
      await app.reveal(`document.querySelector('[data-canvas-layer-id="terminal:${plain.id}"]')`); await sleep(600); // on the empty canvas, as in the mock
      await zoom100(`document.querySelector('[data-canvas-layer-id="terminal:${plain.id}"]')`); // mock 18 is 1:1
      const head = await app.ev(`(() => { const b = document.querySelector('[data-canvas-layer-id="terminal:${plain.id}"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 14 }; })()`);
      await app.click(head.x, head.y); await sleep(400);
      const r = await app.ev(`(() => { const b = document.querySelector('[data-canvas-layer-id="terminal:${plain.id}"]').getBoundingClientRect(); return { x: b.right - 2, y: b.top + b.height / 2 }; })()`);
      await app.mouse("mouseMoved", r.x, r.y); await sleep(500);
      await shot("card-resize");
      // the gesture: the corner is held and dragged, the size shows under the card
      const c = await app.center(`document.querySelector('[data-canvas-layer-id="terminal:${plain.id}"] .terminal-card__resize-handle--se')`);
      // R12t (gate 18-card-resize sand, paper): by a touch pointer, as the link gesture: a move of the OS mouse cut the mouse drag before the frame
      // (no markers, no size). The handle is touch-action: none; the frame is taken while the corner is held, so the card must say it is being resized
      const touch = (type, x, y) => app.call("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
      await touch("touchStart", c.x, c.y);
      for (let i = 1; i <= 6; i++) { await touch("touchMove", c.x + 6 * i, c.y + 4 * i); await sleep(40); }
      await sleep(400);
      if (!(await app.ev(`!!document.querySelector('[data-canvas-layer-id="terminal:${plain.id}"][data-resizing]') && !!document.querySelector(".resize-size-badge")`))) throw new Error("the resize gesture did not hold");
      await shot("card-resize-drag");
      await touch("touchEnd", c.x + 36, c.y + 24); await sleep(300);
      await app.mouse("mouseMoved", 700, 20);
      await app.ev(`window.canvasTTY.terminal.dispose(${JSON.stringify(plain.id)}).then(() => true)`); await sleep(500);
    });

    // links: repeated pair refused, executor to the left, zoom 0.2
    await scene("link-repeat", async () => {
      await app.reveal(card(lead.agentId)); await fit();
      await app.drag(await app.center(card(lead.agentId, ".agent-card__port")), await app.center(card(exec.agentId, ".agent-card__body")), 20);
      await sleep(900); await shot("link-repeat");
    });
    await scene("link-selected", async () => {
      await app.reveal(card(lead.agentId)); await fit();
      await app.click(...Object.values(await app.ev(`(() => { const p = document.querySelector(".agent-link__line"); const m = p.getScreenCTM(); const q = p.getPointAtLength(p.getTotalLength() * 0.3); return { x: m.a * q.x + m.e, y: m.d * q.y + m.f }; })()`)));
      await sleep(500); await shot("link-selected");
      await app.key("Escape", "Escape", 27); await app.click(40, 880);
    });
    await scene("zoom-out", async () => {
      await app.reveal(card(lead.agentId)); await fit();
      for (let i = 0; i < 6; i++) { await app.clickEl(`document.querySelectorAll(".canvas-controls button, .zoom-controls button")[1]`).catch(() => {}); await sleep(150); }
      await sleep(600); await shot("zoom-out");
      await app.key("Home", "Home", 36); await sleep(600);
    });

    // terminal exit states and the browser card
    await scene("browser", async () => {
      await app.key("Home", "Home", 36); await sleep(600);
      const tab = await app.ev(`window.canvasTTY.browser.getState().then((s) => s.tabs[0].id)`);
      await app.ev(`window.canvasTTY.browser.navigate(${JSON.stringify(tab)}, ${JSON.stringify(SITE + "?t=" + theme)}).then(() => true)`);
      await app.reveal(q('[data-canvas-layer-id="browser"]')); await sleep(1500);
      await zoom100(q('[data-canvas-layer-id="browser"]')); await shot("cards-browser");
    });

    // link dialog from the terminal output (cmd+click on the url)
    await scene("link-dialog", async () => {
      await app.key("Home", "Home", 36); await sleep(600); // the 100% of the scene before leaves no empty canvas to pan by
      await app.reveal(`document.querySelector('[data-canvas-layer-id="terminal:${t.id}"]')`); await sleep(500);
      const pt = await app.ev(`(() => { const rows = [...document.querySelectorAll(".terminal-card .xterm-rows > div")]; const r = rows.find((e) => e.textContent.trim().endsWith("localhost:5173/")); if (!r) return null; const txt = r.textContent; const rg = document.createRange(); rg.selectNodeContents(r); const b = rg.getBoundingClientRect(); const cw = b.width / Math.max(txt.length, 1); const i = txt.indexOf("http"); return { x: b.left + cw * (i + 12), y: b.top + b.height / 2 }; })()`);
      if (!pt) throw new Error("no url row");
      await app.mouse("mouseMoved", pt.x, pt.y); await sleep(300);
      await app.call("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", buttons: 1, clickCount: 1, modifiers: 4 });
      await app.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", buttons: 0, clickCount: 1, modifiers: 4 });
      await app.waitFor(`${q(".terminal-link-dialog")} && true`, "link dialog", 5000);
      await sleep(500); await shot("link-dialog"); await esc();
    });

    // radial menu
    await scene("radial", async () => {
      await app.ev(`window.canvasTTY.settings.update({ radialLauncherEnabled: true }).then(() => true)`);
      await app.call("Page.reload", {}); await sleep(1500); await laptop();
      await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas", 30_000);
      await app.key("Home", "Home", 36); await sleep(900);
      // zoomed out, so a ring of the menu's size has free canvas around it
      for (let i = 0; i < 2; i++) { await app.clickEl(`document.querySelectorAll(".canvas-controls button, .zoom-controls button")[1]`).catch(() => {}); await sleep(200); }
      await sleep(500);
      const spot = await app.freeRect(300, 300);
      await app.mouse("mouseMoved", spot.x + 150, spot.y + 150);
      await app.mouse("mousePressed", spot.x + 150, spot.y + 150, "right", 2); await sleep(700);
      await app.mouse("mouseMoved", spot.x + 150, spot.y + 100, "right", 2); await sleep(400);
      await shot("overlay-radial");
      await app.mouse("mouseReleased", spot.x + 150, spot.y + 100, "right", 0); await sleep(300); await esc();
      await app.ev(`window.canvasTTY.settings.update({ radialLauncherEnabled: false }).then(() => true)`);
    });

    await scene("ws-bar-back", async () => { await app.clickEl(`[...document.querySelectorAll(".workspace-bar__tab")][0]`); await sleep(800); });
  }
  // the board runs from here on: its first run holds the link, so it comes after every scene that needs the link idle
  for (theme of THEMES) {
    await settle();
    // board (R4c, mock 08): the board runs for the rest of the pass, so it comes last: the first run's lead plans, its
    // executor is held (a task «Работает»), the autopilot's ribbon names what it waits for; the import report is the first
    // import's («Добавлено N») and, in the second theme, a second file's (new tasks and one that is there already)
    await scene("board", async () => {
      await app.key("Home", "Home", 36); await sleep(600);
      if (!(await app.ev(`!!${q("[data-board]")}`))) await app.clickEl(q("[data-board-button]"));
      await app.waitFor(`${q("[data-board]")} && true`, "the board");
      const clip = async (name, selectors) => { // a clip of the union of the elements, twice the pixels, like shots-r4c
        await measure(name);
        const r = await app.ev(`(() => { const els = ${JSON.stringify(selectors)}.map((x) => document.querySelector(x)).filter(Boolean).map((e) => e.getBoundingClientRect());
          const x = Math.min(...els.map((b) => b.left)), y = Math.min(...els.map((b) => b.top)); return { x, y, width: Math.max(...els.map((b) => b.right)) - x, height: Math.max(...els.map((b) => b.bottom)) - y }; })()`);
        const shotData = await clipShot({ ...r, scale: 2 });
        fs.writeFileSync(path.join(OUT, `${theme}-${name}.png`), Buffer.from(shotData.data, "base64"));
        console.log(`[shots-r5] clip ${theme}-${name}`);
      };
      if (!world.boardOn) {
        await app.clickEl(q("[data-board-import]")); await app.waitFor(`${q("[data-board-import-report]")} && true`, "the report");
        await sleep(600); await clip("board-report", ["[data-board]", "[data-board-aside]"]);
        await app.clickEl(q("[data-board-import-close]"));
        await clip("board-queue", ["[data-board]"]);
        await app.clickEl(q("[data-board-autopilot-start]")); await sleep(500);
        await app.ev(`document.activeElement?.blur?.(), true`); await sleep(200); // R12k: no focus ring on the field in the frame
        await clip("board-form", ["[data-board]", ".board-asides"]);
        hold("claude", true);
        await app.clickEl(q("[data-board-autopilot-yes]"));
        await app.waitFor(`${q('[data-board-autopilot="on"]')} && true`, "the autopilot on", 20_000);
        await waitForValue(() => app.ev(`!!document.querySelector('[data-board-task-column="work"]')`).then((ok) => ok || null), "a task in work", 90_000);
        world.boardOn = true;
      } else {
        writeBoard(WS.alpha, [row("A", { title: "Экспорт заметок в Markdown" }), row("E", { title: "Поиск по заметкам" }), row("F", { title: "Удаление заметок" })]);
        await app.clickEl(q("[data-board-import]")); await app.waitFor(`${q("[data-board-import-report]")} && true`, "the report");
        await sleep(600); await clip("board-report", ["[data-board]", "[data-board-aside]"]);
        await app.clickEl(q("[data-board-import-close]")); // R12k: the board frame is the board alone, as in the mock (no import panel)
      }
      await sleep(800);
      await clip("board", ["[data-board]"]);
    });
    await scene("cards-agents-working", async () => {
      await app.key("Home", "Home", 36); await sleep(500);
      await app.key("Escape", "Escape", 27);
      if (await app.ev(`!!${q("[data-board-menu]")}`)) { await app.clickEl(q("[data-board-menu]")); await app.clickEl(q("[data-board-hide]")); await sleep(500); }
      await app.reveal(card(lead.agentId)); await pairView(lead.agentId, exec.agentId); await sleep(500);
      // R12r (gate S7): the executor's role and path as drawn — whether the role is in the header's visible line, and its width
      const roleSeen = (label) => app.ev(`(() => { const c = document.querySelector('[data-agent-id="${exec.agentId}"]'), id = c.querySelector(".agent-card__identity"), r = id.querySelector("small"), p = c.querySelector(".agent-card__project");
        const ib = id.getBoundingClientRect(), rb = r.getBoundingClientRect(), pb = p?.getBoundingClientRect();
        const cb = c.getBoundingClientRect(), cs = getComputedStyle(r); return "${label} role " + Math.round(rb.width) + "px (cut " + (r.scrollWidth > r.clientWidth) + ", " + cs.textOverflow + ", ends " + Math.round(cb.right - rb.right) + "px before the card edge) in-line " + (rb.top >= ib.top - 1 && rb.bottom <= ib.bottom + 1 && rb.width > 0) + " text " + JSON.stringify(r.textContent) + " path " + (pb && pb.height > 0 && getComputedStyle(p).display !== "none" ? Math.round(pb.width) + "px" : "gone"); })()`).then((s) => console.log(`[shots-r5] ${theme} ${s}`));
      await roleSeen("67%");
      await shot("cards-agents-working");
      // R12f (mock 06 is 1:1): the pair at 100%, where the status is still in the body
      await zoom100(card(exec.agentId)); await shot("cards-agents-working-100"); await app.key("Home", "Home", 36); await sleep(500);
      await app.reveal(card(lead.agentId)); await pairView(lead.agentId, exec.agentId); await sleep(500);
      // R12f (mock 21): the pair at 45% (the status in the footer, the tail «· этап 1 из 2» gone) and at 30% (name and glyph)
      const out = (n) => app.clickEl(`document.querySelectorAll(".canvas-controls button, .zoom-controls button")[1]`).catch(() => {}).then(() => sleep(300));
      await out(); await out(); await sleep(500); await roleSeen("45%"); await shot("cards-agents-working-45");
      await out(); await out(); await sleep(500); await shot("cards-agents-working-30");
      await app.key("Home", "Home", 36); await sleep(500);
      await app.reveal(card(lead.agentId)); await pairView(lead.agentId, exec.agentId); await sleep(500);
      // R7b: the two cards close up (twice the pixels), the pair of the mock's «Агенты оркестрации» row
      const cr = await app.ev(`(() => { const r = [...document.querySelectorAll("[data-agent-id]")].map((e) => e.getBoundingClientRect());
        const x = Math.min(...r.map((b) => b.left)) - 12, y = Math.min(...r.map((b) => b.top)) - 12; return { x, y, width: Math.max(...r.map((b) => b.right)) - x + 12, height: Math.max(...r.map((b) => b.bottom)) - y + 12 }; })()`);
      const cd = await clipShot({ ...cr, scale: 3 });
      fs.writeFileSync(path.join(OUT, `${theme}-cards-agents-working-zoom.png`), Buffer.from(cd.data, "base64"));
    });
    // R12r (gate S2, mock 19): the executor left of its lead and the far zoom with a run on the link (the board's pair, as cards-agents-working);
    // these frames replace the idle ones of the first pass. The executor is moved left and below its lead for the frame and back after it.
    const pairCamera = async (zoomTo) => {
      const st = await canvasState(app), bs = [lead.agentId, exec.agentId].map((id) => st.agents.find((a) => a.agentId === id).bounds);
      const x0 = Math.min(...bs.map((b) => b.position.x)), x1 = Math.max(...bs.map((b) => b.position.x + b.size.width));
      const y0 = Math.min(...bs.map((b) => b.position.y)), y1 = Math.max(...bs.map((b) => b.position.y + b.size.height));
      const wsId = st.agents.find((a) => a.agentId === lead.agentId).workspaceId ?? (await app.ev(`window.canvasTTY.workspaces.get()`)).activeId; // the pair's own space
      await app.ev(`window.canvasTTY.workspaces.setCamera(${JSON.stringify(wsId)}, ${JSON.stringify({ x: Math.round(720 - zoomTo * (x0 + x1) / 2), y: Math.round(480 - zoomTo * (y0 + y1) / 2), zoom: zoomTo })}).then(() => true)`);
      await app.ev(`window.canvasTTY.workspaces.activate(${JSON.stringify(wsId)}).then(() => true)`);
      await app.call("Page.reload", {}); await sleep(2500); await laptop();
      await app.waitFor(`${q(".workspace")} && ${card(lead.agentId)} && ${card(exec.agentId)} && ${q(`[data-agent-link-id]`)} && true`, "the pair", 30_000); await sleep(900);
    };
    await scene("link-executor-left-run", async () => {
      await app.key("Home", "Home", 36); await sleep(500);
      if (await app.ev(`!!${q("[data-board-menu]")}`)) { await app.clickEl(q("[data-board-menu]")); await app.clickEl(q("[data-board-hide]")); await sleep(500); }
      const st = await canvasState(app), lb = st.agents.find((a) => a.agentId === lead.agentId).bounds, eb = st.agents.find((a) => a.agentId === exec.agentId).bounds;
      const left = { position: { x: lb.position.x - eb.size.width - 80, y: lb.position.y + lb.size.height + 120 }, size: eb.size };
      await app.ev(`window.canvasTTY.orchestration.moveAgent(${JSON.stringify(exec.agentId)}, ${JSON.stringify(left)}).then(() => true)`);
      try {
        await pairCamera(1);
        await shot("link-executor-left");
      } finally {
        await app.ev(`window.canvasTTY.orchestration.moveAgent(${JSON.stringify(exec.agentId)}, ${JSON.stringify(eb)}).then(() => true)`);
        await app.call("Page.reload", {}); await sleep(2500); await laptop();
        await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas", 30_000);
      }
    });
    await scene("zoom-out-run", async () => {
      await pairCamera(0.28);
      await shot("zoom-out");
      await app.key("Home", "Home", 36); await sleep(600);
    });
    if (!world.boardStates) {
      world.boardStates = true;
      // an executor that asks for a permission: the board's task is «Ждёт разрешения» (the person's turn), the lead's card too
      await scene("board-waiting", async () => {
        fs.writeFileSync(path.join(claudeScript, "1.asks.json"), JSON.stringify([{ tool: "Bash", command: "ls src", request: { decision_reason_type: "rule", decision_reason: "Permission rule Bash(ls:*) requires approval" } }]));
        hold("claude", false);
        await app.key("Home", "Home", 36); await sleep(500);
        if (!(await app.ev(`!!${q("[data-board]")}`))) await app.clickEl(q("[data-board-button]"));
        await app.waitFor(`${q("[data-board]")} && true`, "the board");
        await waitForValue(() => app.ev(`!!document.querySelector('[data-board-reason="waits_permission"]')`).then((ok) => ok || null), "a task waits for a permission", 90_000);
        // an external task, and a task of the folder where the CLI fails
        writeBoard(WS.alpha, [row("A", { title: "Экспорт заметок в Markdown" }), row("X", { title: "Поиск по заметкам", external: true }), row("Y", { title: "Выгрузка в QA", project: node })]);
        await app.clickEl(q("[data-board-import]")); await app.waitFor(`${q("[data-board-import-report]")} && true`, "the report");
        await sleep(800);
        await app.clickEl(q("[data-board-import-close]")).catch(() => {});
        await sleep(2500);
        const r = await app.ev(`(() => { const els = ["[data-board]", "[data-board-aside]"].map((x) => document.querySelector(x)).filter(Boolean).map((e) => e.getBoundingClientRect());
          const x = Math.min(...els.map((b) => b.left)), y = Math.min(...els.map((b) => b.top)); return { x, y, width: Math.max(...els.map((b) => b.right)) - x, height: Math.max(...els.map((b) => b.bottom)) - y }; })()`);
        const d = await clipShot({ ...r, scale: 2 });
        fs.writeFileSync(path.join(OUT, `${theme}-board-states.png`), Buffer.from(d.data, "base64"));
        console.log(`[shots-r5] clip ${theme}-board-states`);
        if (await app.ev(`!!${q("[data-board-menu]")}`)) { await app.clickEl(q("[data-board-menu]")); await app.clickEl(q("[data-board-hide]")); await sleep(500); }
      });
    }

    // R12d (mock 24): «Подробнее» of the work card (a permission asked) and of the review card (blocking findings) opened, in every theme:
    // the state of board-waiting stays in the app, the columns of the opened cards grow
    await scene("board-expanded", async () => {
      await app.key("Home", "Home", 36); await sleep(500);
      if (!(await app.ev(`!!${q("[data-board]")}`))) await app.clickEl(q("[data-board-button]"));
      await app.waitFor(`${q("[data-board]")} && true`, "the board");
      await app.waitFor(`!!document.querySelector('[data-board-task="T-1"] [data-board-more]')`, "the work card", 20_000);
        // R12d (mock 24): the work card's «Подробнее» opened — the pairs inside the card, the risk and the actions stay in view
        await app.ev(`document.querySelector('[data-board-task="T-1"] [data-board-more]').click()`);
        await app.ev(`document.querySelector('[data-board-task="T-3"] [data-board-more]')?.click()`); await sleep(700);
        const rx = await app.ev(`(() => { const els = ["[data-board]", "[data-board-aside]"].map((x) => document.querySelector(x)).filter(Boolean).map((e) => e.getBoundingClientRect());
          const x = Math.min(...els.map((b) => b.left)), y = Math.min(...els.map((b) => b.top)); return { x, y, width: Math.max(...els.map((b) => b.right)) - x, height: Math.max(...els.map((b) => b.bottom)) - y }; })()`);
        const dx = await clipShot({ ...rx, scale: 2 });
        fs.writeFileSync(path.join(OUT, `${theme}-board-expanded.png`), Buffer.from(dx.data, "base64"));
        console.log(`[shots-r5] clip ${theme}-board-expanded`);
        await app.ev(`document.querySelector('[data-board-task="T-1"] [data-board-more]').click()`);
        await app.ev(`document.querySelector('[data-board-task="T-3"] [data-board-more]')?.click()`); await sleep(300);
      if (await app.ev(`!!${q("[data-board-menu]")}`)) { await app.clickEl(q("[data-board-menu]")); await app.clickEl(q("[data-board-hide]")); await sleep(500); }
    });

    // R9: the «new task» form of the board (font measure and a frame)
    await scene("board-newtask", async () => {
      await app.key("Home", "Home", 36); await sleep(500);
      if (!(await app.ev(`!!${q("[data-board]")}`))) await app.clickEl(q("[data-board-button]"));
      await app.waitFor(`${q("[data-board]")} && true`, "the board");
      await app.clickEl(q("[data-board-new]")); await app.waitFor(`${q("[data-board-form]")} && true`, "the form"); await sleep(500);
      console.log("DBG", await app.ev(`(() => { const d = document.querySelector(".dialog-backdrop"); if (!d) return "none"; const r = d.getBoundingClientRect(); const c = getComputedStyle(d); return JSON.stringify({ r: [r.x, r.y, r.width, r.height], parent: d.parentElement.tagName, disp: c.display, op: c.opacity, vis: c.visibility, z: c.zIndex, bg: c.backgroundColor }); })()`));
      await shot("board-newtask");
      await esc();
      await app.clickEl(q("[data-board-menu]")); await app.clickEl(q("[data-board-hide]")); await sleep(500);
    });
    // R7b (mock 08-board-states): the autopilot's push is on in the profile and a task asks for a field it has not — a red card in «Очередь».
    // The mock's «Ждёт вашего решения» in «Проверка» needs a run through the final review and the finish confirmation; the fake lead's
    // script is one per CLI, not per run, so the order of two parallel runs' turns is not fixed (see the D-NNN proposal in the R7b report)
    await scene("board-push", async () => {
      await app.key("Home", "Home", 36); await sleep(500);
      if (!(await app.ev(`!!${q("[data-board]")}`))) await app.clickEl(q("[data-board-button]"));
      await app.waitFor(`${q("[data-board]")} && true`, "the board");
      const J = JSON.stringify;
      const ipc = (call) => app.ev(`window.canvasTTY.orchestration.${call}`);
      const linkId = await ipc(`canvas().then((r) => r.value.links.find((l) => r.value.agents.find((a) => a.agentId === l.fromAgentId)?.project === ${J(node)}).linkId)`);
      const p0 = await ipc(`profile(${J(linkId)}).then((r) => r.value.profile)`);
      const options = ["merge_request.create", "merge_request.title={commitTitle}"];
      const base = { ...p0, workMode: "worktree", checks: ["true"], prepare: { auto: false, steps: [] }, finish: { ...p0.finish, commit: true },
        branchTemplate: "{issue}-{ref}", runBase: { remote: "upstream", branch: "stable", remoteUrl: null } };
      const saved = await ipc(`saveProfile(${J(linkId)}, ${J(base)}).then((r) => r.ok ? r.value : { code: r.code })`);
      const pushed = await ipc(`saveProfile(${J(linkId)}, ${J({ ...saved, runPush: { enabled: true, remote: "upstream", remoteUrl: null, options, protected: [], confirmedAt: null }, confirmPush: true })}).then((r) => r.ok ? r.value : { code: r.code })`);
      if (pushed.code) throw new Error(`the push profile: ${pushed.code}`);
      writeBoard(WS.alpha, [row("P", { title: "Удаление заметок", issue: "ISSUE-1" })]);
      await app.clickEl(q("[data-board-import]")); await app.waitFor(`${q("[data-board-import-report]")} && true`, "the report");
      await sleep(600); await app.clickEl(q("[data-board-import-close]")).catch(() => {});
      await app.waitFor(`${q('[data-board-reason="push_option_field"]')} && true`, "the push option card", 30_000);
      await app.ev(`document.querySelector('[data-board-reason="push_option_field"]').scrollIntoView({ block: "center" })`);
      await sleep(1500);
      const r = await app.ev(`(() => { const els = ["[data-board]", "[data-board-aside]"].map((x) => document.querySelector(x)).filter(Boolean).map((e) => e.getBoundingClientRect());
        const x = Math.min(...els.map((b) => b.left)), y = Math.min(...els.map((b) => b.top)); return { x, y, width: Math.max(...els.map((b) => b.right)) - x, height: Math.max(...els.map((b) => b.bottom)) - y }; })()`);
      const d = await clipShot({ ...r, scale: 2 });
      fs.writeFileSync(path.join(OUT, `${theme}-board-push.png`), Buffer.from(d.data, "base64"));
      console.log(`[shots-r5] clip ${theme}-board-push`);
      // R12g: the card itself (the queue is longer in some themes, so a fixed crop of the frame misses it): its own clip, twice the pixels
      const rc = await app.ev(`(() => { const b = document.querySelector('[data-board-reason="push_option_field"]').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
      const dc = await clipShot({ ...rc, scale: 2 });
      fs.writeFileSync(path.join(OUT, `${theme}-board-push-card.png`), Buffer.from(dc.data, "base64"));
      console.log(`[shots-r5] clip ${theme}-board-push-card`);
      // the profile back as it was (the later scenes run in the copy mode)
      const back = await ipc(`saveProfile(${J(linkId)}, ${J({ ...p0 })}).then((r) => r.ok ? "ok" : r.code)`);
      console.log(`[shots-r5] profile restored: ${back}`);
      if (await app.ev(`!!${q("[data-board-menu]")}`)) { await app.clickEl(q("[data-board-menu]")); await app.clickEl(q("[data-board-hide]")); await sleep(500); }
    });
  }
  // R12l: the plugin list — the last scene: the app is started again with two plugins installed, so that nothing before it sees them
  if (wanted("plugins-list")) {
    seedPlugins();
    await app.stop(); app = await launch(launchOpts); await laptop();
    await app.waitFor(`${q(".workspace")} && true`, "window", 30_000);
    for (theme of THEMES) {
      await settle();
      await scene("plugins-list", async () => {
        await app.clickEl(q(".settings-button"));
        await app.waitFor(`${q(".settings-backdrop--open")} && true`, "settings open", 10_000);
        await app.clickEl(q("#settings-tab-plugins")); await sleep(700);
        await shot("settings-plugins-list");
        await app.clickEl(q(".settings-panel__close")); await sleep(500);
      });
    }
    unseedPlugins();
  }
  console.log("[shots-r5] phase done");
} catch (error) {
  await app?.shot("failure").catch(() => {});
  console.error(String(error?.stack ?? error));
  failed.push(`FATAL ${String(error?.message ?? error).slice(0, 200)}`);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, "failed.txt"), failed.join("\n") + "\n");
  if (failed.length) process.exitCode = 1; // a scene that could not be taken fails the run loudly
  await app?.stop().catch(() => {});
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.rmSync(termDir, { recursive: true, force: true });
  site.close();
}
