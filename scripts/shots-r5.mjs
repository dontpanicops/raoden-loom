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

const { TMP, D, project } = workspace("cto-r5shots-");
const PORT = 9500 + Math.floor(Math.random() * 250);
const node = project("node-app");
const other = project("infra-app");
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
const codexScript = script("codex", [
  plan([["Заметки в Markdown", "Добавить src/notes.mjs", ["R1"]]]), // the run on project-b (its lead asks a question first)
  ...Array.from({ length: 8 }, () => plan([["Модель заметки", "Добавить src/model.mjs", ["R1"]], ["Экспорт в Markdown", "Добавить src/export.mjs", []]])) // the board's runs, a failing run
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
  codex: { executable: wrap("codex"), version: "codex-cli 0.155.1", path: PATHS, env: env({ MOCK_SCRIPT: codexScript, CODEX_HOME: D("mock-state", ".codex") }) },
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
const site = http.createServer((_, res) => { res.setHeader("content-type", "text/html; charset=utf-8");
  res.end("<title>notes</title><body style='margin:0;height:100vh;display:grid;place-items:center;background:#1c1a17;color:#a9a396;font:14px sans-serif'>страница сайта · нативный слой</body>"); });
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const SITE = `http://localhost:${site.address().port}/notes`;
const failed = [];
let app;
let theme = "sand";
const laptop = () => app.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const wanted = (name) => !ONLY || name.includes(ONLY);
const shot = async (name) => {
  await sleep(500);
  const z = await app.ev(`(() => { const m = document.querySelector(".workspace__scene")?.style.transform.match(/scale\\(([\\d.]+)\\)/); return m ? Number(m[1]) : null; })()`).catch(() => null);
  console.log(`[shots-r5] frame ${theme}-${name} zoom ${z}`);
  await app.shot(`${theme}-${name}`);
};
const esc = async () => { for (let i = 0; i < 3; i++) { await app.key("Escape", "Escape", 27); await sleep(150); } };
const hideOnboarding = () => app.ev(`(() => { if (!document.getElementById("r5-hide")) { const s = document.createElement("style"); s.id = "r5-hide"; s.textContent = "[data-onboarding] { display: none !important; }"; document.head.append(s); } return true; })()`);
const WS = { common: "common", alpha: null, beta: null };
const BETA_SCENES = new Set(["link-executor-left", "link-mode"]);
const ALPHA_SCENES = new Set(["cards-agents", "goal", "cards-agents-idle", "link-repeat", "link-selected", "zoom-out", "board", "board-waiting", "cards-agents-working"]);
// the tab of a space is clicked (the renderer follows its own state); the common canvas is the first tab
const go = async (id) => {
  const st = await app.ev(`window.canvasTTY.workspaces.get()`);
  if (st.activeId === id) return;
  const open = st.workspaces.filter((w) => !w.closed);
  await app.clickEl(`document.querySelectorAll(".workspace-bar__tab")[${open.findIndex((w) => w.id === id)}]`); await sleep(1000);
};
async function scene(name, fn) {
  if (!wanted(name)) return;
  try { if (WS.alpha) await go(BETA_SCENES.has(name) ? WS.beta : ALPHA_SCENES.has(name) ? WS.alpha : WS.common); await fn(); console.log(`[shots-r5] ${theme} ${name}: ok`); }
  catch (e) {
    const msg = `${theme} ${name}: ${String(e?.message ?? e).split("\n")[0].slice(0, 200)}`;
    console.log(`[shots-r5] FAILED ${msg}`); failed.push(msg);
    try { await app.shot(`fail-${theme}-${name}`); await esc(); if (await app.ev(`!!document.querySelector(".workspace-bar__menu")`)) await app.clickEl(q("[data-workspace-menu]")); } catch { /* ignore */ }
  }
}
const settle = async (patch = {}) => {
  await app.ev(`window.canvasTTY.settings.update(${JSON.stringify({ palette: theme, followSystem: false, canvasColor: "theme", homeAccentPreset: "theme", uiScale: 1, onboardingDismissed: true, lastDirectory: termDir, ...patch })}).then(() => true)`);
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
const pairView = async (...ids) => {
  const b = await app.ev(`(() => { const r = ${JSON.stringify(ids)}.map((id) => document.querySelector('[data-agent-id="' + id + '"]')?.getBoundingClientRect()).filter(Boolean);
    return { cx: (Math.min(...r.map((x) => x.left)) + Math.max(...r.map((x) => x.right))) / 2, cy: (Math.min(...r.map((x) => x.top)) + Math.max(...r.map((x) => x.bottom))) / 2 }; })()`);
  await app.panBy({ x: 720 - b.cx, y: 470 - b.cy }); await sleep(700);
};

try {
  app = await launch({ userData, providers, port: PORT, shots: OUT, env: { CANVASTTY_SMOKE_CLI_DIR: cliBin, CANVASTTY_USER_DATA_DIR: userData, CANVASTTY_SMOKE_IMPORT_FILE: BOARD_FILE } });
  await laptop();
  await app.waitFor(`${q(".workspace")} && true`, "window", 30_000);

  // ---- phase 1: first run on an empty canvas
  for (theme of THEMES) {
    await scene("firstrun", async () => {
      if (fs.existsSync(path.join(cliBin, "claude"))) fs.renameSync(path.join(cliBin, "claude"), path.join(cliBin, "claude.off")); // mock 04: no CLI found («Как установить»)
      await settle({ onboardingDismissed: false });
      await shot("firstrun");
    });
  }
  if (fs.existsSync(path.join(cliBin, "claude.off"))) fs.renameSync(path.join(cliBin, "claude.off"), path.join(cliBin, "claude"));

  // ---- world: terminal with a link in its output, note, two agents with a link
  await app.ev(`window.canvasTTY.settings.update(${JSON.stringify({ palette: "sand", onboardingDismissed: true, lastDirectory: termDir, persistStickyNotes: true,
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
  await app.key("Home", "Home", 36); await sleep(1200);
  const cam = await app.ev(`(() => { const m = document.querySelector(".workspace__scene").style.transform.match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\) scale\\(([\\d.]+)\\)/); return { x: +m[1], y: +m[2], z: +m[3] }; })()`);
  const B = (sx, sy, sw, sh) => ({ position: { x: Math.round((sx - cam.x) / cam.z), y: Math.round((sy - cam.y) / cam.z) }, size: { width: Math.round(sw / cam.z), height: Math.round(sh / cam.z) } });
  await app.ev(`window.canvasTTY.settings.update(${JSON.stringify({
    stickyNotes: [{ id: "r5-note", text: "Перед релизом: прогнать e2e оркестрации и обновить UI_CONTRACT.", ...B(1000, 790, 200, 110) }],
    browserCanvas: { ...B(1000, 300, 420, 200), workspaceId: "common" },
    persistCanvasRegions: true, canvasRegions: [{ id: "r6-region", title: "Оркестрация · project-b", color: "#B8CF99", workspaceId: "common", ...B(985, 602, 470, 192) }] })}).then(() => true)`);
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
  const a = await session("claude", "project-a-working", "project-a", B(178, 615, 270, 175));
  const b = await session("claude", "project-b-waiting", "project-b", B(450, 615, 270, 175));
  const infra = await session("terminal", "infra", "infra", B(722, 615, 270, 175));
  await sleep(1500);
  await app.ev(`window.canvasTTY.terminal.input(${JSON.stringify(infra.id)}, ${JSON.stringify("PS1='$ ' PROMPT='$ '; clear; for i in $(seq 1 30); do echo \"  deploy step $i ok\"; done; echo '$ npm run deploy:qa'; echo \"Error: ENOENT: no such file, open '.env.production'\"; exit 1\r")})`);
  world.mock = { a, b, infra, B };
  // two more spaces (mock 03: Альфа with work going on, Бета waiting): the badges of their tabs come from their sessions
  for (const title of ["Альфа", "Бета"]) await app.ev(`window.canvasTTY.workspaces.create({ title: ${JSON.stringify(title)}, root: null, activate: false }).then((r) => r.ok)`);
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
  const leadB = await mkAgent("codex", projB, B(1000, 640, 201, 149)), execB = await mkAgent("claude", projB, B(1225, 640, 201, 149));
  world.groupB = (await app.ev(`window.canvasTTY.orchestration.createLink(${JSON.stringify({ linkId: crypto.randomUUID(), fromAgentId: leadB.agentId, toAgentId: execB.agentId })}).then((r) => { if (!r.ok) throw new Error(r.code); return r.value; })`)).linkId;
  await app.key("Home", "Home", 36); await sleep(800);
  // the run on project-b: its lead asks a question, so the link needs the person (the bell on the chip, «Ждёт вас»)
  const runB = (await app.ev(`window.canvasTTY.orchestration.startOnLink(${JSON.stringify({ linkId: world.groupB, requestId: crypto.randomUUID(),
    goal: { text: "Добавить заметки в проект: список и экспорт", criteria: ["node --test проходит"], checks: [], commands: ["node --test"], workMode: "project", mode: "autopilot" } })}).then((r) => { if (!r.ok) throw new Error(r.code + " " + r.message); return r.value; })`)).runId;
  await waitForValue(() => app.ev(`window.canvasTTY.orchestration.get(${JSON.stringify(runB)}).then((r) => r.value.view.permission?.kind === "question")`).then((ok) => ok || null), "the lead's question", 60_000);
  await app.key("Home", "Home", 36); await sleep(800);

  for (theme of THEMES) {
    await settle();
    await scene("home-canvas", async () => { await hideOnboarding(); await app.key("Home", "Home", 36); await sleep(900); await shot("home-canvas"); });

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
      await shot("cards-terminal");
      for (let i = 0; i < 2; i++) { await app.clickEl(`document.querySelectorAll(".canvas-controls button, .zoom-controls button")[1]`).catch(() => {}); await sleep(200); }
      await app.panBy({ x: 250, y: 60 }).catch(() => {}); // HOME out of the window: nothing but the six cards under the minimap
      await sleep(600); await shot("cards-summary");
      await app.key("Home", "Home", 36); await sleep(600);
      for (const x of Object.values(world.cards)) await app.ev(`window.canvasTTY.terminal.dispose(${JSON.stringify(x.id)}).then(() => true)`); // the palette lists sessions: no doubles
    });
    await scene("cards-agents", async () => {
      await app.reveal(card(lead.agentId)); await fit();
      await shot("cards-agents-link");
    });
    await scene("note", async () => {
      await app.reveal(`document.querySelector("[data-sticky-note-id]")`); await sleep(500);
      await shot("cards-note");
    });

    // overlays
    await scene("overlay-menu", async () => {
      await app.key("Home", "Home", 36); await sleep(900);
      const spot = await app.freeRect(40, 40);
      await app.click(spot.x + 20, spot.y + 20, "right"); await sleep(500);
      await app.waitFor(`${q(".canvas-menu")} && true`, "menu");
      const launch = await app.ev(`(() => { const b = [...document.querySelectorAll(".canvas-menu [role=menuitem]")].find((e) => /Запустить/.test(e.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (launch) { await app.click(launch.x, launch.y); await sleep(600); }
      await shot("overlay-context-menu");
      await esc();
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
      // the HOME zone lies over the left part of the region (its title): the right-click is made on the region's free edge at the right, beyond HOME
      const reg = await app.ev(`(() => { const b = document.querySelector("[data-canvas-region-id]").getBoundingClientRect(); return { x: Math.min(b.right, innerWidth) - 30, y: b.top + 10 }; })()`);
      await app.click(reg.x, reg.y, "right");
      await app.waitFor(`${q(".canvas-menu")} && true`, "the region's menu", 10_000); await sleep(400);
      await shot("canvas-region-menu"); await esc();
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
      } finally {
        await app.call("Emulation.setFocusEmulationEnabled", { enabled: true });
        await app.ev(`(() => { localStorage.removeItem("orch.notify.unavailable"); document.querySelectorAll("[data-notify-banner] button[aria-label]").forEach((b) => b.click()); return true; })()`);
      }
    });

    // settings tabs
    await scene("settings", async () => {
      await app.clickEl(q(".settings-button"));
      await app.waitFor(`${q(".settings-backdrop--open")} && true`, "settings open", 10_000);
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
            await app.clickEl(q(".shortcut-block .shortcut-editor__edit")); await sleep(300);
            await shot("settings-controls-capture"); await app.key("Escape", "Escape", 27); await sleep(200);
          }
        } catch (e) { failed.push(`${theme} settings-${tab}: ${String(e.message).slice(0, 120)}`); }
      }
      await app.clickEl(q(".settings-panel__close")); await sleep(500);
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
      await open("settings", "ws-rename");
      await open("close", "ws-hide");
      await open("history", "ws-history");
      await open("arrange", "ws-arrange");
      await open("hidden", "ws-hidden");
      await open("remove", "ws-delete");
      await shot("ws-bar");
      if (await menuOpen()) await app.clickEl(q("[data-workspace-menu]"));
    });
    await scene("ws-dialogs-more", async () => {
      // a name that is taken (the error under the field)
      await app.clickEl(q("[data-workspace-new]")); await sleep(600);
      await app.type(q("[data-ws-title]"), "Альфа"); await sleep(400);
      await app.waitFor(`${q("[data-ws-name-taken]")} && true`, "the taken name", 5000);
      await shot("ws-name-taken"); await esc(); await sleep(300);
      if (await app.ev(`!!${q(".workspace-bar__menu")}`)) await app.clickEl(q("[data-workspace-menu]"));
      // «Скрытые»: a space is made and hidden through the window, then the list of the hidden is opened
      const menuOpen = () => app.ev(`!!${q(".workspace-bar__menu")}`);
      const name = theme === "sand" ? "Гамма" : "Дельта";
      await app.clickEl(q("[data-workspace-new]")); await sleep(500);
      await app.type(q("[data-ws-title]"), name); await app.clickEl(q("[data-ws-submit]")); await sleep(1500);
      await app.clickEl(q("[data-workspace-menu]")); await sleep(400);
      await app.clickEl(q('[data-ws-action="close"]')); await sleep(900);
      if (await app.ev(`!!${q("[data-ws-close]")}`)) { await app.clickEl(q("[data-ws-close-hide]")); await sleep(900); }
      if (await menuOpen()) await app.clickEl(q("[data-workspace-menu]"));
      await app.clickEl(q("[data-workspace-menu]")); await sleep(400);
      await app.clickEl(q('[data-ws-action="hidden"]')); await sleep(700);
      await app.waitFor(`${q("[data-ws-hidden]")} && true`, "the hidden list", 5000);
      await shot("ws-hidden-list"); await esc(); await sleep(300);
      if (await menuOpen()) await app.clickEl(q("[data-workspace-menu]"));
      // «Перенести карточку»: the context menu of a card
      await app.key("Home", "Home", 36); await sleep(700);
      await app.reveal(`document.querySelector('[data-canvas-layer-id="terminal:${t.id}"]')`); await sleep(500);
      const head = await app.center(`document.querySelector('[data-canvas-layer-id="terminal:${t.id}"] header, [data-canvas-layer-id="terminal:${t.id}"] .terminal-card__header')`);
      await app.click(head.x, head.y, "right"); await sleep(500);
      await app.clickEl(`[...document.querySelectorAll(".canvas-menu [role=menuitem], .canvas-menu button")].find((e) => /Перенести в пространство/.test(e.textContent))`); await sleep(800);
      await app.waitFor(`${q("[data-ws-move]")} && true`, "the move dialog", 5000);
      await shot("ws-move"); await esc(); await sleep(300);
      // «Браузер открыт в…»: the browser is on the common canvas, the launcher is pressed in another space
      await go(WS.alpha);
      await app.clickEl(`document.querySelector(".launcher-button--browser")`); await sleep(900);
      await app.waitFor(`${q("[data-ws-browser-elsewhere]")} && true`, "the browser notice", 5000);
      await shot("ws-browser-elsewhere"); await esc(); await sleep(300);
      await go(WS.common);
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
      await shot("goal-dialog");
      const ps = await app.ev(`(() => { const b = [...document.querySelectorAll(".orch-dialog button")].find((e) => /Настройки проекта/.test(e.textContent)); if (!b) return false; b.scrollIntoView(); b.click(); return true; })()`);
      if (!ps) { await esc(); throw new Error("no project settings button in the goal dialog"); }
      await sleep(1500);
      await shot("project-settings");
      await esc(); await sleep(300); await esc();
    });

    // a lead without a link: the hint under the path and the port as a ring
    await scene("cards-agents-idle", async () => {
      await createAgent(app, "Агент Codex (лид)", node);
      const lone = (await canvasState(app)).agents.find((x) => x.provider === "codex" && ![lead.agentId, leadB.agentId, world.leftLead, world.modeLead].includes(x.agentId));
      await app.reveal(card(lone.agentId)); await sleep(600); await shot("cards-agents-idle");
      await app.clickEl(card(lone.agentId, ".agent-card__close")); await sleep(500);
    });

    // R6-C (M10): the states of mocks 06 and 19 — a failed run, an executor left of its lead, the linking mode, the HOME editor, a resize
    const link = (from, to) => app.ev(`window.canvasTTY.orchestration.createLink(${JSON.stringify({ linkId: crypto.randomUUID(), fromAgentId: from, toAgentId: to })}).then((r) => { if (!r.ok) throw new Error(r.code); return r.value; })`);
    await scene("link-executor-left", async () => {
      if (!world.leftLead) {
        const l = await mkAgent("codex", other, B(700, 610, 201, 149), WS.beta), e = await mkAgent("claude", other, B(420, 730, 201, 149), WS.beta);
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
      await shot("link-executor-left");
    });
    await scene("link-mode", async () => {
      await app.key("Home", "Home", 36); await sleep(800);
      await app.waitFor(`${card(world.modeLead, ".agent-card__port")} && true`, "the lead's port", 10_000);
      const from = await app.center(card(world.modeLead, ".agent-card__port"));
      await app.mouse("mouseMoved", from.x, from.y); await app.mouse("mousePressed", from.x, from.y, "left", 1);
      for (let i = 1; i <= 8; i++) { await app.mouse("mouseMoved", from.x + 18 * i, from.y + 10 * i, "left", 1); await sleep(40); }
      // over a free executor of the lead's folder: lit, "release to link"; the one of another folder dims, with the reason
      const fit = await app.center(card(world.modeFit, ".agent-card__body")), far = await app.center(card(world.modeFar, ".agent-card__body"));
      await app.mouse("mouseMoved", fit.x, fit.y, "left", 1); await sleep(500); await shot("link-mode");
      await app.mouse("mouseMoved", far.x, far.y, "left", 1); await sleep(500); await shot("link-mode-far");
      await app.mouse("mouseMoved", 700, 560, "left", 1); await sleep(200);
      await app.mouse("mouseReleased", 700, 560, "left", 0); await sleep(300); await esc();
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
      await sleep(300); await shot("home-failed-popover");
      await app.ev(`document.activeElement?.blur()`); await sleep(500);
    });
    await scene("note-snapshot", async () => {
      // the snapshot of a run's document (mock 18): a note with its source; the run is the one on project-b
      const cur = await app.ev(`window.canvasTTY.settings.get()`);
      if (!cur.stickyNotes.some((n) => n.id === "r6-snap")) {
        await app.ev(`window.canvasTTY.settings.update(${JSON.stringify({ stickyNotes: [...cur.stickyNotes, { id: "r6-snap", text: `Итог запуска ${runB.slice(0, 8)}\n\nЭтапов 2 из 2 · проверки 3/3 · ревью принято · 2 коммита на feat/notes.`, workspaceId: "common", ...R(2, 1), source: { runId: runB, doc: "result", at: new Date().toISOString() } }] })}).then(() => true)`);
        await app.call("Page.reload", {}); await sleep(2500); await laptop();
        await app.waitFor(`${q(".workspace")} && ${q(".launcher-button")} && true`, "canvas", 30_000);
      }
      await app.key("Home", "Home", 36); await sleep(600);
      await app.reveal(q('[data-note-source]') + `.closest("[data-sticky-note-id]")`); await sleep(500);
      await shot("cards-note-snapshot");
      await app.key("Home", "Home", 36); await sleep(600);
    });
    await scene("home-edit", async () => {
      await app.clickEl(q(".settings-button"));
      await app.waitFor(`${q(".settings-backdrop--open")} && true`, "settings open", 10_000);
      await app.clickEl(q("#settings-tab-appearance")); await sleep(500);
      const editBtn = `[...document.querySelectorAll(".home-appearance-settings .setting-inline-action")].find((b) => /HOME/.test(b.textContent))`;
      await app.ev(`(() => { ${editBtn}?.scrollIntoView({ block: "center" }); return true; })()`); await sleep(400);
      await app.clickEl(editBtn); await sleep(1200);
      await shot("home-edit");
      // the editor leaves with «Сохранить» (the layout is unchanged)
      await app.clickEl(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Сохранить" && !b.closest(".settings-panel"))`); await sleep(600);
      if (await app.ev(`!!${q(".settings-backdrop--open")}`)) await app.clickEl(q(".settings-panel__close"));
      await app.key("Home", "Home", 36); await sleep(600);
    });
    await scene("card-resize", async () => {
      await app.key("Home", "Home", 36); await sleep(600);
      const head = await app.ev(`(() => { const b = document.querySelector('[data-canvas-layer-id="terminal:${world.mock.a.id}"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 14 }; })()`);
      await app.click(head.x, head.y); await sleep(400);
      const r = await app.ev(`(() => { const b = document.querySelector('[data-canvas-layer-id="terminal:${world.mock.a.id}"]').getBoundingClientRect(); return { x: b.right - 2, y: b.top + b.height / 2 }; })()`);
      await app.mouse("mouseMoved", r.x, r.y); await sleep(500);
      await shot("card-resize");
      // the gesture: the corner is held and dragged, the size shows under the card
      const c = await app.ev(`(() => { const b = document.querySelector('[data-canvas-layer-id="terminal:${world.mock.a.id}"]').getBoundingClientRect(); return { x: b.right - 3, y: b.bottom - 3 }; })()`);
      await app.mouse("mouseMoved", c.x, c.y); await app.mouse("mousePressed", c.x, c.y, "left", 1);
      for (let i = 1; i <= 6; i++) { await app.mouse("mouseMoved", c.x + 6 * i, c.y + 4 * i, "left", 1); await sleep(40); }
      await sleep(400); await shot("card-resize-drag");
      await app.mouse("mouseReleased", c.x + 36, c.y + 24, "left", 0); await sleep(300);
      await app.mouse("mouseMoved", 700, 20);
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
      await app.reveal(q('[data-canvas-layer-id="browser"]')); await sleep(800);
      await shot("cards-browser");
    });

    // link dialog from the terminal output (cmd+click on the url)
    await scene("link-dialog", async () => {
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
        const r = await app.ev(`(() => { const els = ${JSON.stringify(selectors)}.map((x) => document.querySelector(x)).filter(Boolean).map((e) => e.getBoundingClientRect());
          const x = Math.min(...els.map((b) => b.left)), y = Math.min(...els.map((b) => b.top)); return { x, y, width: Math.max(...els.map((b) => b.right)) - x, height: Math.max(...els.map((b) => b.bottom)) - y }; })()`);
        const shotData = await app.call("Page.captureScreenshot", { format: "png", clip: { ...r, scale: 2 } });
        fs.writeFileSync(path.join(OUT, `${theme}-${name}.png`), Buffer.from(shotData.data, "base64"));
        console.log(`[shots-r5] clip ${theme}-${name}`);
      };
      if (!world.boardOn) {
        await app.clickEl(q("[data-board-import]")); await app.waitFor(`${q("[data-board-import-report]")} && true`, "the report");
        await sleep(600); await clip("board-report", ["[data-board]", "[data-board-aside]"]);
        await app.clickEl(q("[data-board-import-close]"));
        await clip("board-queue", ["[data-board]"]);
        await app.clickEl(q("[data-board-autopilot-start]")); await sleep(500);
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
      }
      await sleep(800);
      await clip("board", ["[data-board]", "[data-board-aside]"]);
    });
    await scene("cards-agents-working", async () => {
      await app.key("Escape", "Escape", 27);
      await app.clickEl(q("[data-board-menu]")); await app.clickEl(q("[data-board-hide]")); await sleep(500);
      await app.reveal(card(lead.agentId)); await pairView(lead.agentId, exec.agentId); await sleep(500);
      await shot("cards-agents-working");
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
        const d = await app.call("Page.captureScreenshot", { format: "png", clip: { ...r, scale: 2 } });
        fs.writeFileSync(path.join(OUT, `${theme}-board-states.png`), Buffer.from(d.data, "base64"));
        console.log(`[shots-r5] clip ${theme}-board-states`);
        await app.clickEl(q("[data-board-menu]")); await app.clickEl(q("[data-board-hide]")); await sleep(500);
      });
    }

  }
  console.log("[shots-r5] phase done");
} catch (error) {
  await app?.shot("failure").catch(() => {});
  console.error(String(error?.stack ?? error));
  failed.push(`FATAL ${String(error?.message ?? error).slice(0, 200)}`);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, "failed.txt"), failed.join("\n") + "\n");
  await app?.stop().catch(() => {});
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.rmSync(termDir, { recursive: true, force: true });
  site.close();
}
