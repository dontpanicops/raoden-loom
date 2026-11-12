#!/usr/bin/env node
// Regression check of D-039: compares the app frames of two pair dirs (scripts/conformance-pairs.mjs output) pixel by pixel.
// Usage: node scripts/conformance-diff.mjs --a <accepted pairs dir> --b <new pairs dir> [--threshold 0.02] [--json <file>]
// Prints the rows whose share of differing pixels is above the threshold, plus frames added or gone; writes the same as JSON
// (default <b>/diff.json). Always exits 0: the list is for a second look, not a gate.
// Decoding without dependencies: macOS sips converts each JPEG to an uncompressed BMP, read here. A pixel differs when a
// channel moves by more than 32 (JPEG q70 noise stays below it). Frames of different size count as fully changed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const A = arg("a"), B = arg("b"), THRESHOLD = Number(arg("threshold") ?? 0.02);
if (!A || !B) { console.error("usage: --a <dir> --b <dir> [--threshold 0.02] [--json <file>]"); process.exit(2); }
const JSON_OUT = arg("json") ?? path.join(B, "diff.json");
const TOLERANCE = 32;

const appFrames = (dir) => {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith("-app.jpg")) out.push(path.relative(dir, p)); } };
  walk(dir);
  return out.sort();
};
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conformance-diff-"));
let n = 0;
// { w, h, px(x, y) -> [r, g, b] } from a BMP written by sips (24 or 32 bit, top-down or bottom-up)
const decode = (file) => {
  const bmp = path.join(tmpDir, `${n++}.bmp`);
  execFileSync("sips", ["-s", "format", "bmp", file, "--out", bmp], { stdio: "ignore" });
  const b = fs.readFileSync(bmp);
  fs.rmSync(bmp);
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), rawH = b.readInt32LE(22), bpp = b.readUInt16LE(28) / 8;
  const h = Math.abs(rawH), stride = Math.ceil((w * bpp) / 4) * 4;
  return { w, h, px: (x, y) => { const i = off + (rawH < 0 ? y : h - 1 - y) * stride + x * bpp; return [b[i + 2], b[i + 1], b[i]]; } };
};
const share = (fa, fb) => {
  const a = decode(fa), b = decode(fb);
  if (a.w !== b.w || a.h !== b.h) return 1;
  let diff = 0;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const p = a.px(x, y), q = b.px(x, y);
    if (Math.abs(p[0] - q[0]) > TOLERANCE || Math.abs(p[1] - q[1]) > TOLERANCE || Math.abs(p[2] - q[2]) > TOLERANCE) diff++;
  }
  return diff / (a.w * a.h);
};

const inB = appFrames(B);
const zonesB = new Set(inB.map((rel) => path.dirname(rel))); // B may hold some zones only (--zone): compare those
const inA = new Set(appFrames(A).filter((rel) => zonesB.has(path.dirname(rel))));
const row = (rel) => { const m = path.basename(rel).match(/^(.*)-(\w+)-app\.jpg$/); return { zone: path.dirname(rel), row: m?.[1], theme: m?.[2] }; };
const changed = [], added = [], same = [];
for (const rel of inB) {
  if (!inA.has(rel)) { added.push({ file: rel, ...row(rel) }); continue; }
  inA.delete(rel);
  const ratio = share(path.join(A, rel), path.join(B, rel));
  (ratio > THRESHOLD ? changed : same).push({ file: rel, ...row(rel), ratio: Math.round(ratio * 10000) / 10000 });
}
const removed = [...inA].map((rel) => ({ file: rel, ...row(rel) }));
fs.rmSync(tmpDir, { recursive: true, force: true });

changed.sort((x, y) => y.ratio - x.ratio);
console.log(`сравнено ${changed.length + same.length}, изменилось ${changed.length} (порог ${THRESHOLD}), новых ${added.length}, пропало ${removed.length}`);
for (const c of changed) console.log(`  ${c.zone} ${c.row} ${c.theme} ${(c.ratio * 100).toFixed(1)}%`);
if (added.length) console.log(`новые:\n${added.map((x) => `  ${x.file}`).join("\n")}`);
if (removed.length) console.log(`пропали:\n${removed.map((x) => `  ${x.file}`).join("\n")}`);
fs.writeFileSync(JSON_OUT, JSON.stringify({ threshold: THRESHOLD, tolerance: TOLERANCE, changed, added, removed }, null, 1) + "\n");
console.log(`json: ${JSON_OUT}`);
