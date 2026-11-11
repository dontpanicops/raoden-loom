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
  assert.deepEqual(canvasColorPatch("linen"), { canvasColor: "linen" });
  assert.deepEqual(canvasColorPatch("stone"), { canvasColor: "stone" });
});

test("HOME palette updates never include the Canvas background field", () => {
  assert.deepEqual(homeAccentPresetPatch("warm"), { homeAccentPreset: "warm" });
  assert.deepEqual(homeAccentPresetPatch("custom"), { homeAccentPreset: "custom" });
});

test("Canvas color classes only override the Canvas background and pattern color", () => {
  const tokens = readFileSync(new URL("../src/renderer/src/styles/tokens.css", import.meta.url), "utf8");
  const blocks = [...tokens.matchAll(/^\.app--canvas-[^{]+\{([^}]*)\}/gm)];
  assert.equal(blocks.length, 6);
  for (const [, body] of blocks) {
    const variables = [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]).sort();
    assert.deepEqual(variables, ["--canvas-dot", "--canvas-ink", "--canvas-ink-muted", "--surface-0", "--surface-0-hi", "--surface-0-lo"]);
  }
});

test("R1: the dark themes' glass over a light canvas overrides only the two glass levels", () => {
  const tokens = readFileSync(new URL("../src/renderer/src/styles/tokens.css", import.meta.url), "utf8");
  const blocks = [...tokens.matchAll(/^[^\n{]*\.app--(?:sand|bay)\.app--canvas-[^{]+\{([^}]*)\}/gm)];
  assert.equal(blocks.length, 4);
  for (const [, body] of blocks) {
    assert.deepEqual([...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]), ["--surface-3", "--surface-4"]);
  }
});

test("HOME rows carry their state in a glyph and a label, never a side stripe (D-007)", () => {
  const styles = readFileSync(new URL("../src/renderer/src/styles/app.css", import.meta.url), "utf8");
  assert.doesNotMatch(styles, /\.limit-row[^{,]*::before|\.usage-row[^{,]*::before/u);
  assert.match(styles, /\.limit-row--stale \.limit-row__value/u);
  assert.match(styles, /\.usage-row\[data-session-tone="waiting"\] \.usage-row__chip/u);
  assert.doesNotMatch(styles, /\.limit-row--(?:stale|error)\s*\{[^}]*box-shadow:/u);
});

test("segmented settings keep focus inside the button and separate conditional editors", () => {
  const styles = readFileSync(new URL("../src/renderer/src/styles/app.css", import.meta.url), "utf8");
  assert.match(styles, /\.segmented__button\s*\{[^}]*outline:\s*0;[^}]*box-shadow\s+\.15s\s+ease/u);
  assert.match(styles, /\.segmented__button:focus-visible\s*\{[^}]*box-shadow:\s*inset\s+0\s+0\s+0\s+2px/u);
  assert.match(styles, /\.setting-group__control\s*>\s*\.segmented\s*\+\s*\.shortcut-editor\s*\{[^}]*margin-top:\s*\.6em;/u);
});

test("the HOME limits tile lists the provider rows under a header and one note when no CLI is found", () => {
  const styles = readFileSync(new URL("../src/renderer/src/styles/app.css", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/renderer/src/features/home/HomeZone.tsx", import.meta.url), "utf8");
  assert.match(styles, /\.agent-overview\s*\{[^}]*flex-direction:\s*column;[^}]*overflow-y:\s*auto;/u);
  assert.match(styles, /\.limit-row__track\s*\{[^}]*height:\s*6px;/u);
  assert.match(source, /every\(\(row\) => row\.reason === "cli-not-found"\)/u);
  assert.match(source, /formatResetCountdown\(row\.window\.resetsAt,\s*now,\s*locale\)/u);
});
