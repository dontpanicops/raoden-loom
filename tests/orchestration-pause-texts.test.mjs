// UX audit 2026-10-05, PR 1 ("Pauses are clear"): every pause reason of the journal says what happened, why, what to do
// and has one main button — an action main accepts on that pause; the header's main button is that action, Stop is
// secondary; the link chip, the cards, the feed and the widget say "Waiting for you: …" / "Paused: …"; a plan proposal
// that drops criteria offers the safe choice first; an unavailable sandbox on macOS never says "run on macOS".
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire, Module } from "node:module";
import { test } from "node:test";
import { PAUSED_REASONS_V2 } from "../src/main/services/orchestration/journal.ts";
import { PAUSES, actionZone, admits, availableActions, pauseLabel, pauseText, primaryAction } from "../src/renderer/src/features/orchestration/runModel.ts";
import { runStatus } from "../src/renderer/src/features/orchestration/runStatus.ts";
import { t } from "../src/renderer/src/lib/i18n.ts";
import { legacyView } from "../src/renderer/src/features/orchestration/panelTabs.ts";
import { DERIVED, SETS37, fixture } from "./fixtures/orchestration/zone-sets.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SETS = [...PAUSED_REASONS_V2, "sandbox_unsupported", "awaiting_checks_none"];
const FIELDS = ["what", "why", "do", "button"];
const view = (status, reason, extra = {}) => ({ runId: "r", revision: 1, status, reason, stage: null, active: null, permission: null, halted: false,
  newer: null, workMode: "project", workDir: "/p", progress: null, proposal: null, refused: null, confirm: null, decisions: null, ...extra });

test("every pause reason of the journal has what / why / what to do / button in both languages, in the person's words", () => {
  assert.deepEqual(Object.keys(PAUSES).sort(), [...PAUSED_REASONS_V2].sort(), "a new pause reason needs its words and its main action in PAUSES");
  for (const locale of ["ru", "en"]) {
    const titles = new Set();
    for (const set of SETS) {
      const [what, why, todo, button] = FIELDS.map((f) => t(locale, `orchPause_${set}_${f}`));
      for (const [f, text] of [["what", what], ["why", why], ["do", todo], ["button", button]]) {
        assert.ok(typeof text === "string" && text.trim().length > 1, `${locale}: orchPause_${set}_${f}`);
        // no internal words: snake_case codes, runKey, a reason's own name
        assert.doesNotMatch(text, /\b[a-z]+_[a-z_]+\b|runKey|coverage|invalid_report/, `${locale}: orchPause_${set}_${f}: ${text}`);
      }
      // R5a (D-009, mock-up 16): mcp_present wears the headline of needs_user_action ("The agent needs you to do something"); the MCP servers are in the why
      assert.ok(!titles.has(what) || set === "mcp_present", `${locale}: two pauses are called the same: ${what}`);
      titles.add(what);
      assert.ok(!why.toLowerCase().includes(what.toLowerCase()), `${locale}: ${set}: the why repeats the headline`);
      assert.ok(button.length <= 28, `${locale}: ${set}: one short action, not a sentence: ${button}`);
    }
  }
});

test("the main button of every pause is an action the panel offers and main accepts on that pause", () => {
  // main's own gate (shared/orchestrationAdmission.ts): the same function apply() asks first
  const ctx = (reason) => ({ status: "paused", reason, version: 2, proposalWaits: false, inPlace: false });
  const gate = { resume: "resume", step: "step", stop: "stop", answer: "answer", raise_limit: "raise_limit", recover: "recover", checks_decide: "checks.decide",
    check_amend: "check.amend", finish_confirm: "finish.confirm", person_decide: "person.decide", plan_decide: "plan.decide" };
  for (const reason of PAUSED_REASONS_V2) {
    const { primary } = PAUSES[reason];
    assert.ok(availableActions(view("paused", reason)).includes(primary), `${reason}: ${primary} is offered`);
    assert.equal(primaryAction(view("paused", reason)), primary);
    assert.equal(admits(gate[primary], ctx(reason)), null, `${reason}: main accepts ${primary}`);
    if (primary === "stop") assert.notEqual(admits("resume", ctx(reason)), null, `${reason}: stopping is all main allows — else the pause has a better main action`);
  }
  assert.equal(primaryAction(view("running", null)), "pause", "while the run works, Pause is the main action");
});

