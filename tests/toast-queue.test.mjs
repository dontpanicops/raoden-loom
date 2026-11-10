import assert from "node:assert/strict";
import test from "node:test";
import { autoDismissMs, MAX_TOASTS, toastReducer } from "../src/renderer/src/lib/toastQueue.ts";

const toast = (id, kind = "info", message = `m${id}`) => ({ id, kind, message });
const push = (queue, t) => toastReducer(queue, { type: "push", toast: t });

test("the queue holds three and drops the oldest", () => {
  let q = [];
  for (let i = 1; i <= 5; i += 1) q = push(q, toast(i));
  assert.equal(MAX_TOASTS, 3);
  assert.deepEqual(q.map((t) => t.id), [3, 4, 5]);
});

test("a repeat replaces the visible toast instead of stacking", () => {
  let q = push(push([], toast(1, "error", "x")), toast(2, "info", "y"));
  q = push(q, toast(3, "error", "x"));
  assert.deepEqual(q.map((t) => t.id), [2, 3]);
});

test("dismiss removes one toast and ignores an unknown id", () => {
  const q = [toast(1), toast(2)];
  assert.deepEqual(toastReducer(q, { type: "dismiss", id: 1 }).map((t) => t.id), [2]);
  assert.equal(toastReducer(q, { type: "dismiss", id: 9 }).length, 2);
});

test("success and info expire after 4 s, error and waiting stay", () => {
  assert.equal(autoDismissMs("success"), 4000);
  assert.equal(autoDismissMs("info"), 4000);
  assert.equal(autoDismissMs("error"), null);
  assert.equal(autoDismissMs("waiting"), null);
});
