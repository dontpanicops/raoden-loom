// Frames for the mock-up conformance audit (every screen except the run panel): first-run, canvas, HOME, cards, board,
// goal dialog, overlays, settings, launch card, project settings, workspaces dialogs, canvas bits, links. 1440x900,
// sand and paper. Real window, fake CLIs, no model. A scene that cannot be taken is logged and skipped (see failed.txt).
// Needs `npm run build` first. Usage: node scripts/shots-r5.mjs --out <dir> [--themes sand,paper] [--only <scene substring>]
import fs from "node:fs";
import path from "node:path";
import { FIXTURES, NODE, launch, q, sleep, workspace, byText, card, canvasState, createAgent } from "./orchestration-app-kit.mjs";

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

const wrap = (p) => {
  const f = D(`${p}-mock`);
  fs.writeFileSync(f, `#!/bin/sh\nexec "${NODE}" "${path.join(FIXTURES, `mock-${p}.mjs`)}" "$@"\n`, { mode: 0o755 });
  return f;
};
// a CLI that is "found" (the launch card of an installed agent); the others stay missing (the "CLI not found" card)
const cliBin = D("cli-bin");
fs.mkdirSync(cliBin, { recursive: true });
// its window title tells the app what it does: a folder named *waiting* asks for approval, *working* works (mock 10 palette)
fs.writeFileSync(path.join(cliBin, "claude"), `#!/bin/sh\ncase "$PWD" in *waiting*) printf '\\033]0;✳ Claude\\007';; *working*) printf '\\033]0;◐ Claude\\007';; esac\nexec sleep 3000\n`, { mode: 0o755 });
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
const BOARD_FILE = D("chosen", "tasks.json");
const row = (ref, over = {}) => ({ ref, project: node, title: `Задача ${ref}`, text: `Сделать ${ref}`, criteria: [`${ref} готово`], ...over });
fs.mkdirSync(path.dirname(BOARD_FILE), { recursive: true });
fs.writeFileSync(BOARD_FILE, JSON.stringify({ format: "board-tasks/v1", workspaceId: "common", source: "shots", tasks: [
  row("A", { title: "Экспорт заметок в Markdown" }), row("B", { title: "Поиск по заметкам", dependsOn: ["A"] }),
  row("C", { title: "Удаление заметок" }), row("D", { title: "Модель заметки и хранилище", dependsOn: ["A"] })] }));

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
async function scene(name, fn) {
  if (!wanted(name)) return;
  try { await fn(); console.log(`[shots-r5] ${theme} ${name}: ok`); }
  catch (e) {
    const msg = `${theme} ${name}: ${String(e?.message ?? e).split("\n")[0].slice(0, 200)}`;
    console.log(`[shots-r5] FAILED ${msg}`); failed.push(msg);
    try { await app.shot(`fail-${theme}-${name}`); await esc(); } catch { /* ignore */ }
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

try {
  app = await launch({ userData, providers, port: PORT, shots: OUT, env: { CANVASTTY_SMOKE_CLI_DIR: cliBin, CANVASTTY_USER_DATA_DIR: userData, CANVASTTY_SMOKE_IMPORT_FILE: BOARD_FILE } });
  await laptop();
  await app.waitFor(`${q(".workspace")} && true`, "window", 30_000);

  // ---- phase 1: first run on an empty canvas
  for (theme of THEMES) {
    await scene("firstrun", async () => {
      await settle({ onboardingDismissed: false });
      await shot("firstrun");
    });
  }

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
  await createAgent(app, "Агент Codex (лид)", node);
  await createAgent(app, "Агент Claude (исполнитель)", node);
  await app.key("Home", "Home", 36); await sleep(1200);
  const cs = await canvasState(app);
  const lead = cs.agents.find((a) => a.provider === "codex"), exec = cs.agents.find((a) => a.provider === "claude");
  await app.reveal(card(exec.agentId));
  await app.drag(await app.center(card(lead.agentId, ".agent-card__port")), await app.center(card(exec.agentId, ".agent-card__body")), 20);
  await app.waitFor(`window.canvasTTY.orchestration.canvas().then((r) => r.value.links.length === 1)`, "link");
  const linkId = (await canvasState(app)).links[0].linkId;
  await app.key("Home", "Home", 36); await sleep(800);

  for (theme of THEMES) {
    await settle();
    await scene("home-canvas", async () => { await hideOnboarding(); await app.key("Home", "Home", 36); await sleep(900); await shot("home-canvas"); });

    await scene("cards", async () => {
      await app.reveal(`document.querySelector(".terminal-card")`); await sleep(500);
      await shot("cards-terminal");
      await app.clickEl(`document.querySelector(".terminal-card__header")`); await sleep(500);
      await shot("cards-terminal-selected");
      await app.click(40, 880);
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
      // an agent that waits for approval, one that works, a terminal that failed: the palette's three groups and its chips
      const mkdir = (name) => { const d = path.join(termDir, name); fs.mkdirSync(d, { recursive: true }); return d; };
      const mk = (provider, cwd, x, y) => app.ev(`window.canvasTTY.terminal.create({ provider: ${JSON.stringify(provider)}, profile: "normal", cwd: ${JSON.stringify(cwd)}, position: { x: ${x}, y: ${y} } })`);
      if (!world.palette) {
        world.palette = [await mk("claude", mkdir("project-waiting"), 2400, 2500), await mk("claude", mkdir("project-working"), 2800, 2500)];
        const bad = await mk("terminal", mkdir("infra"), 3200, 2500); await sleep(1500);
        await app.ev(`window.canvasTTY.terminal.input(${JSON.stringify(bad.id)}, ${JSON.stringify("exit 1\r")})`); world.palette.push(bad);
        await sleep(2500);
      }
      await meta("k", "KeyK", 75);
      await app.waitFor(`${q(".canvas-command-palette")} && true`, "palette", 5000);
      await shot("overlay-palette-waiting"); await esc();
    });
    await scene("overlay-region-menu", async () => {
      await app.key("Home", "Home", 36); await sleep(900);
      if (!(await app.ev(`!!document.querySelector(".canvas-region__title")`))) { // the second theme finds the first one's region
        const spot = await app.freeRect(40, 40);
        await app.click(spot.x + 20, spot.y + 20, "right"); await sleep(500);
        await app.clickEl(`[...document.querySelectorAll(".canvas-menu [role=menuitem]")].find((e) => /егион|бласть/.test(e.textContent))`); await sleep(800);
        await app.clickEl(`[...document.querySelectorAll("button")].find((e) => e.textContent.trim() === "Создать")`); await sleep(900);
      }
      const reg = await app.center(`document.querySelector(".canvas-region__title")`);
      await app.click(reg.x, reg.y, "right"); await sleep(600);
      await shot("canvas-region-menu"); await esc();
    });
    await scene("overlay-toast", async () => {
      // the app has no source of "waiting" toasts with an action yet: the three states of mock 10 need a temporary
      // window.__r5Toast(message, kind, action, title) in App.tsx (not committed); without it, the one real toast (F2)
      if (await app.ev(`typeof window.__r5Toast === "function"`)) {
        await app.ev(`(() => { const t = window.__r5Toast; t("project-b · разрешение MCP", "waiting", { label: "Перейти", run() {} }, "Claude ждёт разрешения"); t("project-c · Claude CLI, код 1", "error", { label: "Открыть", run() {} }, "Запуск упал"); t("project-a · проверки прошли, ревью принято", "success", { label: "Итог", run() {} }, "Запуск завершён"); return true; })()`);
      } else { await app.click(40, 880); await app.key("F2", "F2", 113); }
      await sleep(600);
      await shot("overlay-toast");
    });

    // settings tabs
    await scene("settings", async () => {
      await app.clickEl(q(".settings-button"));
      await app.waitFor(`${q(".settings-backdrop--open")} && true`, "settings open", 10_000);
      for (const tab of ["general", "notifications", "appearance", "agents", "controls", "browser", "plugins", "about"]) {
        try { await app.clickEl(q(`#settings-tab-${tab}`)); await sleep(500); await shot(`settings-${tab}`); }
        catch (e) { failed.push(`${theme} settings-${tab}: ${String(e.message).slice(0, 120)}`); }
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
    // board (R4c)
    await scene("board", async () => {
      await app.key("Home", "Home", 36); await sleep(600);
      if (!(await app.ev(`!!${q("[data-board]")}`))) await app.clickEl(q("[data-board-button]"));
      await app.waitFor(`${q("[data-board]")} && true`, "the board");
      if (!(await app.ev(`!!${q("[data-board-task]")}`))) {
        await app.clickEl(q("[data-board-import]")); await app.waitFor(`${q("[data-board-import-report]")} && true`, "the report");
        await sleep(600); await shot("board-report");
        await app.clickEl(q("[data-board-import-close]"));
      }
      await sleep(500); await shot("board");
      await app.clickEl(q("[data-board-autopilot-start]")); await sleep(500);
      await shot("board-autopilot");
    });
    await scene("board-close", async () => { if (await app.ev(`!!${q("[data-board]")}`)) await app.clickEl(q("[data-board-hide]")); await sleep(500); });

    // goal dialog and project settings
    await scene("goal", async () => {
      await app.reveal(card(lead.agentId)); await fit();
      await app.clickEl(byText(`[data-agent-link-id="${linkId}"] button`, "Новая цель"));
      await app.waitFor(`${q(".orch-dialog textarea")} && true`, "goal dialog");
      await app.waitFor(`${q("[data-orch-profile]")}?.dataset.orchProfile !== "loading"`, "profile", 20_000);
      await app.type(`document.querySelectorAll(".orch-dialog textarea")[0]`, "Добавить заметки к задачам доски: создание, список и удаление. Хранить локально.");
      await app.type(`document.querySelectorAll(".orch-dialog textarea")[1]`, "Без новых зависимостей\nТесты на пустой список заметок");
      await app.type(q("[data-orch-commands]"), "node --test\nnpm run lint");
      await sleep(2500);
      await shot("goal-dialog");
      const ps = await app.ev(`(() => { const b = [...document.querySelectorAll(".orch-dialog button")].find((e) => /Настройки проекта/.test(e.textContent)); if (!b) return false; b.scrollIntoView(); b.click(); return true; })()`);
      if (!ps) { await esc(); throw new Error("no project settings button in the goal dialog"); }
      await sleep(1500);
      await shot("project-settings");
      await esc(); await sleep(300); await esc();
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
    await scene("cards-exit", async () => {
      const mk = async (x, y, cmd) => {
        const tt = await app.ev(`window.canvasTTY.terminal.create({ provider: "terminal", profile: "normal", cwd: ${JSON.stringify(termDir)}, position: { x: ${x}, y: ${y} } })`);
        await sleep(1500);
        await app.ev(`window.canvasTTY.terminal.input(${JSON.stringify(tt.id)}, ${JSON.stringify(cmd + "\r")})`);
        return tt.id;
      };
      if (!world.exit) { world.exit = [await mk(-300, 760, "echo done; exit 0"), await mk(-300, 1250, "echo oops >&2; exit 1")]; }
      await sleep(1500);
      await app.reveal(`document.querySelectorAll(".terminal-card")[1]`); await sleep(600);
      await shot("cards-exit");
    });
    await scene("browser", async () => {
      await app.key("Home", "Home", 36); await sleep(600);
      await app.clickEl(q(".launcher-button--browser")); await sleep(2500);
      await shot("cards-browser");
    });

    // link dialog from the terminal output (cmd+click on the url)
    await scene("link-dialog", async () => {
      await app.reveal(`document.querySelectorAll(".terminal-card")[0]`); await sleep(500);
      const pt = await app.ev(`(() => { const rows = [...document.querySelectorAll(".terminal-card .xterm-rows > div")]; const r = rows.find((e) => e.textContent.trim().endsWith("localhost:5173/")); if (!r) return null; const b = r.getBoundingClientRect(); const txt = r.textContent; const cw = b.width / Math.max(txt.length, 1); const i = txt.indexOf("http"); return { x: b.left + cw * (i + 12), y: b.top + b.height / 2 }; })()`);
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
      const spot = await app.freeRect(40, 40);
      await app.mouse("mouseMoved", spot.x + 150, spot.y + 150);
      await app.mouse("mousePressed", spot.x + 150, spot.y + 150, "right", 2); await sleep(700);
      await app.mouse("mouseMoved", spot.x + 150, spot.y + 100, "right", 2); await sleep(400);
      await shot("overlay-radial");
      await app.mouse("mouseReleased", spot.x + 150, spot.y + 100, "right", 0); await sleep(300); await esc();
      await app.ev(`window.canvasTTY.settings.update({ radialLauncherEnabled: false }).then(() => true)`);
    });

    await scene("ws-bar-back", async () => { await app.clickEl(`[...document.querySelectorAll(".workspace-bar__tab")][0]`); await sleep(800); });
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
}