const requireApp = createRequire(path.join(HERE, "..", "package.json"));
async function bundle(entry) {
  const out = await requireApp("esbuild").build({
    entryPoints: [path.join(HERE, "..", entry)], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent",
    loader: { ".svg": "dataurl", ".png": "dataurl", ".ico": "dataurl", ".webp": "dataurl", ".jpg": "dataurl" },
    plugins: [{ name: "same-react", setup(b) { b.onResolve({ filter: /^react(\/.*)?$/ }, (a) => ({ path: requireApp.resolve(a.path), external: true })); } }]
  });
  const file = path.join(HERE, "..", `${path.basename(entry)}.pause-texts.cjs`);
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
  return (v, { locale = "ru", tab = "overview", entries = [] } = {}) => renderToStaticMarkup(React.createElement(RunPanel, {
    orch: { runs: { r: { view: v, open: true, seq: 9, tick: 0 } }, activity: { r: { entries, gaps: [], firstId: entries[0]?.id ?? 0, status: "ready", resyncs: 0 } },
      runErrors: {}, canvas: { links: [], agents: [] }, journals: { r: { records: [], next: 0, status: "ready" } }, texts: {},
      commands: { pending: () => [] }, catalog: { checks: [] }, loadText() {}, syncJournal() {}, retry() {}, stageTitles: () => ({}) },
    runId: "r", locale, panel: { linkId: "L", mode: "feed", ...legacyView(tab), role: "lead", focus: 1 }, onClose() {}, onNewGoal() {}, onView() {}
  }));
};
const buttons = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], text: m[2].replace(/<[^>]+>/g, "") }));

test("the zone's main button is the pause's action; Stop is in the footer outside the zone; the headline is said once", async () => {
  const panel = await panelOf();
  const primaryOf = (html) => buttons(html).filter((b) => /class="[^"]*orch-primary/.test(b.attrs));
  const stopsOf = (html) => buttons(html).filter((b) => /data-orch-stop/.test(b.attrs) || b.text === t("ru", "orchPause_lead_modified_tree_button"));
  const zoneOf = (html) => html.slice(html.indexOf("data-orch-summary"), html.indexOf("data-orch-foot") > 0 ? html.indexOf("data-orch-foot") : html.length);

  const resumed = panel(view("paused", "user_request"));
  assert.match(primaryOf(resumed)[0].attrs, /data-orch-primary="resume"/);
  assert.equal(primaryOf(resumed)[0].text, "Продолжить");
  assert.equal(primaryOf(resumed).length, 1, "one main button");
  assert.equal(stopsOf(resumed).length, 1);
  assert.match(stopsOf(resumed)[0].attrs, /class="orch-stop"/, "Stop is outlined, never filled");
  assert.doesNotMatch(stopsOf(resumed)[0].attrs, /orch-danger|orch-primary/);
  assert.equal(stopsOf(resumed)[0].text, "Остановить запуск");
  assert.ok(resumed.indexOf("data-orch-foot") > resumed.indexOf('id="orch-tabpanel"'), "the footer is under the tabs");
  assert.equal(stopsOf(zoneOf(resumed)).length, 0, "no Stop inside the zone");

  const step = panel(view("paused", "invalid_report"));
  assert.equal(primaryOf(step)[0].text, "Повторить ход", "the button says what the text says");
  assert.match(step.replace(/<[^>]+>/g, ""), /Нажмите «Повторить ход»/);

  // a pause decided in a form: the form's own main button, right under the next step, is the main one — before Stop
  const proposal = { checks: [{ id: "c1", command: "npm test", why: "the tests", source: [] }], none: null };
  const checks = panel(view("paused", "awaiting_checks_decision", { proposal }));
  assert.match(primaryOf(checks)[0].attrs, /data-orch-checks-accept/);
  assert.ok(checks.indexOf("data-orch-checks-accept") < checks.indexOf("data-orch-foot"), "the form before the footer with Stop");
  assert.ok(checks.indexOf("data-orch-next") < checks.indexOf("data-orch-checks-proposal"), "the form right under what to do");
  assert.match(stopsOf(checks)[0].attrs, /class="orch-stop"/);

  const limit = panel(view("paused", "limit_reached"));
  assert.match(primaryOf(limit)[0].attrs, /data-orch-primary="raise_limit"/);
  assert.match(limit, /Новое значение/, "the limit's field says what it is");

  const tree = panel(view("paused", "lead_modified_tree"));
  assert.equal(stopsOf(tree).length, 1, "Stop once: the main button, not the footer");
  assert.match(stopsOf(tree)[0].attrs, /orch-danger/, "where stopping is all main allows, Stop is the main action");
  assert.match(stopsOf(tree)[0].attrs, /data-orch-primary="stop"/);
  assert.equal(stopsOf(tree)[0].text, "Остановить запуск");
  // R5a (mock-up 15): the footer holds only "Copy id"
  assert.deepEqual([...tree.slice(tree.indexOf("data-orch-foot")).matchAll(/data-orch-foot-action="(\w+)"/g)].map((m) => m[1]), ["copy_id"], "the footer: only the copy of the id");
  assert.doesNotMatch(tree, /контрольной точке/, "no button to return to a checkpoint here, so it is not advised");

  const running = panel(view("running", null));
  // R5a (mock-up 01): Pause is a text button at the left of the footer, not the filled main one
  assert.match(buttons(running).find((x) => /data-orch-primary="pause"/.test(x.attrs))?.attrs ?? "", /orch-textual/);
  assert.match(stopsOf(running)[0].attrs, /class="orch-stop"/);

  for (const reason of ["needs_user_action", "awaiting_person_decision", "coverage_lost"]) {
    // the glossary wraps words in <abbr>: compare the text, not the markup
    const html = panel(view("paused", reason)).replace(/<\/?abbr[^>]*>/g, "").replace(/<[^>]+>/g, "\n");
    const what = t("ru", `orchPause_${reason}_what`);
    assert.equal(html.split(what).length - 1, 1, `${reason}: the headline once`);
    assert.doesNotMatch(html, /Нужно ваше (действие|решение)/i);
  }
});

