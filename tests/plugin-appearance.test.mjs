import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DARK_WINDOW_BACKGROUND, toLegacyPalette } from "../src/shared/appearance.ts";

test("plugins keep getting the old palette ids; the new theme goes in appearance.theme", () => {
  assert.equal(toLegacyPalette("sand"), "sage");
  assert.equal(toLegacyPalette("bay"), "night");
  assert.equal(toLegacyPalette("paper"), "sage");
  assert.equal(toLegacyPalette("frost"), "sage");
  const ipc = readFileSync(new URL("../src/main/ipc/registerIpc.ts", import.meta.url), "utf8");
  const frame = readFileSync(new URL("../src/renderer/src/features/plugins/PluginFrame.tsx", import.meta.url), "utf8");
  assert.match(ipc, /palette: toLegacyPalette\(settings\.get\(\)\.palette\), theme: settings\.get\(\)\.palette/u);
  assert.match(frame, /palette: toLegacyPalette\(palette\), theme: palette/u);
  const api = readFileSync(new URL("../docs/plugin-api.d.ts", import.meta.url), "utf8");
  assert.match(api, /palette: "sage" \| "lilac" \| "night";/u);
  assert.match(api, /theme: "sand" \| "bay" \| "paper" \| "frost";/u);
});

test("main window and startup page share one dark colour", () => {
  assert.equal(DARK_WINDOW_BACKGROUND, "#24221E");
  const index = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
  const startup = readFileSync(new URL("../src/main/startupPage.ts", import.meta.url), "utf8");
  assert.match(index, /backgroundColor: DARK_WINDOW_BACKGROUND,/u);
  assert.match(startup, /\$\{DARK_WINDOW_BACKGROUND\}/u);
});
