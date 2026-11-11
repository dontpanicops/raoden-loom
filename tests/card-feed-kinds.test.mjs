// The run panel's feed leaves the application's own lines to «Журнал» (R5h-A); the agent card still shows «task sent».
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../src/renderer/src/features/orchestration/RunPanel.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("../src/renderer/src/features/orchestration/AgentCard.tsx", import.meta.url), "utf8");

test("the feed kinds of the run panel have no task_sent, the card's kinds add it", () => {
  const feed = panel.match(/export const FEED_KINDS = new Set\(\[([^\]]*)\]/)[1];
  assert.doesNotMatch(feed, /task_sent|process_started|process_exited|"session"/);
  assert.match(panel, /CARD_FEED_KINDS[^=]*= new Set\(\[\.\.\.FEED_KINDS, "task_sent"\]\)/);
  assert.match(card, /CARD_FEED_KINDS\.has\(e\.kind\)/);
  assert.doesNotMatch(card, /[^_]FEED_KINDS\.has/);
});
