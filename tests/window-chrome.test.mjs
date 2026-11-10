import assert from "node:assert/strict";
import test from "node:test";
import { mainWindowChromeOptions } from "../src/main/windowChrome.ts";

test("uses native macOS controls in a hidden title bar", () => {
  assert.deepEqual(mainWindowChromeOptions("darwin"), {
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 15 }
  });
});

test("keeps the custom frameless chrome on non-macOS platforms", () => {
  assert.deepEqual(mainWindowChromeOptions("win32"), { frame: false });
  assert.deepEqual(mainWindowChromeOptions("linux"), { frame: false });
});
