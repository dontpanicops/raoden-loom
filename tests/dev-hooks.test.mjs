import assert from "node:assert/strict";
import test from "node:test";
import { devHooksArguments } from "../src/main/devHooks.ts";

test("the page test hooks are on in a development build and off in a packaged one", () => {
  assert.deepEqual(devHooksArguments(true), []);
  assert.deepEqual(devHooksArguments(false), ["--canvastty-dev-hooks"]);
});
