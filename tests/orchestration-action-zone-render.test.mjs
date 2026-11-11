// R3b part B: the action zone and the panel's footer as the run panel draws them — one main button, the dangerous ones
// outlined, the clarify field as the model says, Stop in the footer (or the main button where it is all main allows),
// a refusal of main apart from a lost connection, the reference facts moved out of the zone.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire, Module } from "node:module";
import { test } from "node:test";
import { actionZone } from "../src/renderer/src/features/orchestration/runModel.ts";
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

test("the form pauses have one main button (the model's, which the form draws); Stop once with data-orch-stop; no dead release button", async () => {
  const panel = await panelOf();
  for (const set of ["awaiting_person_decision", "coverage_lost", "awaiting_finish_confirmation", "check_needs_permissions", "awaiting_answer"]) {
    const f = fixture(set);
    const z = actionZone("ru", f.view, f.entries, f.onMac);
    // the forms are not in these fixtures' views, so the model is what is checked: one main button, drawn by the form
    assert.ok(z.primary && ["answer", "raise_limit", "checks_accept", "checks_edit", "finish_confirm", "check_amend", "person_decide", "plan_return", "plan_accept"].includes(z.primary.action), `${set}: one main button, owned by the form`);
    const html = panel(set);
    assert.equal(mainOf(html).length, 0, `${set}: the row draws no second main button`);
    assert.equal(buttons(html).filter((b) => /data-orch-stop/.test(b.attrs)).length, 1, `${set}: Stop once`);
  }
  const person = panel("awaiting_person_decision", { extra: { decisions: { runKey: "k".repeat(64), conditions: [], findings: false, proposal: null,
    disputed: [{ reviewTurnId: "t1", index: 0, problem: "P", evidence: null, paths: [], candidates: [] }] } } });
  // D-018 (mock-up 10): "no default" is still the rule — equal segment choices, none pressed — and the form's one main button sends them all, off until each item has one
  assert.equal(buttons(person).filter((b) => /orch-primary/.test(b.attrs)).length, 1, "a person decision: one main button");
  assert.match(buttons(person).find((b) => /data-orch-person-submit/.test(b.attrs)).attrs, /disabled/, "off until every item has a choice");
  assert.equal(buttons(person).filter((b) => /aria-pressed="true"/.test(b.attrs)).length, 0, "no choice is pressed for the person");
  assert.match(person, /class="orch-seg orch-seg--field"/);
  const stopRow = ["push_protected", "lead_modified_tree"].map((set) => buttons(zoneOf(panel(set))).filter((b) => /data-orch-stop/.test(b.attrs)).length);
  assert.deepEqual(stopRow, [1, 1], "Stop in the zone row carries data-orch-stop");
  const newer = panel("newer_version", { extra: { newer: { chain: "ok", goal: null, compatible: true, fallback: null, version: 2 } } });
  assert.ok(!buttons(zoneOf(newer)).some((b) => /release_newer/.test(b.attrs)), "no zone button without a handler");
});

test("dangerous buttons are outlined and ask first; the outcome reset only in a managed copy", async () => {
  const panel = await panelOf();
  const reset = buttons(panel("outcome_unknown")).find((b) => /data-orch-zone-action="recover_reset"/.test(b.attrs));
  assert.match(reset.attrs, /class="orch-stop"/);
  assert.ok(!buttons(panel("outcome_unknown", { extra: { workMode: "worktree" } })).some((b) => /recover_reset/.test(b.attrs)), "never in a worktree");
  const none = panel("awaiting_checks_none");
  const accept = buttons(none).find((b) => /data-orch-checks-accept/.test(b.attrs));
  assert.equal(accept.text, "Продолжить без проверок");
  assert.match(accept.attrs, /class="orch-textual"/, "mock-up 06: a grey text; the question it asks stays");
  const save = buttons(none).find((b) => /data-orch-checks-save/.test(b.attrs));
  assert.match(save.attrs, /disabled/, "no commands, nothing to save");
  assert.match(save.attrs, /orch-primary/);
  const plan = panel("coverage_lost", { extra: { decisions: { runKey: "k".repeat(64), disputed: [], conditions: [], findings: false,
    proposal: { proposalTurnId: "t1", dropped: [{ id: "C2", text: "x", covers: [], why: "y" }], dropRequirements: [], uncovered: [], stages: [{ stage: 1, title: "N" }], findings: [] } } } });
  assert.match(buttons(plan).find((b) => /data-orch-proposal-accept/.test(b.attrs)).attrs, /class="orch-stop"/);
});

