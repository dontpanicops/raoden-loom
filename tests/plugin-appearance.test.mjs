import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { toLegacyPalette } from "../src/shared/appearance.ts";

test("plugins keep getting the old palette ids; the new theme goes in appearance.theme", () => {
  assert.equal(toLegacyPalette("sand"), "sage");
  assert.equal(toLegacyPalette("bay"), "night");
  assert.equal(toLegacyPalette("paper"), "sage");
  assert.equal(toLegacyPalette("frost"), "sage");
  const ipc = readFileSync(new URL("../src/main/ipc/registerIpc.ts", import.meta.url), "utf8");
  const frame = readFileSync(new URL("../src/renderer/src/features/plugins/PluginFrame.tsx", import.meta.url), "utf8");
  assert.match(ipc, /const theme = effectiveTheme\(settings\.get\(\), nativeTheme\.shouldUseDarkColors\)/u);
  assert.match(ipc, /palette: toLegacyPalette\(theme\), theme \}/u);
  assert.match(frame, /palette: toLegacyPalette\(palette\), theme: palette/u);
  const api = readFileSync(new URL("../docs/plugin-api.d.ts", import.meta.url), "utf8");
  assert.match(api, /palette: "sage" \| "lilac" \| "night";/u);
  assert.match(api, /theme: "sand" \| "bay" \| "paper" \| "frost";/u);
});

test("main window and startup page take the theme in effect", () => {
  const index = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
  const startup = readFileSync(new URL("../src/main/startupPage.ts", import.meta.url), "utf8");
  assert.match(index, /backgroundColor: windowBackground\(currentTheme\),/u);
  assert.match(index, /theme: currentTheme/u);
  assert.match(startup, /windowBackground\(theme\)/u);
  assert.doesNotMatch(index, /themeSource/u, "the app never overrides the system theme");
  const api = readFileSync(new URL("../docs/plugin-api.d.ts", import.meta.url), "utf8");
  assert.match(api, /The theme in effect/u);
});
