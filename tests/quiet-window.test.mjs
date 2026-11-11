import test from "node:test";
import assert from "node:assert/strict";
import { quietWindow } from "../src/main/quietWindow.ts";

test("quiet window only in a development build with a smoke variable", () => {
  assert.equal(quietWindow({ packaged: true, env: { CANVASTTY_SMOKE_HERMETIC: "1", CANVASTTY_QUIET_WINDOW: "1" } }), false);
  assert.equal(quietWindow({ packaged: false, env: {} }), false);
  assert.equal(quietWindow({ packaged: false, env: { CANVASTTY_SMOKE_HERMETIC: "1" } }), true);
  assert.equal(quietWindow({ packaged: false, env: { CANVASTTY_QUIET_WINDOW: "1" } }), true);
  assert.equal(quietWindow({ packaged: false, env: { CANVASTTY_SMOKE_HERMETIC: "1", CANVASTTY_QUIET_WINDOW: "0" } }), false);
});
