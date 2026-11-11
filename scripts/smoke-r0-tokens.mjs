// R0 smoke (stage-r-redesign.md R0 "Готово, когда"): computed styles in Sand, Paper, Frost, Bay and with followSystem (CDP prefers-color-scheme).
//   - on `.app` --status-working-bg, --home-clock, --danger-fg, --on-status are not empty;
//   - --term-bg equals the open terminal's theme background. The xterm instance is not exposed to the page, so its
//     theme.background is read from where xterm applies it: the computed background of `.xterm-viewport` (xterm's stylesheet rule from theme.background).
// Needs `npm run build` first. Starts no model. Usage: node scripts/smoke-r0-tokens.mjs
import fs from "node:fs";
import { launch, q, sleep, workspace } from "./orchestration-app-kit.mjs";

const { TMP, D } = workspace("cto-r0tok-");
const PORT = 9400 + Math.floor(Math.random() * 400);
const termDir = fs.realpathSync(fs.mkdtempSync("/private/tmp/r0-tok-"));
const failures = [], passed = [];
const expect = (ok, what, got) => { (ok ? passed : failures).push(ok ? what : `${what}: ${JSON.stringify(got)}`); };
let app;
try {
  app = await launch({ userData: D("user-data"), port: PORT });
  await app.waitFor(`${q(".app")} && ${q(".workspace")} && true`, "window", 30_000);
  const t = await app.ev(`window.canvasTTY.terminal.create({ provider: "terminal", profile: "normal", cwd: ${JSON.stringify(termDir)}, position: { x: 500, y: 760 } })`);
  await app.waitFor(`${q(".terminal-card .xterm-viewport")} && true`, "terminal drawn", 20_000);
  await sleep(500);
  const read = () => app.ev(`(() => {
    const root = document.querySelector(".app"), s = getComputedStyle(root);
    const names = ["--status-working-bg", "--home-clock", "--danger-fg", "--on-status", "--term-bg"];
    const v = Object.fromEntries(names.map((n) => [n, s.getPropertyValue(n).trim()]));
    const vp = document.querySelector(".terminal-card .xterm-viewport");
    return { classes: root.className, v, viewport: vp ? getComputedStyle(vp).backgroundColor : null };
  })()`);
  // xterm writes the colour as rgb(...) or #hex: both sides go to one form through a canvas
  const norm = (c) => app.ev(`(() => { const x = document.createElement("canvas").getContext("2d"); x.fillStyle = "#000"; x.fillStyle = ${JSON.stringify(c)}; return x.fillStyle.toLowerCase(); })()`);
  const check = async (theme, why) => {
    await app.waitFor(`document.querySelector(".app")?.classList.contains("app--${theme}")`, `${why}: class app--${theme}`, 10_000);
    await sleep(400);
    const r = await read();
    expect(new RegExp(`\\bapp--${theme}\\b`).test(r.classes), `${why}: root class is app--${theme}`, r.classes);
    for (const n of ["--status-working-bg", "--home-clock", "--danger-fg", "--on-status"]) expect(r.v[n] !== "", `${n} is not empty in ${why}`, r.v[n]);
    const [a, b] = [await norm(r.v["--term-bg"]), await norm(r.viewport ?? "")];
    expect(r.viewport && a === b, `${why}: --term-bg equals the terminal theme background (xterm viewport)`, { termBg: r.v["--term-bg"], viewport: r.viewport });
    return r;
  };
  const r = await check("sand", "default Sand");
  const set = async (patch) => {
    await app.ev(`window.canvasTTY.settings.update(${JSON.stringify(patch)}).then(() => true)`);
    await app.call("Page.reload", {}); await sleep(1500);
    await app.waitFor(`${q(".workspace")} && ${q(".terminal-card .xterm-viewport")} && true`, "canvas and terminal after reload", 30_000);
  };
  for (const theme of ["paper", "frost", "bay"]) { await set({ palette: theme, followSystem: false }); await check(theme, `manual ${theme}`); }
  // followSystem: the system theme is emulated through CDP; palette (manual choice) stays untouched
  await set({ palette: "frost", followSystem: true });
  await app.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await check("paper", "followSystem + light system");
  await app.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await check("sand", "followSystem + dark system");
  expect((await app.ev(`window.canvasTTY.settings.get()`)).palette === "frost", "followSystem does not overwrite palette", null);
  await app.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await set({ palette: "bay", followSystem: false });
  await check("bay", "manual choice beats the light system");
  console.log(JSON.stringify({ ok: failures.length === 0, passed, failures, values: r.v, viewport: r.viewport }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
  void t;
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error?.stack ?? error), passed, failures }, null, 2));
  process.exitCode = 1;
} finally {
  await app?.stop().catch(() => {});
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.rmSync(termDir, { recursive: true, force: true });
}
