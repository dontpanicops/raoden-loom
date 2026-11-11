// R5h-A (D-027): the consent forms keep the facts the mock-up dropped — what a plan proposal leaves uncovered, a question's
// decline, the scope of a remembered permission, a disputed item's evidence, a finding's optional decision, the checks that
// did not pass in the summary.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire, Module } from "node:module";
import { test } from "node:test";
import { legacyView } from "../src/renderer/src/features/orchestration/panelTabs.ts";
import { fixture, view } from "./fixtures/orchestration/zone-sets.mjs";
import { actionZone, lineRole } from "../src/renderer/src/features/orchestration/runModel.ts";
import { spanText } from "../src/renderer/src/features/orchestration/runStatus.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const requireApp = createRequire(path.join(HERE, "..", "package.json"));
async function bundle(entry) {
  const out = await requireApp("esbuild").build({
    entryPoints: [path.join(HERE, "..", entry)], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent",
    loader: { ".svg": "dataurl", ".png": "dataurl", ".ico": "dataurl", ".webp": "dataurl", ".jpg": "dataurl" },
    plugins: [{ name: "same-react", setup(b) { b.onResolve({ filter: /^react(\/.*)?$/ }, (a) => ({ path: requireApp.resolve(a.path), external: true })); } }]
  });
  const file = path.join(HERE, "..", `${path.basename(entry)}.r5ha-render.cjs`);
  const mod = new Module(file);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.join(HERE, ".."));
  mod._compile(out.outputFiles[0].text, file);
  return mod.exports;
}
const TEXTS_PLAN = { pp: { status: "ready", text: JSON.stringify({ stages: [{ title: "model", task: "t" }, { title: "api", task: "t" }] }) } };
const rec = (seq, type, data) => ({ seq, ts: "2026-11-11T10:00:00.000Z", type, data });
const panelOf = async () => {
  const React = requireApp("react");
  const { renderToStaticMarkup } = requireApp("react-dom/server");
  const { RunPanel } = await bundle("src/renderer/src/features/orchestration/RunPanel.tsx");
  return (set, { locale = "ru", extra = {}, pending = [], withSettings = true, records = [], tab = "overview", texts = TEXTS_PLAN } = {}) => {
    const f = typeof set === "string" ? fixture(set) : set;
    const v = { ...f.view, ...extra };
    if (v.progress) v.progress = { mode: "autopilot", checks: [], finish: [], ...v.progress }; // the fixtures carry only what their pause reads
    return renderToStaticMarkup(React.createElement(RunPanel, {
      orch: { runs: { r: { view: v, open: true, seq: 9, tick: 0 } }, activity: { r: { entries: f.entries, gaps: [], firstId: f.entries[0]?.id ?? 0, status: "ready", resyncs: 0 } },
        runErrors: {}, canvas: { links: [], agents: [] }, journals: { r: { records, next: records.length, status: "ready" } }, texts,
        commands: { pending: () => pending }, catalog: { checks: [] }, loadText() {}, syncJournal() {}, retry() {}, stageTitles: () => ({}) },
      runId: "r", locale, panel: { linkId: "L", mode: "feed", ...legacyView(tab), role: "lead", focus: 1 }, onClose() {}, onNewGoal() {}, onView() {},
      onProjectSettings: withSettings ? () => {} : undefined
    }));
  };
};

const permission = (kind, options, extra = {}) => ({ requestId: "q1", kind, role: "lead", tool: "Bash", summary: "ls", detail: null, options, questions: [], askedAt: "2026-11-11T10:00:00.000Z", ...extra });

test("a plan proposal names the requirements left uncovered and the new stages", async () => {
  const panel = await panelOf();
  const proposal = { proposalTurnId: "t9", stages: [{ stage: 1, title: "Build", conditions: [] }, { stage: 2, title: "Ship", conditions: [] }], dropped: [], dropRequirements: [], findings: [], uncovered: ["R1", "R2"] };
  const html = panel("coverage_lost", { extra: { decisions: { runKey: "k".repeat(64), tree: "t", conditions: [], disputed: [], findings: false, proposal } } });
  assert.match(html, /data-orch-proposal-uncovered[^>]*>[^<]*Требование 1[^<]*Требование 2/);
  assert.match(html, /data-orch-proposal-stages[^>]*>[^<]*1\. Build; 2\. Ship/);
  const none = panel("coverage_lost", { extra: { decisions: { runKey: "k".repeat(64), tree: "t", conditions: [], disputed: [], findings: false, proposal: { ...proposal, uncovered: [] } } } });
  assert.doesNotMatch(none, /data-orch-proposal-uncovered/);
});

test("a question can be declined; a remembered permission says what it covers", async () => {
  const panel = await panelOf();
  const q = panel("awaiting_answer", { extra: { permission: permission("question", ["allow_once", "deny"], { questions: [{ id: "a", question: "Which?", options: ["x"], multiple: false, other: false }] }) } });
  assert.match(q, /data-decision="deny"[^>]*>Не отвечать</);
  const run = panel("awaiting_answer", { extra: { permission: permission("command", ["allow_once", "allow_run", "deny"]) } });
  assert.match(run, /data-orch-scope-hint/);
  const project = panel("awaiting_answer", { extra: { permission: permission("command", ["allow_once", "allow_project", "deny"]) } });
  assert.match(project, /data-orch-scope-hint/);
  assert.doesNotMatch(panel("awaiting_answer", { extra: { permission: permission("command", ["allow_once", "deny"]) } }), /data-orch-scope-hint/);
});