test("the clarify field is what the model says: closed, open, off with its reason, hidden", async () => {
  const panel = await panelOf();
  // R5b (D-017): the field stands in the zone wherever main takes clarify; the pauses with a decision of their own hide it
  assert.match(panel("plan_review"), /data-orch-clarify="collapsed"[\s\S]*Уточнить задачу/);
  assert.doesNotMatch(panel("plan_review"), /<textarea/);
  assert.match(panel("loop_suspected"), /data-orch-clarify="open"[\s\S]*<textarea/);
  const off = panel("plan_review", { extra: { proposalWaits: true } });
  assert.match(off, /data-orch-clarify="disabled"/);
  assert.match(off, /data-orch-proposal-waits/);
  for (const set of ["user_request", "limit_reached"]) assert.match(panel(set), /data-orch-clarify="collapsed"[\s\S]*>Уточнить</, set);
  for (const set of ["awaiting_answer", "journal_corrupt", "push_protected", "lead_modified_tree", "awaiting_checks_decision", "awaiting_finish_confirmation", "check_needs_permissions", "awaiting_person_decision", "coverage_lost"]) assert.doesNotMatch(panel(set), /data-orch-clarify/, set);
  assert.doesNotMatch(panel("user_request"), /class="orch-panel__section"[^>]*>\s*<h4>Уточнить/, "no clarify under the summary");
});

test("the limit field shows the current value; the reference facts left the zone for the summary", async () => {
  const panel = await panelOf();
  const html = panel("limit_reached");
  assert.match(html, /data-orch-primary="raise_limit"/);
  assert.match(html, /data-orch-limit-value/);
  const running = panel({ view: view("running", null, { progress: { mode: "autopilot", finish: [], checks: [], prepare: null, completion: null, checksFrom: null, access: null, models: null } }), entries: [], onMac: true });
  assert.ok(running.indexOf("data-orch-working") < running.indexOf('id="orch-tabpanel"'), "a working run says who works in the zone");
  assert.ok(!running.includes("data-orch-board"), "D-018: no board; the summary draws the blocks of the mock-ups");
  assert.match(footOf(running), /data-orch-primary="pause"/);
});

test("a lost connection is a neutral banner with Repeat; a refusal of main is its own red block", async () => {
  const panel = await panelOf();
  const html = panel("user_request", { pending: [{ commandId: "c1", command: { kind: "resume" } }] });
  assert.match(html, /data-orch-offline/);
  assert.match(html, /Повторить/);
  assert.doesNotMatch(html, /dialog-error/, "no red before main answered");
  const src = (await import("node:fs")).readFileSync(path.join(HERE, "..", "src/renderer/src/features/orchestration/RunPanel.tsx"), "utf8");
  assert.match(src, /outcome\.kind === "transport"\) \{ setOffline\(true\)/);
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
  assert.match(zoneOf(newer), /copy_id/, "R6-A: Copy id stands in the zone row beside Release link");
});

test("R4.1: every decision form is a labelled group with exactly one main button, in its pinned row", async () => {
  const panel = await panelOf();
  const proposal = { proposalTurnId: "t1", dropped: [{ id: "C2", text: "x", covers: [], why: "y" }], dropRequirements: [], uncovered: [], stages: [{ stage: 1, title: "N" }],
    findings: [{ id: "F1", condition: "C2", problem: "p" }] };
  const forms = {
    "awaiting_checks_decision": panel("awaiting_checks_decision"),
    "awaiting_checks_none": panel("awaiting_checks_none"),
    "check_needs_permissions": panel("check_needs_permissions", { extra: { refused: { checkId: "c1", command: "npm test" } } }),
    "awaiting_finish_confirmation": panel("awaiting_finish_confirmation", { extra: { confirm: { tree: "t".repeat(40), commit: "c".repeat(40), push: true, qa: true } } }),
    "coverage_lost": panel("coverage_lost", { extra: { decisions: { runKey: "k".repeat(64), disputed: [], conditions: [], findings: false, proposal } } })
  };
  for (const [set, html] of Object.entries(forms)) {
    const form = html.slice(html.indexOf("data-orch-form"), html.indexOf('id="orch-tabpanel"'));
    assert.match(html, /<section[^>]*aria-labelledby="[^"]+"[^>]*data-orch-form/, `${set}: a labelled group`);
    assert.equal(buttons(form).filter((b) => /data-orch-primary=/.test(b.attrs)).length, 1, `${set}: the form's one main button`);
    assert.equal(buttons(form).filter((b) => /orch-primary/.test(b.attrs)).length, 1, `${set}: one filled button`);
    assert.ok(form.indexOf("data-orch-form-foot") > 0 && form.indexOf("data-orch-primary") > form.indexOf("data-orch-form-foot"), `${set}: the main button is in the pinned row`);
  }
  assert.match(forms.awaiting_finish_confirmation, /<fieldset[^>]*data-orch-finish-step="push"[^>]*><legend>/);
  assert.equal([...forms.awaiting_finish_confirmation.matchAll(/data-orch-finish-choice=/g)].length, 4, "mock-up 12: Do it / Skip for each of the two steps");
  assert.match(forms.coverage_lost, /data-orch-proposal-accept-open/, "mock-up 11: «Принять снятие...» asks for a choice for each finding first");
});
