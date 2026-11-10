#!/usr/bin/env node
// WCAG contrast check of the design tokens (stage R, spec §7.2). Reads src/renderer/src/styles/tokens.css and exits 1 on any violation.
// R0: levels 3-4 are checked on their -solid values only (there is no glass yet). R1 adds --surface-3/-4 over every canvas background.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TOKENS = fileURLToPath(new URL("../src/renderer/src/styles/tokens.css", import.meta.url));
const TEXT = 4.5;
const NON_TEXT = 3;

const css = readFileSync(TOKENS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function blocks(selectorPattern) {
  const found = new Map();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of match[1].split(",").map((part) => part.trim())) {
      if (!selectorPattern.test(selector)) continue;
      const vars = found.get(selector) ?? {};
      for (const decl of match[2].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);?/g)) vars[decl[1]] = decl[2].trim();
      found.set(selector, vars);
    }
  }
  return found;
}

function parseColor(value) {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    const n = (i) => Number.parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value);
  if (rgba) return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: rgba[4] === undefined ? 1 : +rgba[4] };
  throw new Error(`cannot parse colour "${value}"`);
}

const over = (top, back) => ({
  r: top.r * top.a + back.r * (1 - top.a),
  g: top.g * top.a + back.g * (1 - top.a),
  b: top.b * top.a + back.b * (1 - top.a),
  a: 1
});

function luminance({ r, g, b }) {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function ratio(fg, bg) {
  const a = luminance(over(fg, bg));
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// "linear-gradient(180deg,#F7F4ED,#E9E4D9)" -> both stops
function colorsOf(value) {
  if (value.startsWith("linear-gradient")) return [...value.matchAll(/#[0-9a-f]{3,8}/gi)].map((m) => m[0]);
  return [value];
}

const violations = [];
let checked = 0;
function check(label, fgValue, bgValue, threshold, backdropValue = "#000000") {
  const backdrop = parseColor(backdropValue);
  for (const bgStop of colorsOf(bgValue)) {
    const bg = over(parseColor(bgStop), backdrop);
    for (const fgStop of colorsOf(fgValue)) {
      checked += 1;
      const value = ratio(parseColor(fgStop), bg);
      if (value < threshold) violations.push(`${label}: ${value.toFixed(2)} < ${threshold}  (${fgStop} on ${bgStop})`);
    }
  }
}

const themes = blocks(/^\.app--(sand|bay|paper|frost)$/);
const canvases = blocks(/^\.app--canvas-[a-z]+$/);
const homes = blocks(/^\.app--home-[a-z]+$/);
const need = (vars, name, where) => {
  if (!vars[name]) throw new Error(`${where}: ${name} is missing`);
  return vars[name];
};

for (const [selector, v] of themes) {
  const theme = selector.replace(".app--", "");
  const dark = theme === "sand" || theme === "bay";
  const surfaces = ["--surface-2", "--surface-2-b", "--surface-3-solid", "--surface-4-solid"];
  const texts = ["--text-primary", "--text-secondary", "--text-muted", "--status-idle", "--status-working", "--status-waiting",
    "--status-paused", "--status-failed", "--status-done", "--danger-fg"];
  for (const surface of surfaces) {
    for (const text of texts) check(`${theme}: ${text} on ${surface}`, need(v, text, theme), need(v, surface, theme), TEXT);
    check(`${theme}: --focus on ${surface}`, need(v, "--focus", theme), need(v, surface, theme), NON_TEXT);
  }
  check(`${theme}: --accent-text on --accent-bg`, need(v, "--accent-text", theme), need(v, "--accent-bg", theme), TEXT);
  check(`${theme}: --danger-text on --danger`, need(v, "--danger-text", theme), need(v, "--danger", theme), TEXT);
  check(`${theme}: --accent-text on --accent`, need(v, "--accent-text", theme), need(v, "--accent", theme), TEXT);
  for (const status of ["--status-working", "--status-waiting", "--status-done"]) {
    check(`${theme}: --on-status on ${status}`, need(v, "--on-status", theme), need(v, status, theme), TEXT);
  }

  const termBg = need(v, "--term-bg", theme);
  check(`${theme}: --term-fg on --term-bg`, need(v, "--term-fg", theme), termBg, NON_TEXT);
  const skipped = dark ? ["black", "bright-black"] : ["white", "bright-white"];
  for (const name of ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    "bright-black", "bright-red", "bright-green", "bright-yellow", "bright-blue", "bright-magenta", "bright-cyan", "bright-white"]) {
    if (skipped.includes(name)) continue;
    check(`${theme}: --ansi-${name} on --term-bg`, need(v, `--ansi-${name}`, theme), termBg, NON_TEXT);
  }
  // the dark themes draw ANSI black as the terminal background itself
  if (dark && need(v, "--ansi-black", theme).toLowerCase() !== termBg.toLowerCase()) {
    violations.push(`${theme}: --ansi-black must equal --term-bg`);
  }

  // "as in theme" canvas, and the theme's neutral HOME tiles
  check(`${theme}: --canvas-ink on --surface-0 (as in theme)`, need(v, "--text-primary", theme), need(v, "--surface-0", theme), TEXT);
  check(`${theme}: --canvas-ink-muted on --surface-0 (as in theme)`, need(v, "--text-muted", theme), need(v, "--surface-0", theme), TEXT);
  check(`${theme}: --text-primary on neutral HOME tile`, need(v, "--text-primary", theme), need(v, "--surface-2", theme), TEXT);
  check(`${theme}: --text-primary on neutral HOME dock tile (--surface-sunken)`, need(v, "--text-primary", theme),
    need(v, "--surface-sunken", theme), TEXT, need(v, "--surface-2", theme));
}

for (const [selector, v] of canvases) {
  const name = selector.replace(".app--", "");
  check(`${name}: --canvas-ink on --surface-0`, need(v, "--canvas-ink", name), need(v, "--surface-0", name), TEXT);
  check(`${name}: --canvas-ink-muted on --surface-0`, need(v, "--canvas-ink-muted", name), need(v, "--surface-0", name), TEXT);
}

for (const [selector, v] of homes) {
  const name = selector.replace(".app--", "");
  for (const role of ["clock", "dock", "dock-tile", "browser", "settings", "media"]) {
    check(`${name}: --home-${role}-text on --home-${role}`, need(v, `--home-${role}-text`, name), need(v, `--home-${role}`, name), TEXT);
  }
}

if (themes.size !== 4 || canvases.size !== 6 || homes.size !== 5) {
  violations.push(`expected 4 themes, 6 canvas backgrounds and 5 HOME palettes, found ${themes.size}, ${canvases.size}, ${homes.size}`);
}

if (violations.length) {
  console.error(violations.join("\n"));
  console.error(`contrast-check: ${violations.length} violation(s) in ${checked} checks`);
  process.exit(1);
}
console.log(`contrast-check: ${checked} checks, 0 violations (${themes.size} themes, ${canvases.size} canvas backgrounds, ${homes.size} HOME palettes)`);