test("a disputed item keeps its evidence and the candidates' paths one click away; findings are optional", async () => {
  const panel = await panelOf();
  const d = { runKey: "k".repeat(64), tree: "t", conditions: [], findings: true, proposal: null,
    disputed: [{ reviewTurnId: "t1", index: 0, problem: "P", evidence: "EVIDENCE-TEXT", paths: ["a.ts", "b.ts"], candidates: [{ id: "F1", problem: "old", paths: ["b.ts", "c.ts"] }] }] };
  const html = panel("awaiting_person_decision", { extra: { decisions: d, progress: { findings: { items: [{ id: "F2", status: "open", severity: "blocking", problem: "open one", closeWhen: "x", paths: [], history: [], condition: null, possibleRepeatOf: null }], disputed: [] } } } });
  assert.match(html, /<details data-orch-disputed-more="true">[\s\S]*EVIDENCE-TEXT[\s\S]*c\.ts/);
  assert.match(html, /data-orch-disputed-shared[^>]*>[^<]*b\.ts/);
  assert.match(html, /data-orch-person-finding="F2"[^>]*title="[^"]+"[^>]*data-finding-safe/, "the safe choice (do nothing) is said at the finding");
});

test("the summary lists the checks that did not pass, with the class and the reason; a passed one is not listed", async () => {
  const panel = await panelOf();
  const records = [rec(1, "run.created", {}),
    rec(2, "check.started", { checkRunId: "x1", checkId: "k1" }), rec(3, "check.finished", { checkRunId: "x1", checkId: "k1", status: "failed", reason: "exit 2" }),
    rec(4, "check.started", { checkRunId: "x2", checkId: "k2" }), rec(5, "check.finished", { checkRunId: "x2", checkId: "k2", status: "passed" })];
  const html = panel("provider_limit", { records, extra: { status: "completed", reason: null,
    progress: { checks: [{ id: "k1", title: "unit tests", status: "failed", class: "environment" }, { id: "k2", title: "lint", status: "passed", class: null }] } } });
  assert.match(html, /data-sum-failed-check="k1"[\s\S]*?unit tests[\s\S]*?не готова среда · exit 2/);
  assert.doesNotMatch(html, /data-sum-failed-check="k2"/);
});

const PLAN = [rec(1, "run.created", {}), rec(2, "plan.recorded", { plan: { sha256: "pp", bytes: 1 }, firstStage: 1, stageCount: 2, version: 1 })];

test("a pause lists where the run stands (mock-ups 02, 03, 05, 07, 12, 14)", async () => {
  const panel = await panelOf();
  // the checks to decide: the plan approved and the commands waiting, nothing else under the zone
  const checks = panel("awaiting_checks_decision", { records: PLAN, extra: { stage: 1 } });
  assert.match(checks, /data-pause-row="plan"/);
  assert.match(checks, /data-pause-row="checks"[\s\S]*ждут решения/);
  assert.doesNotMatch(checks, /data-sum="outcome"/, "no second status plate");
  // a question on the work tab: the stage that waits, «ждёт ответа»
  const ask = panel("awaiting_answer", { records: PLAN, extra: { stage: 1, permission: permission("question", ["allow_once", "deny"], { questions: [{ id: "a", question: "Q", options: [], multiple: false, other: true }] }) }, tab: "activity" });
  assert.match(ask, /data-pause-row="plan"/);
  assert.match(ask, /data-stage-n="1"[\s\S]*ждёт ответа/);
  // the refused check: its row with the class
  const refused = panel("check_needs_permissions", { records: PLAN, extra: { refused: { checkId: "c1", command: "npm run e2e" }, progress: { checks: [{ id: "c1", title: "npm run e2e", status: "failed", class: "sandbox" }] } } });
  assert.match(refused, /data-sum-failed-check="c1"/);
  assert.match(refused, /песочница не дала прав/);
});

test("the feed keeps the work and leaves the application's own lines to the journal; records are in order with a role filter", () => {
  assert.equal(lineRole({ seq: 1, ts: "", kind: "check", parts: {} }), "check");
  assert.equal(lineRole({ seq: 1, ts: "", kind: "turn", parts: { purpose: "execute" } }), "executor");
  assert.equal(lineRole({ seq: 1, ts: "", kind: "plan", parts: {} }), "lead");
  assert.equal(lineRole({ seq: 1, ts: "", kind: "status", parts: {} }), "run");
});

test("a time span is hours and minutes; a failed CLI says its code and the stage", () => {
  assert.equal(spanText("ru", 72 * 60_000), "1 ч 12 м");
  assert.equal(spanText("ru", 4 * 3600_000), "4 ч");
  assert.equal(spanText("en", 5 * 60_000), "5 m");
  const entries = [{ id: 1, ts: "2026-11-11T10:00:00.000Z", runId: "r", role: "executor", provider: "claude", turnId: "t1", kind: "process_exited", text: "", detail: { code: 1 } }];
  const z = actionZone("ru", view("failed", "environment_error", { stage: 2 }), entries, true);
  assert.equal(z.title, "Claude CLI завершился с кодом 1 на этапе 2");
});
