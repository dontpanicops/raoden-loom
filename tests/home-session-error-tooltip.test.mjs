import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeZonePath = new URL("../src/renderer/src/features/home/HomeZone.tsx", import.meta.url);
const appStylesPath = new URL("../src/renderer/src/styles/app.css", import.meta.url);

test("Home exposes failed session details from the error mark with a Copy action", async () => {
  const source = await readFile(homeZonePath, "utf8");

  assert.match(source, /session\.failureDetails \?\? `\$\{t\(locale, "failureOutputUnavailable"\)\}\$\{session\.exitCode \?\? "unknown"\}`/);
  assert.match(source, /className="usage-row__failure-tooltip"/);
  assert.match(source, /className="usage-row__failure-trigger"/);
  assert.match(source, /<UiIcon name="error" size=\{16\} \/>/);
  assert.match(source, /window\.canvasTTY\.clipboard\.writeText\(details\)/);
  assert.match(source, /t\(locale, "failureCopy"\)/); // a text button, as in mock 05 (R12a)
});

test("Home opens failure details from hover or keyboard focus in a top-layer popover", async () => {
  const source = await readFile(homeZonePath, "utf8");
  const styles = await readFile(appStylesPath, "utf8");

  assert.match(source, /popover="manual"/);
  assert.match(source, /onMouseEnter=\{openTooltip\}/);
  assert.match(source, /onFocus=\{openTooltip\}/);
  assert.match(source, /tooltip\.showPopover\(\)/);
  assert.match(styles, /\.usage-row__failure-tooltip \{ position: fixed;/);
  assert.match(styles, /\.usage-row__failure-tooltip:popover-open \{ display: block; \}/);
});

test("failure popover preserves the scroll viewport and no side stripe", async () => {
  const [source, styles] = await Promise.all([
    readFile(homeZonePath, "utf8"),
    readFile(appStylesPath, "utf8")
  ]);

  assert.match(styles, /\.usage-list \{[^}]*overflow-y: auto;/);
  assert.match(styles, /\.usage-list \{[^}]*overscroll-behavior: contain;/);
  assert.match(source, /className="tile usage-list"[\s\S]*?data-canvas-wheel-priority="local"/);
  assert.doesNotMatch(styles, /\.usage-list:has\([^}]+overflow: visible;/);
  assert.doesNotMatch(styles, /\.usage-row[^{]*::before|\.limit-row[^{]*::before/, "no side stripes on HOME rows (D-007)");
});
