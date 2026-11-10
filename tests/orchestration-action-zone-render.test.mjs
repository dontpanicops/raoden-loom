// R3b part B: the action zone and the panel's footer as the run panel draws them — one main button, the dangerous ones
// outlined, the clarify field as the model says, Stop in the footer (or the main button where it is all main allows),
// a refusal of main apart from a lost connection, the reference facts moved out of the zone.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire, Module } from "node:module";
import { test } from "node:test";
import { legacyView } from "../src/renderer/src/features/orchestration/panelTabs.ts";
import { SETS37, fixture, view } from "./fixtures/orchestration/zone-sets.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const requireApp = createRequire(path.join(HERE, "..", "package.json"));
async function bundle(entry) {
  const out = await requireApp("esbuild").build({
    entryPoints: [path.join(HERE, "..", entry)], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent",
    loader: { ".svg": "dataurl", ".png": "dataurl", ".ico": "dataurl", ".webp": "dataurl", ".jpg": "dataurl" },
    plugins: [{ name: "same-react", setup(b) { b.onResolve({ filter: /^react(\/.*)?$/ }, (a) => ({ path: requireApp.resolve(a.path), external: true })); } }]
  });
  const file = path.join(HERE, "..", `${path.basename(entry)}.zone-render.cjs`);
  const mod = new Module(file);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.join(HERE, ".."));
  mod._compile(out.outputFiles[0].text, file);
  return mod.exports;
}
const panelOf = async () => {
  const React = requireApp("react");
  const { renderToStaticMarkup } = requireApp("react-dom/server");
  const { RunPanel } = await bundle("src/renderer/src/features/orchestration/RunPanel.tsx");
  return (set, { locale = "ru", extra = {}, pending = [], withSettings = true } = {}) => {
    const f = typeof set === "string" ? fixture(set) : set;
    const v = { ...f.view, ...extra };
    if (v.progress) v.progress = { mode: "autopilot", checks: [], finish: [], ...v.progress }; // the fixtures carry only what their pause reads
    return renderToStaticMarkup(React.createElement(RunPanel, {
      orch: { runs: { r: { view: v, open: true, seq: 9, tick: 0 } }, activity: { r: { entries: f.entries, gaps: [], firstId: f.entries[0]?.id ?? 0, status: "ready", resyncs: 0 } },
        runErrors: {}, canvas: { links: [], agents: [] }, journals: { r: { records: [], next: 0, status: "ready" } }, texts: {},
        commands: { pending: () => pending }, catalog: { checks: [] }, loadText() {}, syncJournal() {}, retry() {}, stageTitles: () => ({}) },
      runId: "r", locale, panel: { linkId: "L", mode: "feed", ...legacyView("overview"), role: "lead", focus: 1 }, onClose() {}, onNewGoal() {}, onView() {},
      onProjectSettings: withSettings ? () => {} : undefined
    }));
  };
};
const buttons = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], text: m[2].replace(/<[^>]+>/g, "") }));
const zoneOf = (html) => html.slice(html.indexOf("data-orch-summary"), html.indexOf('id="orch-tabpanel"'));
const footOf = (html) => (html.includes("data-orch-foot") ? html.slice(html.indexOf("data-orch-foot")) : "");
const mainOf = (html) => buttons(zoneOf(html) + footOf(html)).filter((b) => /data-orch-primary=/.test(b.attrs));

test("every pause draws one main button; the filled danger one only where Stop is all main allows; Stop sits in the footer otherwise", async () => {
  const panel = await panelOf();
  const stopMain = ["lead_modified_tree", "shared_git_tampered", "journal_corrupt", "sandbox_unavailable", "sandbox_unsupported", "push_protected"];
  for (const set of SETS37.filter((x) => x !== "newer_version" && x !== "awaiting_person_decision" && x !== "coverage_lost" && x !== "awaiting_finish_confirmation" && x !== "check_needs_permissions" && x !== "awaiting_answer")) {
    let html;
    try { html = panel(set); } catch (e) { throw new Error(`${set}: ${e.message}`); }
    assert.equal(mainOf(html).length, 1, `${set}: one main button`);
    assert.equal(html.split("data-orch-what").length - 1, 1, `${set}: one headline`);
    const stops = buttons(html).filter((b) => /data-orch-stop|data-orch-primary="stop"/.test(b.attrs));
    assert.equal(stops.length, 1, `${set}: Stop once`);
    if (stopMain.includes(set)) {
      assert.match(stops[0].attrs, /orch-danger/, set);
      assert.doesNotMatch(footOf(html), /data-orch-stop/, `${set}: not in the footer`);
    } else {
      assert.match(stops[0].attrs, /class="orch-stop"/, `${set}: outlined`);
      assert.match(footOf(html), /data-orch-stop/, `${set}: in the footer`);
    }
  }
});

