import assert from "node:assert/strict";
import test from "node:test";
import { goalLines, goalRows } from "../src/renderer/src/features/orchestration/runModel.ts";

test("goal rows: what is sent is the trimmed non-empty lines", () => {
  assert.deepEqual(goalLines("  node --test \n\n npm run lint\n   \n"), ["node --test", "npm run lint"]);
  assert.deepEqual(goalLines(""), []);
});

test("goal rows: the editor rows for a text", () => {
  assert.deepEqual(goalRows("", false), [""]); // commands always show one row
  assert.deepEqual(goalRows("", true), []); // requirements show only the trailing input
  assert.deepEqual(goalRows("a\nb", true), ["a", "b"]);
  assert.deepEqual(goalRows("a\n", true), ["a"]); // the empty last line is the trailing input
  assert.deepEqual(goalRows("a\n", false), ["a", ""]);
});
