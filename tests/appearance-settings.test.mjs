import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_HOME_ACCENT_COLORS } from "../src/shared/contracts.ts";
import {
  canvasColorPatch,
  homeAccentPresetPatch,
  resolveAppearanceSettings
} from "../src/renderer/src/features/settings/appearanceSettings.ts";

test("stale renderer settings resolve the new appearance fields without crashing", () => {
  assert.deepEqual(resolveAppearanceSettings({}), {
    homeAccentPreset: "theme",
    homeAccentColors: DEFAULT_HOME_ACCENT_COLORS,
    canvasColor: "theme"
  });
});

test("resolved appearance settings preserve a host-confirmed customization", () => {
  const homeAccentColors = {
    clock: "#101010",
    launcher: "#202020",
    browser: "#303030",
    settings: "#404040",
    media: "#505050"
  };
  assert.deepEqual(resolveAppearanceSettings({
    homeAccentPreset: "custom",
    homeAccentColors,
    canvasColor: "slate"
  }), {
    homeAccentPreset: "custom",
    homeAccentColors,
    canvasColor: "slate"
  });
});

test("without a stored Canvas background the theme's own is used", () => {
  assert.equal(resolveAppearanceSettings({ palette: "bay", canvasColor: "palette" }).canvasColor, "theme");
  assert.equal(resolveAppearanceSettings({ palette: "bay" }).canvasColor, "theme");
});

test("Canvas background updates never include HOME palette fields", () => {
  assert.deepEqual(canvasColorPatch("sand"), { canvasColor: "sand" });
  assert.deepEqual(canvasColorPatch("stone"), { canvasColor: "stone" });
});

test("HOME palette updates never include the Canvas background field", () => {
  assert.deepEqual(homeAccentPresetPatch("warm"), { homeAccentPreset: "warm" });
  assert.deepEqual(homeAccentPresetPatch("custom"), { homeAccentPreset: "custom" });
});

test("Canvas color classes only override the Canvas background and pattern color", () => {
  const tokens = readFileSync(new URL("../src/renderer/src/styles/tokens.css", import.meta.url), "utf8");
  const blocks = [...tokens.matchAll(/\.app--canvas-[^{]+\{([^}]*)\}/g)];
  assert.equal(blocks.length, 6);
  for (const [, body] of blocks) {
    const variables = [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]).sort();
    assert.deepEqual(variables, ["--canvas-dot", "--canvas-ink", "--canvas-ink-muted", "--surface-0", "--surface-0-hi", "--surface-0-lo"]);
  }
});

test("HOME state accents use bounded rails instead of rounded inset shadows", () => {
  const styles = readFileSync(new URL("../src/renderer/src/styles/app.css", import.meta.url), "utf8");
  assert.match(styles, /\.limit-row--stale::before[^}]+top:\s*10px;[^}]+bottom:\s*10px;/u);
  assert.match(styles, /\.limit-row--error::before[^}]+background:\s*var\(--danger\);/u);
  assert.doesNotMatch(styles, /\.limit-row--(?:stale|error)\s*\{[^}]*box-shadow:/u);
});

test("segmented settings keep focus inside the button and separate conditional editors", () => {
  const styles = readFileSync(new URL("../src/renderer/src/styles/app.css", import.meta.url), "utf8");
  assert.match(styles, /\.segmented__button\s*\{[^}]*outline:\s*0;[^}]*box-shadow\s+\.15s\s+ease/u);
  assert.match(styles, /\.segmented__button:focus-visible\s*\{[^}]*box-shadow:\s*inset\s+0\s+0\s+0\s+2px/u);
  assert.match(styles, /\.setting-group__control\s*>\s*\.segmented\s*\+\s*\.shortcut-editor\s*\{[^}]*margin-top:\s*\.6em;/u);
});

test("the HOME limits grid follows the selected provider count", () => {
  const styles = readFileSync(new URL("../src/renderer/src/styles/app.css", import.meta.url), "utf8");
  assert.match(styles, /\.limits-list\s*\{[^}]*repeat\(var\(--limit-rows,\s*3\),\s*minmax\(0,\s*1fr\)\)/u);
  assert.doesNotMatch(styles, /\.limits-list\s*\{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/u);
});

test("four or more HOME limit rows switch to bounded compact geometry", () => {
  const styles = readFileSync(new URL("../src/renderer/src/styles/app.css", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/renderer/src/features/home/HomeZone.tsx", import.meta.url), "utf8");
  assert.match(source, /home\.limitRows\.length\s*>=\s*4\s*\?\s*"limits-list--dense"/u);
  assert.match(styles, /\.limits-list--dense\s*\{[^}]*padding:\s*10px;[^}]*gap:\s*6px;/u);
  assert.match(styles, /\.limit-row\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;[^}]*container:\s*limit-row\s*\/\s*size;/u);
  assert.match(styles, /@container\s+limit-row\s*\(max-height:\s*48px\)/u);
  assert.match(styles, /\.limit-row\s*>\s*\.provider-icon--medium\s*\{[^}]*--provider-icon-art-size:\s*24px;[^}]*height:\s*32px;/u);
  assert.match(source, /formatPercent\(row\.window\.usedPercent,\s*locale\)[\s\S]*formatResetCountdown\(row\.window\.resetsAt,\s*now,\s*locale\)/u);
  assert.match(styles, /\.limit-row__summary strong\s*\{[^}]*font-size:\s*22px;/u);
  assert.match(styles, /\.limit-row__summary\s*>\s*span\s*\{[^}]*font-size:\s*11px;/u);
  assert.match(styles, /\.limit-row__track\s*\{[^}]*height:\s*4px;/u);
});
