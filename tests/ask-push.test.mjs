// D-043 (mock-up 15): «Спрашивать перед каждым push». The profile's askPush (absent: ask), the cycle's rule of who decides a
// step, the second stage of reading a journal whose goal asks, and the pause's words. The runs themselves:
// orchestration-checks-proposal.test.mjs (both positions), the settings' save: orchestration-board-f4.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { personDecides } from "../src/main/services/orchestration/cycle.ts";
import { textsConflict } from "../src/main/services/orchestration/journal.ts";
import { validateProfile } from "../src/main/services/orchestration/profile.ts";
import { pauseText } from "../src/renderer/src/features/orchestration/runModel.ts";

const base = { v: 1, workMode: "copy", checks: [], prepare: { steps: [], auto: false }, env: { direnv: false }, finish: { commit: false, push: null, qa: null }, grants: [] };

test("the profile: absent or true is «ask» (not written), false is kept, anything else is refused", () => {
  assert.equal("askPush" in validateProfile(base), false);
  assert.equal("askPush" in validateProfile({ ...base, askPush: true }), false);
  assert.equal(validateProfile({ ...base, askPush: false }).askPush, false);
  assert.throws(() => validateProfile({ ...base, askPush: "no" }), /askPush/);
});

test("who decides a step: push and QA of a run without checks; only the push of a goal that asks; nothing else", () => {
  const st = (count) => ({ version: 2, orch: { checksDecision: count === null ? null : { count } } });
  assert.equal(personDecides(st(1), {}, "push"), false, "checks, not asked: as before");
  assert.equal(personDecides(st(1), { askPush: true }, "push"), true);
  assert.equal(personDecides(st(1), { askPush: true }, "qa"), false, "the setting is about the push");
  assert.equal(personDecides(st(1), { askPush: true }, "commit"), false);
  assert.equal(personDecides(st(0), {}, "qa"), true, "without checks: as before");
  assert.equal(personDecides({ version: 1, orch: { checksDecision: null } }, { askPush: true }, "push"), false, "v1 has no confirmation");
});

test("the second stage of reading: a push of a goal that asks needs the person's confirmation of what it delivered", () => {
  const tree = "a".repeat(40), commit = "b".repeat(40);
  const state = (confirmations) => ({ kind: "goal", version: 2, checks: {}, completion: null,
    orch: { checksProposal: null, checksDecision: null, amended: {}, plan: null, reviews: [], proposals: [], confirmations,
      finish: [{ intentId: "c", step: "commit", status: "done", seq: 3, resultSeq: 4 }, { intentId: "p", step: "push", status: "done", seq: 8, resultSeq: 9 }] } });
  const goal = { commands: ["true"], mode: "autopilot", askPush: true };
  const ok = [{ tree, commit, push: "confirm", qa: null, seq: 6 }];
  assert.match(textsConflict(state(ok), { goal, proposal: null, decision: null }), /without its params/);
  assert.match(textsConflict(state([]), { goal, proposal: null, decision: null, finishParams: { p: { tree, commit } } }), /than the person confirmed/);
  assert.match(textsConflict(state([{ ...ok[0], push: "decline" }]), { goal, proposal: null, decision: null, finishParams: { p: { tree, commit } } }), /than the person confirmed/);
  assert.equal(textsConflict(state(ok), { goal, proposal: null, decision: null, finishParams: { p: { tree, commit } } }), null);
  assert.equal(textsConflict(state([]), { goal: { ...goal, askPush: undefined }, proposal: null, decision: null }), null, "not asked: as before");
});

test("the pause's words: asked by the setting says so, not «no checks»", () => {
  const view = (ask) => ({ status: "paused", reason: "awaiting_finish_confirmation", halted: false, confirm: { tree: "t", commit: "c", push: true, qa: false, ...(ask ? { ask: true } : {}) } });
  for (const locale of ["ru", "en"]) {
    const asked = pauseText(locale, view(true), [], true), none = pauseText(locale, view(false), [], true);
    assert.notEqual(asked.why, none.why);
    assert.match(asked.why, locale === "ru" ? /Спрашивать перед каждым push/ : /ask before each push/);
    assert.match(none.why, locale === "ru" ? /Проверок не было/ : /no checks/);
  }
});
