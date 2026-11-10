// FPS of canvas panning with 100 agent cards (no PTY), stage R0 (spec: stage-r-redesign.md, R0 step 10).
// Launches the built app (needs `npm run build` first) through the smoke kit: the window is painted and focused, timers and
// frames are not throttled (the kit's PAINTED switches + CDP focus emulation; the browser view's backgroundThrottling:false
// is already set in BrowserService), the 100 cards are made through the orchestration IPC, the canvas is panned by a
// mouse drag for DURATION ms, frames are counted by requestAnimationFrame. 3 runs, the median is the result.
// The baseline is this script against a build of main on the same machine; the person who takes it records both numbers.
// Usage: node scripts/fps-pan.mjs [--runs 3] [--cards 100] [--seconds 6] [--out result.json]
import fs from "node:fs";
import path from "node:path";
import { launch, q, sleep, workspace } from "./orchestration-app-kit.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const RUNS = Number(arg("runs", 3));
const CARDS = Number(arg("cards", 100));
const SECONDS = Number(arg("seconds", 6));
const OUT = arg("out", null);
const COLS = 10;

const { D } = workspace("fps-pan-");
const project = D("project");
fs.mkdirSync(project, { recursive: true });
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function oneRun(index) {
  const port = 9750 + Math.floor(Math.random() * 100);
  const app = await launch({ userData: D(`user-data-${index}`), port });
  try {
    await app.call("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await app.call("Emulation.setFocusEmulationEnabled", { enabled: true });
    await app.call("Page.bringToFront");
    await app.waitFor(`${q(".workspace")} && true`, "window", 30_000);

    const made = await app.ev(`(async () => {
      let ok = 0;
      for (let i = 0; i < ${CARDS}; i++) {
        const r = await window.canvasTTY.orchestration.createAgent({
          agentId: crypto.randomUUID(), provider: i % 2 ? "claude" : "codex", project: ${JSON.stringify(project)}, workspaceId: "common",
          bounds: { position: { x: 400 + (i % ${COLS}) * 340, y: 300 + Math.floor(i / ${COLS}) * 216 }, size: { width: 300, height: 176 } }
        });
        if (r && r.ok !== false) ok += 1;
      }
      return ok;
    })()`);
    if (made !== CARDS) throw new Error(`only ${made} of ${CARDS} agent cards were made`);
    await app.ev("location.reload()").catch(() => {});
    await app.waitFor(`document.querySelectorAll("[data-agent-id]").length >= ${CARDS}`, `${CARDS} agent cards`, 60_000);
    await sleep(1500);

    // an empty canvas point to press on
    const W = await app.ev("innerWidth"), H = await app.ev("innerHeight");
    let start = null;
    for (let y = 80; y < H - 40 && !start; y += 40) for (let x = 40; x < W - 40 && !start; x += 40) if (await app.isEmpty(x, y)) start = { x, y };
    if (!start) throw new Error("no empty canvas to drag");

    await app.ev(`(() => { const s = { frames: 0, deltas: [], last: 0, stop: false };
      window.__fps = s;
      const tick = (t) => { if (s.last) s.deltas.push(t - s.last); s.last = t; s.frames += 1; if (!s.stop) requestAnimationFrame(tick); };
      requestAnimationFrame(tick); })()`);
    const begin = Date.now();
    await app.mouse("mouseMoved", start.x, start.y);
    await app.mouse("mousePressed", start.x, start.y, "left", 1);
    while (Date.now() - begin < SECONDS * 1000) {
      const phase = ((Date.now() - begin) / 1000) * 2 * Math.PI;
      const x = Math.min(W - 10, Math.max(10, start.x + Math.sin(phase) * 240));
      const y = Math.min(H - 10, Math.max(50, start.y + Math.cos(phase) * 120));
      await app.mouse("mouseMoved", x, y, "left", 1);
      await sleep(8);
    }
    await app.mouse("mouseReleased", start.x, start.y, "left", 0);
    const stats = await app.ev(`(() => { const s = window.__fps; s.stop = true;
      const d = [...s.deltas].sort((a, b) => a - b); const total = d.reduce((a, b) => a + b, 0);
      return { frames: d.length, fps: d.length / (total / 1000), p95Ms: d[Math.floor(d.length * 0.95)] ?? null, p99Ms: d[Math.floor(d.length * 0.99)] ?? null, maxMs: d[d.length - 1] ?? null }; })()`);
    console.log(`[fps-pan] run ${index + 1}: ${stats.fps.toFixed(1)} fps, p95 frame ${stats.p95Ms?.toFixed(1)} ms, p99 ${stats.p99Ms?.toFixed(1)} ms, worst ${stats.maxMs?.toFixed(1)} ms (${stats.frames} frames)`);
    return stats;
  } finally {
    await app.stop();
  }
}

try {
  const results = [];
  for (let i = 0; i < RUNS; i++) results.push(await oneRun(i));
  const summary = {
    cards: CARDS, seconds: SECONDS, runs: results,
    medianFps: median(results.map((r) => r.fps)), medianP95Ms: median(results.map((r) => r.p95Ms ?? 0)), medianP99Ms: median(results.map((r) => r.p99Ms ?? 0)),
    machine: `${process.platform}-${process.arch}`, node: process.version
  };
  console.log(`[fps-pan] median over ${RUNS}: ${summary.medianFps.toFixed(1)} fps, p95 frame ${summary.medianP95Ms.toFixed(1)} ms, p99 ${summary.medianP99Ms.toFixed(1)} ms`);
  if (OUT) fs.writeFileSync(path.resolve(OUT), `${JSON.stringify(summary, null, 2)}\n`);
} finally {
  fs.rmSync(D(), { recursive: true, force: true });
}
