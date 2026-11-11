import assert from "node:assert/strict";
import test from "node:test";
import { pasteIntoRows } from "../src/renderer/src/features/orchestration/goalPaste.ts";
import { goalLines, goalRows } from "../src/renderer/src/features/orchestration/runModel.ts";

test("goal rows: a multi-line paste is split into rows, a one-line paste is left to the input", () => {
  assert.equal(pasteIntoRows(["a"], 0, 0, 0, "one line"), null);
  assert.deepEqual(pasteIntoRows([""], 0, 0, 0, "npm test\r\n\n npm run lint \n"), { rows: ["npm test", "npm run lint"], focus: 1 });
  assert.deepEqual(pasteIntoRows(["x", "tail"], 0, 1, 1, "a\nb"), { rows: ["x a", "b", "tail"], focus: 1 });
});

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
