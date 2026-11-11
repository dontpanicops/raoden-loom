import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { onboardingPlacement, onboardingSteps, onboardingVisible } from "../src/renderer/src/features/onboarding/onboardingSteps.ts";
import { agentCardStatus, sessionCardStatus, CARD_STATUS_ICON } from "../src/renderer/src/lib/cardStatus.ts";

const css = readFileSync(new URL("../src/renderer/src/styles/app.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../src/renderer/src/styles/tokens.css", import.meta.url), "utf8");

test("onboarding steps follow the facts", () => {
  const ids = (f) => onboardingSteps(f).map((s) => `${s.id}:${s.done}`).join(" ");
  assert.equal(ids({ terminalOpened: false, cliFound: 0, linked: false }), "terminal:false cli:false link:false");
  assert.equal(ids({ terminalOpened: true, cliFound: 3, linked: false }), "terminal:true cli:true link:false");
  assert.equal(ids({ terminalOpened: true, cliFound: 0, linked: true }), "terminal:true cli:false link:true");
});

test("the onboarding card is hidden once dismissed or when every step is done", () => {
  const todo = onboardingSteps({ terminalOpened: true, cliFound: 0, linked: false });
  const all = onboardingSteps({ terminalOpened: true, cliFound: 1, linked: true });
  assert.equal(onboardingVisible(false, todo), true);
  assert.equal(onboardingVisible(true, todo), false);
  assert.equal(onboardingVisible(false, all), false);
});

test("card status: six kinds, each with its own glyph, and every session and agent state maps", () => {
  assert.deepEqual(Object.values(CARD_STATUS_ICON).sort(), ["bell", "status-done", "status-failed", "status-idle", "status-paused", "working"]);
  for (const st of ["idle", "working", "needs_approval", "unavailable", "done", "failed"]) assert.ok(sessionCardStatus(st));
  assert.equal(sessionCardStatus("needs_approval"), "waiting");
  assert.equal(agentCardStatus("needs_you"), "waiting");
  assert.equal(agentCardStatus("failed"), "failed");
  assert.equal(agentCardStatus("completed"), "done");
});

test("R2 cards: level 2 and opaque, one 44px header, waiting ring, no backdrop-filter on a card", () => {
  assert.match(tokens, /--card-header-h: 44px/);
  for (const card of ["terminal-card", "plugin-canvas-card", "browser-card", "agent-card", "board-card", "sticky-note-card"]) {
    const rule = css.match(new RegExp(`^\\.${card} \\{[^\\n]*`, "m"))[0];
    assert.match(rule, /box-shadow: var\(--edge\), var\(--elev-2\)/, card);
    assert.match(rule, /--card-header-height: calc\(var\(--card-header-h\) \* var\(--ui-scale, 1\)\)/, card);
    assert.doesNotMatch(rule, /backdrop-filter/, card);
  }
  assert.doesNotMatch(css, /3\.15em/);
  assert.match(css, /\.terminal-card--waiting, \.agent-card--needs_you \{[^}]*var\(--status-waiting\)[^}]*22px/);
});

test("the first-run card is placed clear of HOME: right of it, else below it, else not shown", () => {
  const home = { left: 193, top: 118, right: 980, bottom: 585 };
  assert.deepEqual(onboardingPlacement(home, { width: 1440, height: 856 }), { left: 1004, top: 200, width: 418, maxHeight: 638, guide: { left: 193, top: 609 } });
  assert.deepEqual(onboardingPlacement(home, { width: 1200, height: 1100 }), { left: 193, top: 609, width: 560, maxHeight: 473, guide: null });
  assert.equal(onboardingPlacement(home, { width: 1000, height: 700 }), null);
  assert.equal(onboardingPlacement({ ...home, left: -50, right: 737 }, { width: 1440, height: 856 }), null); // HOME not wholly in sight
});

test("R5d: terminal footer texts per the mock-up; a narrow gap puts the link chip above the pair", async () => {
  const i18n = readFileSync(new URL("../src/renderer/src/lib/i18n.ts", import.meta.url), "utf8");
  for (const line of ['statusExitedCode: "Вышел · код {code}"', 'statusFailedCode: "Упал · код {code}"', 'statusNeedsApprovalCard: "Ждёт одобрения · ответ в терминале"', 'statusIdle: "Свободен"', 'statusNeedsApproval: "Ждёт ввода"']) assert.ok(i18n.includes(line), line);
  const { chipOnCurve } = await import("../src/renderer/src/features/orchestration/linkChip.ts");
  const { linkGeometry } = await import("../src/renderer/src/features/orchestration/linkCurve.ts");
  const a = { x: 0, y: 0, width: 300, height: 222 };
  const b = { x: 360, y: 140, width: 300, height: 222 };
  const at = chipOnCurve(linkGeometry({ x: 300, y: 111 }, { x: 360, y: 251 }), [a, b], { width: 400, height: 26 }, false, [a, b]);
  assert.ok(at.y + 13 <= -17, "above the higher card, 18px clear");
});
