import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { effectiveTheme, isLightTheme, windowBackground } from "../src/shared/appearance.ts";

test("effectiveTheme: followSystem x systemDark x palette", () => {
  for (const palette of ["sand", "bay", "paper", "frost"]) {
    assert.equal(effectiveTheme({ palette, followSystem: false }, true), palette);
    assert.equal(effectiveTheme({ palette, followSystem: false }, false), palette);
    assert.equal(effectiveTheme({ palette, followSystem: true }, true), "sand");
    assert.equal(effectiveTheme({ palette, followSystem: true }, false), "paper");
    assert.equal(effectiveTheme({ palette }, false), palette, "missing followSystem is off");
  }
});

test("windowBackground matches --surface-0 of every theme in tokens.css", () => {
  const css = readFileSync(new URL("../src/renderer/src/styles/tokens.css", import.meta.url), "utf8");
  for (const theme of ["sand", "bay", "paper", "frost"]) {
    const block = css.slice(css.indexOf(`.app--${theme}{`));
    assert.equal(block.match(/--surface-0:\s*(#[0-9A-Fa-f]{6})/)[1].toUpperCase(), windowBackground(theme).toUpperCase(), theme);
  }
  assert.deepEqual(["sand", "bay", "paper", "frost"].map(isLightTheme), [false, false, true, true]);
});

test("a manual theme choice sends one patch that turns followSystem off (Settings, part 2)", () => {
  // the patch the Settings swatch must send; palette is never rewritten by followSystem itself
  const patch = { palette: "frost", followSystem: false };
  assert.equal(effectiveTheme({ palette: "sand", followSystem: true, ...patch }, false), "frost");
});

test("renderer: settings.palette is read only by the hook and Settings", () => {
  const out = [];
  const files = ["App.tsx", "features/home/HomeZone.tsx", "features/workspace/WorkspaceCanvas.tsx", "features/plugins/PluginCanvasCard.tsx", "features/plugins/PluginFrame.tsx"];
  for (const f of files) if (/settings\.palette/.test(readFileSync(new URL(`../src/renderer/src/${f}`, import.meta.url), "utf8"))) out.push(f);
  assert.deepEqual(out, []);
});