test("dangerous buttons are outlined and ask first; the outcome reset only in a managed copy", async () => {
  const panel = await panelOf();
  const reset = buttons(panel("outcome_unknown")).find((b) => /data-orch-zone-action="recover_reset"/.test(b.attrs));
  assert.match(reset.attrs, /class="orch-stop"/);
  assert.ok(!buttons(panel("outcome_unknown", { extra: { workMode: "worktree" } })).some((b) => /recover_reset/.test(b.attrs)), "never in a worktree");
  const none = panel("awaiting_checks_none");
  const accept = buttons(none).find((b) => /data-orch-checks-accept/.test(b.attrs));
  assert.equal(accept.text, "Продолжить без проверок");
  assert.match(accept.attrs, /class="orch-stop"/);
  const save = buttons(none).find((b) => /data-orch-checks-save/.test(b.attrs));
  assert.match(save.attrs, /disabled/, "no commands, nothing to save");
  assert.match(save.attrs, /orch-primary/);
  const plan = panel("coverage_lost", { extra: { decisions: { runKey: "k".repeat(64), disputed: [], conditions: [], findings: false,
    proposal: { proposalTurnId: "t1", dropped: [{ id: "C2", text: "x", covers: [], why: "y" }], dropRequirements: [], uncovered: [], stages: [{ stage: 1, title: "N" }], findings: [] } } } });
  assert.match(buttons(plan).find((b) => /data-orch-proposal-accept/.test(b.attrs)).attrs, /class="orch-stop"/);
});

test("the clarify field is what the model says: closed, open, off with its reason, hidden", async () => {
  const panel = await panelOf();
  assert.match(panel("user_request"), /data-orch-clarify="collapsed"/);
  assert.doesNotMatch(panel("user_request"), /<textarea/);
  assert.match(panel("loop_suspected"), /data-orch-clarify="open"[\s\S]*<textarea/);
  const off = panel("limit_reached", { extra: { proposalWaits: true } });
  assert.match(off, /data-orch-clarify="disabled"/);
  assert.match(off, /data-orch-proposal-waits/);
  for (const set of ["awaiting_answer", "journal_corrupt", "push_protected", "lead_modified_tree"]) assert.doesNotMatch(panel(set), /data-orch-clarify/, set);
  assert.doesNotMatch(panel("user_request"), /class="orch-panel__section"[^>]*>\s*<h4>Уточнить/, "no clarify under the summary");
});

test("the limit field shows the current value; the reference facts left the zone for the summary", async () => {
  const panel = await panelOf();
  const html = panel("limit_reached");
  assert.match(html, /data-orch-primary="raise_limit"/);
  assert.match(html, /data-orch-limit-value/);
  const running = panel(view ? { view: view("running", null, { progress: { mode: "autopilot", finish: [], checks: [], prepare: null, completion: null, checksFrom: null, access: null, models: null } }), entries: [], onMac: true } : "x");
  assert.ok(running.indexOf("data-orch-working") < running.indexOf('id="orch-tabpanel"'), "a working run says who works in the zone");
  assert.ok(running.indexOf("data-orch-board") > running.indexOf('id="orch-tabpanel"'), "the board is in the summary, below");
  assert.match(footOf(running), /data-orch-primary="pause"/);
});

test("a lost connection is a neutral banner with Repeat; a refusal of main is its own red block", async () => {
  const panel = await panelOf();
  const html = panel("user_request", { pending: [{ commandId: "c1", command: { kind: "resume" } }] });
  assert.match(html, /data-orch-offline/);
  assert.match(html, /Повторить/);
  assert.doesNotMatch(html, /dialog-error/, "no red before main answered");
  const src = (await import("node:fs")).readFileSync(path.join(HERE, "..", "src/renderer/src/features/orchestration/RunPanel.tsx"), "utf8");
  assert.match(src, /outcome\.kind === "transport"\) return setOffline\(true\)/);
  assert.match(src, /data-orch-refused/);
});

test("the states without a pause draw their zone: working, ended, newer version", async () => {
  const panel = await panelOf();
  const completed = panel({ view: view("completed", null), entries: [], onMac: true });
  assert.match(completed, /data-orch-zone="completed/);
  assert.equal(mainOf(completed).length, 1);
  const failed = panel({ view: view("failed", null), entries: [], onMac: true });
  assert.match(failed, /data-orch-zone-action="open_journal"/);
  const newer = panel("newer_version", { extra: { newer: { chain: "ok", goal: null, compatible: true, fallback: null, version: 2 } } });
  assert.match(newer, /data-orch-zone="newer_version"/);
  assert.equal(mainOf(newer).length, 0, "a newer run offers no command");
  assert.match(footOf(newer), /copy_id/);
});