test("the link chip, the cards, the feed and the widget say «Ждёт вас: …» / «Пауза: …» from the same words", async () => {
  assert.equal(pauseLabel("ru", { kind: "reason", reason: "awaiting_answer" }, true), "Ждёт вас: агент задал вопрос");
  assert.equal(pauseLabel("ru", { kind: "reason", reason: "user_request" }, true), "Пауза: вы поставили запуск на паузу");
  assert.equal(pauseLabel("en", { kind: "reason", reason: "coverage_lost" }, true), "Waiting for you: the lead proposes dropping some readiness criteria");
  const row = runStatus("ru", { view: view("paused", "awaiting_answer"), entries: [], now: Date.now(), stageTitles: {} });
  assert.equal(row.state, "waiting_user");
  assert.equal(row.doing, "Ждёт вас: агент задал вопрос");
  assert.equal(row.wait, t("ru", "orchPause_awaiting_answer_why"));
  assert.equal(runStatus("ru", { view: view("paused", "step_done"), entries: [], now: Date.now(), stageTitles: {} }).doing, "Пауза: шаг сделан");
  // the feed
  const panel = await panelOf();
  const entries = [{ id: 1, ts: "2026-10-05T10:00:00.000Z", runId: "r", role: "run", provider: null, turnId: null, kind: "status", text: "paused",
    detail: { status: "paused", reason: "coverage_lost" } }];
  assert.match(panel(view("paused", "coverage_lost"), { tab: "activity", entries }).replace(/<[^>]+>/g, ""), /Ждёт вас: лид предлагает убрать часть критериев готовности/);
  // the chip and the cards take the same function
  const scene = fs.readFileSync(path.join(HERE, "..", "src/renderer/src/features/orchestration/AgentScene.tsx"), "utf8");
  assert.equal(scene.match(/viewPauseLabel\(locale, \w+,/g)?.length, 2, "the link chip and the agent cards both take their words from viewPauseLabel");
});

test("a plan proposal that drops criteria: «Вернуть лиду» is the main button, accepting the drop is secondary and says what is lost", async () => {
  const panel = await panelOf();
  const decisions = { runKey: "k".repeat(64), disputed: [], conditions: [], findings: false,
    proposal: { proposalTurnId: "t1", dropped: [{ id: "C2", text: "node --test passes", covers: ["R2"], why: "no tests" }], dropRequirements: [],
      uncovered: ["R2"], stages: [{ stage: 1, title: "Note" }], findings: [] } };
  const html = panel(view("paused", "coverage_lost", { decisions, proposalWaits: true }));
  const b = buttons(html);
  const ret = b.find((x) => /data-orch-proposal-return/.test(x.attrs));
  const acc = b.find((x) => /data-orch-proposal-accept/.test(x.attrs));
  assert.match(ret.attrs, /orch-primary/);
  assert.doesNotMatch(acc.attrs, /orch-primary/);
  assert.equal(acc.text, "Принять снятие");
  assert.ok(html.indexOf("data-orch-proposal-return") < html.indexOf("data-orch-proposal-accept=\"true\""), "the safe choice first");
  assert.match(html, /перестанут проверяться/);
});

test("an unavailable sandbox on macOS is a failed self-test with what to do — never «run on macOS»; elsewhere the platform has none", () => {
  const v = view("paused", "sandbox_unavailable");
  for (const locale of ["ru", "en"]) {
    const mac = pauseText(locale, v, [], true);
    assert.doesNotMatch(`${mac.what} ${mac.why} ${mac.todo}`, /запустите на macOS|run on macOS/i);
    assert.match(mac.todo, locale === "ru" ? /впишите|вписав/i : /your own check commands/);
    assert.equal(mac.primary, "stop");
    assert.equal(pauseText(locale, v, [], false).what, t(locale, "orchPause_sandbox_unsupported_what"));
  }
});

// ---------- R3b: the action zone, 37 sets of words ----------

const ZONE_BUTTONS = {
  provider_limit: { primary: "resume", secondary: [], dangerous: [] }, provider_limit_at: { primary: "resume", secondary: [], dangerous: [] },
  limit_reached: { primary: "raise_limit", secondary: [], dangerous: [] },
  awaiting_checks_decision: { primary: "checks_accept", secondary: ["checks_edit"], dangerous: [] },
  awaiting_finish_confirmation: { primary: "finish_confirm", secondary: [], dangerous: [] },
  check_needs_permissions: { primary: "check_amend", secondary: [], dangerous: [] },
  awaiting_answer: { primary: "answer", secondary: [], dangerous: [] },
  outcome_unknown: { primary: "recover_accept", secondary: ["recover_retry"], dangerous: ["recover_reset"] },
  lead_modified_tree: { primary: "stop", secondary: ["open_changes"], dangerous: [] },
  shared_git_tampered: { primary: "stop", secondary: [], dangerous: [] }, journal_corrupt: { primary: "stop", secondary: [], dangerous: [] },
  sandbox_unavailable: { primary: "stop", secondary: [], dangerous: [] },
  awaiting_person_decision: { primary: "person_decide", secondary: [], dangerous: [] },
  coverage_lost: { primary: "plan_return", secondary: [], dangerous: ["plan_accept"] },
  finish_unconfirmed: { primary: "resume", secondary: [], dangerous: [] }
};
const STOP_MAIN = ["lead_modified_tree", "shared_git_tampered", "journal_corrupt", "sandbox_unavailable", "sandbox_unsupported", "push_protected"];
const zoneOf = (locale, set) => { const f = fixture(set); return actionZone(locale, f.view, f.entries, f.onMac); };

test("the zone's headline is unique among the 37 sets, in both languages, and each set is the zone's own", () => {
  assert.equal(new Set(SETS37).size, 37);
  for (const locale of ["ru", "en"]) {
    const titles = new Map();
    for (const set of SETS37) {
      const z = zoneOf(locale, set);
      assert.equal(z.variant, set, `${set}: the zone picks its set`);
      assert.ok(z.title.trim().length > 1 && !/[{}]/.test(z.title), `${locale}: ${set}: the headline is filled: ${z.title}`);
      assert.ok(!titles.has(z.title) || set === "mcp_present", `${locale}: ${set} and ${titles.get(z.title)} are called the same: ${z.title}`);
      titles.set(z.title, set);
      assert.ok(!z.why.toLowerCase().includes(z.title.toLowerCase()), `${locale}: ${set}: the why repeats the headline`);
      assert.ok(z.todo.trim().length > 1 && z.why.trim().length > 1, `${locale}: ${set}: why and what to do are said`);
    }
    for (const set of [...DERIVED, "mcp_present", "mcp_unchecked", "push_protected"]) assert.ok(t(locale, `orchPause_${set}_what`), `${locale}: orchPause_${set}_what`);
  }
  assert.match(zoneOf("ru", "provider_limit").title, /Codex/);
  assert.match(zoneOf("ru", "model_unsupported").title, /gpt-6\.1-sol/);
  assert.match(zoneOf("ru", "mcp_present").why, /files, git/);
  assert.match(zoneOf("ru", "push_protected").why, /main/, "the protected branch is named");
});

test("every set has exactly one main button, never the danger fill unless Stop is all main allows, and the tone of PAUSES", () => {
  for (const locale of ["ru", "en"]) for (const set of SETS37) {
    const z = zoneOf(locale, set);
    if (set === "newer_version") { assert.equal(z.primary, null); assert.equal(z.tone, "calm"); continue; }
    assert.ok(z.primary, `${set}: one main button`);
    assert.equal(z.primary.danger, STOP_MAIN.includes(set), `${set}: the danger fill only where Stop is the main action`);
    if (STOP_MAIN.includes(set)) {
      assert.equal(z.primary.action, "stop", set);
      assert.ok(!z.footer.some((b) => b.action === "stop"), `${set}: Stop once`);
    } else assert.ok(z.footer.some((b) => b.action === "stop"), `${set}: Stop is in the footer`);
    assert.ok(z.dangerous.every((b) => b.danger) && z.secondary.every((b) => !b.danger), set);
    assert.ok([z.primary, ...z.secondary, ...z.dangerous, ...z.footer].every((b) => b.label.trim().length > 1 && b.label.length <= 40), `${set}: labels`);
    const reason = fixture(set).view.reason;
    assert.equal(z.tone, PAUSES[reason].you === false ? "calm" : "waiting", `${set}: tone`);
  }
});

test("the buttons of the disputed pauses are those spec-vs-code §1.3 settled (points 1-5, 7, 8, 11, 12, 14-16)", () => {
  for (const [set, want] of Object.entries(ZONE_BUTTONS)) {
    const z = zoneOf("ru", set);
    assert.equal(z.primary.action, want.primary, `${set}: main`);
    assert.deepEqual(z.secondary.map((b) => b.action), want.secondary, `${set}: secondary`);
    assert.deepEqual(z.dangerous.map((b) => b.action), want.dangerous, `${set}: dangerous`);
  }
  const none = zoneOf("ru", "awaiting_checks_none");
  assert.deepEqual([none.primary.action, none.dangerous.map((b) => b.action)], ["checks_edit", ["checks_accept"]], "none: save the commands; going on without checks is dangerous");
  assert.equal(zoneOf("ru", "limit_reached").primary.after, "resume", "a raised limit is followed by Resume");
  // §1.4 D1: returning to the checkpoint only in the managed copy
  const f = fixture("outcome_unknown");
  for (const workMode of ["project", "worktree"]) assert.deepEqual(actionZone("ru", { ...f.view, workMode }, [], true).dangerous, [], workMode);
  // the clarify field: hidden where main refuses it or has no use for it, off while a plan proposal waits
  const clarify = (set, extra = {}) => { const g = fixture(set); return actionZone("ru", { ...g.view, ...extra }, g.entries, g.onMac).clarify; };
  for (const set of ["user_request", "plan_review", "limit_reached", "invalid_report"]) assert.equal(clarify(set), "collapsed", set);
  assert.equal(clarify("loop_suspected"), "open");
  for (const set of ["awaiting_answer", "journal_corrupt", "lead_modified_tree", "push_protected", "coverage_lost", "awaiting_checks_decision", "newer_version"]) assert.equal(clarify(set), "hidden", set);
  assert.equal(clarify("limit_reached", { proposalWaits: true }), "disabled");
  // a waiting plan proposal: main refuses the raise, so the zone offers Resume (it opens the proposal) and no limit field
  const waits = fixture("limit_reached");
  const lz = actionZone("ru", { ...waits.view, proposalWaits: true }, waits.entries, true);
  assert.equal(lz.primary.action, "resume");
  assert.ok(!lz.commands.includes("raise_limit"));
});

test("a protected branch is read from the feed: only while that pause lasts", () => {
  const f = fixture("push_protected");
  assert.equal(actionZone("ru", f.view, f.entries, true).variant, "push_protected");
  const went = [...f.entries, { id: 99, ts: "2026-11-11T10:05:00.000Z", runId: "r", role: "run", provider: null, turnId: null, kind: "status", text: "running", detail: { status: "running", reason: null } }];
  assert.equal(actionZone("ru", f.view, went, true).variant, "needs_user_action", "the run went on since");
  assert.equal(pauseText("ru", f.view, f.entries, true).primary, "stop");
});

test("states without a pause: working, stopping, ended, halted, a permission", () => {
  const z = (status, extra = {}) => actionZone("ru", view(status, null, extra), [], true);
  assert.deepEqual([z("running").primary, z("running").footer.map((b) => b.action)], [null, ["pause", "stop"]]);
  assert.equal(z("pausing").primary.action, "keep_running");
  assert.deepEqual([z("stopping").primary, z("stopping").footer, z("stopping").clarify], [null, [], "hidden"]);
  assert.deepEqual([z("completed").primary.action, z("completed").secondary.map((b) => b.action)], ["open_changes", ["new_goal"]], "a result to take: the changes first");
  assert.equal(z("failed").primary.action, "open_journal");
  assert.equal(z("running", { halted: true }).variant, "halted");
  assert.equal(z("running", { permission: { role: "lead" } }).variant, "permission");
});
