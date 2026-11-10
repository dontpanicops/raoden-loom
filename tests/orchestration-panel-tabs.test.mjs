// R3a part A: the run panel's three tabs. Every key of the old eight-tab panel lands on a new tab (and mode or section),
// requests by legacy key or by parts agree, the compatibility layer gives the panel its old key back, and the panel
// still renders each legacy and each new view.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire, Module } from "node:module";
import { test } from "node:test";
import { LEGACY_VIEWS, legacyKeyOf, legacyView, normalizePanel, panelView }
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

test("the compatibility layer: a new view gives back the old key, an old state is accepted as it is", () => {
  for (const k of OLD) assert.equal(legacyKeyOf(legacyView(k)), k);
  assert.equal(legacyKeyOf({ tab: "work" }), "activity");
  const base = { linkId: "L", role: "lead", focus: 3 };
  for (const k of OLD) {
    assert.equal(normalizePanel({ ...base, tab: k }).tab, k, k);
    assert.equal(normalizePanel({ ...base, ...legacyView(k) }).tab, k, k);
  }
  assert.equal(normalizePanel({ ...base, tab: "work", mode: "records" }).tab, "history");
  assert.equal(normalizePanel({ ...base, tab: "summary", section: "overview" }).focus, 3);
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
  const view = { runId: "r", revision: 1, status: "running", reason: null, stage: 1, active: null, permission: null, halted: false, newer: null,
    workMode: "project", workDir: "/p", progress: null, proposal: null, refused: null, confirm: null, decisions: null };
  return (panel) => renderToStaticMarkup(React.createElement(mod.exports.RunPanel, {
    orch: { runs: { r: { view, open: true, seq: 9, tick: 0 } }, activity: { r: { entries: [], gaps: [], firstId: 0, status: "ready", resyncs: 0 } },
      runErrors: {}, canvas: { links: [], agents: [] }, journals: { r: { records: [], next: 0, status: "ready" } }, texts: {},
      commands: { pending: () => [] }, catalog: { checks: [] }, loadText() {}, syncJournal() {}, retry() {}, stageTitles: () => ({}) },
    runId: "r", locale: "ru", panel: { linkId: "L", role: "lead", focus: 1, ...panel }, onClose() {}, onNewGoal() {}, onView() {}
  }));
}

test("the panel renders every legacy key and every new view with the old markup (until part B)", { timeout: 120_000 }, async () => {
  const render = await loadRunPanel();
  const selected = (html) => html.match(/data-orch-tab="(\w+)"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-orch-tab="(\w+)"/)?.slice(1).find(Boolean);
  for (const k of OLD) {
    assert.equal(selected(render({ tab: k })), k, `legacy ${k}`);
    assert.equal(selected(render({ ...legacyView(k), mode: legacyView(k).mode ?? "feed" })), k, `new ${k}`);
  }
});
