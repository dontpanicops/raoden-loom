// R3a part A: the run panel's three tabs. Every key of the old eight-tab panel lands on a new tab (and mode or section),
// requests by legacy key or by parts agree, and the panel (part B) draws exactly three tabs, the summary's sections
// and the work modes.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire, Module } from "node:module";
import { test } from "node:test";
import { LEGACY_VIEWS, legacyView, panelView }
  from "../src/renderer/src/features/orchestration/panelTabs.ts";
import { liveRuns, shownRunId } from "../src/renderer/src/features/orchestration/runModel.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OLD = ["plan", "result", "summary", "overview", "activity", "changes", "log", "history"];

test("each of the eight old keys opens a new tab, with its mode or section", () => {
  assert.deepEqual(Object.keys(LEGACY_VIEWS).sort(), [...OLD].sort());
  assert.deepEqual(legacyView("activity"), { tab: "work", mode: "feed" });
  assert.deepEqual(legacyView("log"), { tab: "work", mode: "journal" });
  assert.deepEqual(legacyView("history"), { tab: "work", mode: "records" });
  assert.deepEqual(legacyView("changes"), { tab: "changes" });
  assert.deepEqual(legacyView("summary"), { tab: "summary" });
  assert.deepEqual(legacyView("plan"), { tab: "summary", section: "plan" });
  assert.deepEqual(legacyView("result"), { tab: "summary", section: "result" });
  assert.deepEqual(legacyView("overview"), { tab: "summary", section: "overview" });
  for (const k of OLD) assert.ok(["summary", "work", "changes"].includes(legacyView(k).tab), k);
  assert.equal(legacyView("nope"), null);
  assert.equal(legacyView("constructor"), null);
});

test("a view request by legacy key, by new parts or by a legacy tab inside parts means the same", () => {
  assert.deepEqual(panelView("history"), { tab: "work", mode: "records" });
  assert.deepEqual(panelView({ tab: "work", mode: "journal", role: "lead" }), { tab: "work", mode: "journal", role: "lead" });
  assert.deepEqual(panelView({ tab: "activity", role: "check" }), { tab: "work", mode: "feed", role: "check" });
  assert.deepEqual(panelView({ tab: "summary", section: "plan" }), { tab: "summary", section: "plan" });
  assert.deepEqual(panelView({ role: "reviewer" }), { role: "reviewer" });
  assert.deepEqual(panelView(undefined), {});
  assert.deepEqual(panelView("bogus"), {});
});

test("the live runs of a link and the one shown (the chip and the panel agree)", () => {
  const runs = { a: { view: { status: "running" } }, b: { view: { status: "completed" } }, c: { view: { status: "paused" } }, d: { view: { status: "completed" } } };
  const link = { linkId: "L", runIds: ["a", "b", "c", "d"] };
  assert.deepEqual(liveRuns(link, runs), ["a", "c"]);
  assert.equal(shownRunId(link, runs, {}), "c");
  assert.equal(shownRunId(link, runs, { L: "a" }), "a");
  assert.equal(shownRunId(link, runs, { L: "b" }), "c"); // a picked run that ended is not kept
  assert.equal(shownRunId({ linkId: "M", runIds: ["b", "d"] }, runs, {}), "d");
  assert.equal(shownRunId(undefined, runs, {}), undefined);
});

async function loadRunPanel() {
  const require = createRequire(path.join(HERE, "..", "package.json"));
  const out = await require("esbuild").build({
    entryPoints: [path.join(HERE, "..", "src/renderer/src/features/orchestration/RunPanel.tsx")],
    bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent",
    loader: { ".svg": "dataurl", ".png": "dataurl", ".ico": "dataurl", ".webp": "dataurl", ".jpg": "dataurl" },
    plugins: [{ name: "same-react", setup(b) { b.onResolve({ filter: /^react(\/.*)?$/ }, (a) => ({ path: require.resolve(a.path), external: true })); } }]
  });
  const file = path.join(HERE, "..", "run-panel-panel-tabs.cjs");
  const mod = new Module(file);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.join(HERE, ".."));
  mod._compile(out.outputFiles[0].text, file);
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const base = { runId: "r", revision: 1, status: "running", reason: null, stage: 1, active: null, permission: null, halted: false, newer: null,
    workMode: "project", workDir: "/p", progress: null, proposal: null, refused: null, confirm: null, decisions: null };
  return (panel, { view = {}, live, extraRuns = {} } = {}) => renderToStaticMarkup(React.createElement(mod.exports.RunPanel, {
    liveRunIds: live,
    orch: { runs: { r: { view: { ...base, ...view }, open: true, seq: 9, tick: 0 }, ...extraRuns }, activity: { r: { entries: [], gaps: [], firstId: 0, status: "ready", resyncs: 0 } },
      runErrors: {}, canvas: { links: [], agents: [] }, journals: { r: { records: [], next: 0, status: "ready" } }, texts: {},
      commands: { pending: () => [] }, catalog: { checks: [] }, loadText() {}, syncJournal() {}, retry() {}, stageTitles: () => ({}) },
    runId: "r", locale: "ru", panel: { linkId: "L", role: "lead", focus: 1, ...panel }, onClose() {}, onNewGoal() {}, onView() {}
  }));
}

