import assert from "node:assert/strict";
import test from "node:test";
import { trapTarget } from "../src/renderer/src/lib/focusTrap.ts";

test("Tab on the last item wraps to the first, Shift+Tab on the first to the last", () => {
  assert.equal(trapTarget(4, 3, false), 0);
  assert.equal(trapTarget(4, 0, true), 3);
});
test("inside the list the browser moves focus itself", () => {
  assert.equal(trapTarget(4, 1, false), null);
  assert.equal(trapTarget(4, 2, true), null);
});
test("focus outside the dialog is pulled back in", () => {
  assert.equal(trapTarget(3, -1, false), 0);
  assert.equal(trapTarget(3, -1, true), 2);
});
test("a single item keeps focus; no items is -1", () => {
  assert.equal(trapTarget(1, 0, false), 0);
  assert.equal(trapTarget(1, 0, true), 0);
  assert.equal(trapTarget(0, -1, false), -1);
});