const attr = (html, name) => [...html.matchAll(new RegExp(`${name}="(\\w+)"`, "g"))].map((m) => m[1]);
const selected = (html) => html.match(/data-orch-tab="(\w+)"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-orch-tab="(\w+)"/)?.slice(1).find(Boolean);

test("the panel draws exactly three tabs (two for a newer version's run), each old key selects its new tab", { timeout: 120_000 }, async () => {
  const render = await loadRunPanel();
  assert.deepEqual(attr(render({ tab: "summary", mode: "feed" }), "data-orch-tab"), ["summary", "work", "changes"]);
  assert.deepEqual(attr(render({ tab: "summary", mode: "feed" }, { view: { newer: { version: 9, compatible: true, chain: "ok" } } }), "data-orch-tab"), ["summary", "work"]);
  for (const k of OLD) {
    const v = legacyView(k);
    const html = render({ ...v, mode: v.mode ?? "feed" });
    assert.equal(selected(html), v.tab, k);
    if (v.mode) assert.match(html, new RegExp(`data-orch-mode="${v.mode}"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-orch-mode="${v.mode}"`), k);
    if (v.section) assert.match(html, new RegExp(`data-orch-section="${v.section}"`), k);
  }
});

test("the summary holds the overview, plan and result sections; the plan and the result read nothing until opened", { timeout: 120_000 }, async () => {
  const render = await loadRunPanel();
  const closed = render({ tab: "summary", mode: "feed" });
  assert.deepEqual(attr(closed, "data-orch-section"), ["overview", "plan", "result"]);
  assert.match(closed, /data-orch-facts/);
  assert.match(closed, /data-orch-participants/);
  assert.match(closed, /data-orch-proof="active"/, "the proof line opens the facts");
  assert.doesNotMatch(closed, /data-run-doc=/, "closed: no document drawn");
  assert.match(render({ tab: "summary", mode: "feed", section: "plan" }, { view: { status: "paused" } }), /<details[^>]*data-orch-section="plan"[^>]*open/);
});

test("the work tab: three modes, the role filter on the feed and the journal only, the body says which mode", { timeout: 120_000 }, async () => {
  const render = await loadRunPanel();
  for (const mode of ["feed", "journal", "records"]) {
    const html = render({ tab: "work", mode, role: "lead" });
    assert.deepEqual(attr(html, "data-orch-mode").filter((m, i, a) => a.indexOf(m) === i), ["feed", "journal", "records"]);
    assert.match(html, new RegExp(`data-orch-body="work" data-orch-mode="${mode}"`));
    assert.equal(/data-orch-role=/.test(html), mode !== "records", mode);
  }
  assert.doesNotMatch(render({ tab: "summary", mode: "feed" }), /data-orch-mode=/);
});

test("the Changes tab shows its count only when it is known; the live-run switch shows from two runs", { timeout: 120_000 }, async () => {
  const render = await loadRunPanel();
  assert.doesNotMatch(render({ tab: "summary", mode: "feed" }), /data-orch-changes-count/, "not counted yet: no badge");
  assert.doesNotMatch(render({ tab: "summary", mode: "feed" }, { live: ["r"] }), /data-orch-runs/);
  const two = render({ tab: "summary", mode: "feed" }, { live: ["r", "q"], extraRuns: { q: { view: { status: "paused" }, open: true, seq: 1, tick: 0 } } });
  assert.deepEqual(attr(two, "data-orch-run-pick"), ["r", "q"]);
  assert.match(two, /data-run-status="paused"/);
});
