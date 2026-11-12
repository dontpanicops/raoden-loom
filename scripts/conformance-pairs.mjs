#!/usr/bin/env node
// Pairs «mock | app» from the mock inventory (D-039, docs/ux-audit/2026-11-10/conformance-process.md).
// Usage: node scripts/conformance-pairs.mjs --inventory <json> --shots <dir>[,<dir>...] --out <dir> [--zone Z1] [--html]
//        [--mocks <preview dir>] [--mocks-png <2x png dir>]
// Writes <out>/<zone>/<id>-<theme>-{mock,app}.jpg (JPEG 1440 wide, q70, macOS sips). Exit 1 when a row of the zone has no
// frame (scene missing, file absent, empty or smaller than the crop), or a shots dir has a non-empty failed.txt.
// The mock crop is in pixels of redesign/preview/<mock>-<theme>.jpg (1440 wide); when that JPEG is absent, the 2x PNG of
// redesign/shots/ is used and the crop is scaled by its width. Rows with "skip" are superseded by another mock and not cut.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const flag = (name) => process.argv.includes(`--${name}`);
const INV = arg("inventory"), OUT = arg("out"), SHOTS = (arg("shots") ?? "").split(",").filter(Boolean);
if (!INV || !OUT || !SHOTS.length) { console.error("usage: --inventory <json> --shots <dir>[,<dir>] --out <dir> [--zone Z1] [--html]"); process.exit(2); }
const ZONE = arg("zone");
const base = path.dirname(path.resolve(INV));
const MOCKS = arg("mocks") ?? path.join(base, "redesign/preview");
const MOCKS_PNG = arg("mocks-png") ?? path.join(base, "redesign/shots");
const MOCK_WIDTH = 1440; // the preview JPEGs: mockCrop is in their pixels

const rows = JSON.parse(fs.readFileSync(INV, "utf8")).rows.filter((r) => !ZONE || r.zone === ZONE);
const problems = [], gaps = [], skipped = [], unfair = [], pairs = [];

const sips = (...a) => execFileSync("sips", a, { encoding: "utf8" });
const dimsCache = new Map();
const dims = (f) => {
  if (!dimsCache.has(f)) {
    const out = sips("-g", "pixelWidth", "-g", "pixelHeight", f);
    dimsCache.set(f, { w: +out.match(/pixelWidth: (\d+)/)[1], h: +out.match(/pixelHeight: (\d+)/)[1] });
  }
  return dimsCache.get(f);
};
const tmpOf = (src) => path.join(OUT, `.tmp${path.extname(src)}`); // sips keeps the source format on crop
// crop (in the file's pixels) and save as JPEG 1440 wide q70; returns an error text or null
const cut = (src, c, dst) => {
  let d;
  try { if (!fs.statSync(src).size) return "пустой файл"; d = dims(src); } catch (e) { return `не читается: ${String(e.message).split("\n")[0]}`; }
  if (!d.w || !d.h) return "пустой кадр";
  const r = c ?? { x: 0, y: 0, w: d.w, h: d.h };
  if (r.x < 0 || r.y < 0 || r.x + r.w > d.w || r.y + r.h > d.h) return `кадр ${d.w}×${d.h} меньше вырезки ${JSON.stringify(r)}`;
  const tmp = tmpOf(src);
  // sips ignores the crop when it touches the bottom edge at x = 0 (y + h = height): crop the flipped image from the top instead
  const flip = r.x === 0 && r.y > 0 && r.y + r.h === d.h;
  if (flip) {
    sips("-f", "vertical", src, "--out", tmp);
    sips("-c", String(r.h), String(r.w), "--cropOffset", "0", "0", tmp, "--out", tmp);
    sips("-f", "vertical", tmp, "--out", tmp);
  } else sips("-c", String(r.h), String(r.w), "--cropOffset", String(r.y), String(r.x), src, "--out", tmp);
  dimsCache.delete(tmp);
  const got = dims(tmp);
  dimsCache.delete(tmp);
  if (got.w !== r.w || got.h !== r.h) { fs.rmSync(tmp, { force: true }); return `sips вырезал ${got.w}×${got.h} вместо ${r.w}×${r.h}`; }
  sips("-s", "format", "jpeg", "-s", "formatOptions", "70", "--resampleWidth", "1440", tmp, "--out", dst);
  fs.rmSync(tmp, { force: true });
  return null;
};
const mockFile = (mock, theme) => {
  const jpg = path.join(MOCKS, `${mock}-${theme}.jpg`);
  if (fs.existsSync(jpg)) return { file: jpg, k: dims(jpg).w / MOCK_WIDTH };
  const png = path.join(MOCKS_PNG, `${mock}-${theme}.png`);
  if (fs.existsSync(png)) return { file: png, k: dims(png).w / MOCK_WIDTH };
  return null;
};
const scaleRect = (r, k) => ({ x: Math.round(r.x * k), y: Math.round(r.y * k), w: Math.round(r.w * k), h: Math.round(r.h * k) });
const pick = (crop, theme) => (crop && crop.x === undefined ? crop[theme] : crop);

for (const dir of SHOTS) {
  const f = path.join(dir, "failed.txt");
  if (fs.existsSync(f) && fs.readFileSync(f, "utf8").trim()) problems.push(`${f}: съёмка оборвалась — ${fs.readFileSync(f, "utf8").trim().split("\n").join(" | ")}`);
}
fs.mkdirSync(OUT, { recursive: true });

for (const row of rows) {
  if (row.skip) { skipped.push(`${row.id}: ${row.skip}`); continue; }
  const zdir = path.join(OUT, row.zone);
  fs.mkdirSync(zdir, { recursive: true });
  if (row.honest === false) unfair.push(`${row.id}: ${row.notes}`);
  for (const theme of row.themes) {
    const entry = { row, theme, mock: null, app: null, error: null };
    const m = mockFile(row.mock, theme);
    if (!m) entry.error = `нет макета ${row.mock}-${theme}`;
    else {
      const mockOut = path.join(zdir, `${row.id}-${theme}-mock.jpg`);
      const e = cut(m.file, scaleRect(pick(row.mockCrop, theme), m.k), mockOut);
      if (e) entry.error = `макет: ${e}`; else entry.mock = path.relative(OUT, mockOut);
    }
    if (!row.scene) {
      if (row.missing) { if (theme === row.themes[0]) gaps.push(`${row.id}: ${row.missing}`); entry.error ??= `нет сцены: ${row.missing}`; }
      else entry.note = row.notes; // Z8 and the like: checked through other screens
    } else {
      const name = row.scene.file.replaceAll("{theme}", theme);
      const src = SHOTS.map((d) => path.join(d, name)).find((f) => fs.existsSync(f));
      if (!src) { problems.push(`${row.id} (${theme}): нет кадра ${name} (${row.scene.script})`); entry.error ??= `нет кадра ${name}`; }
      else {
        const appOut = path.join(zdir, `${row.id}-${theme}-app.jpg`);
        const e = cut(src, pick(row.appCrop, theme), appOut);
        if (e) { problems.push(`${row.id} (${theme}): ${name}: ${e}`); entry.error ??= e; } else entry.app = path.relative(OUT, appOut);
      }
    }
    if (entry.error && entry.error.startsWith("макет")) problems.push(`${row.id} (${theme}): ${entry.error}`);
    pairs.push(entry);
  }
}
if (flag("html")) {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const zones = [...new Set(pairs.map((p) => p.row.zone))].sort();
  const card = (p) => `<section${p.error ? ' class="bad"' : ""}><h3>${esc(p.row.id)} · ${esc(p.theme)} <small>${esc(p.row.scale)}${p.row.honest === false ? " · нет честного кадра" : ""}</small></h3>
<p>${esc(p.row.data)}${p.row.notes ? `<br><i>${esc(p.row.notes)}</i>` : ""}${p.error ? `<br><b>${esc(p.error)}</b>` : ""}</p>
<div class="pair"><figure>${p.mock ? `<img loading="lazy" src="${esc(p.mock)}">` : "—"}<figcaption>макет</figcaption></figure><figure>${p.app ? `<img loading="lazy" src="${esc(p.app)}">` : "—"}<figcaption>приложение</figcaption></figure></div></section>`;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Пары макет и приложение</title>
<style>:root{color-scheme:light dark;--bg:#f4f1ea;--fg:#2b2925;--mut:#6b665c;--line:#d8d2c4;--bad:#b3412e}
@media (prefers-color-scheme:dark){:root{--bg:#1f1d1a;--fg:#ece7dc;--mut:#a39d90;--line:#3a3631;--bad:#e58a74}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,system-ui,sans-serif}
nav a{margin-right:12px;color:inherit}h2{margin-top:32px;border-bottom:1px solid var(--line)}section{margin:16px 0 28px}section.bad h3{color:var(--bad)}
h3{margin:0 0 4px;font-size:15px}small,i{color:var(--mut);font-weight:400}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
figure{margin:0}img{width:100%;height:auto;border:1px solid var(--line)}figcaption{color:var(--mut);font-size:12px}
@media (max-width:700px){.pair{grid-template-columns:1fr}}</style></head><body>
<h1>Пары макет и приложение</h1><p>${rows.length} строк описи, ${pairs.filter((p) => p.mock && p.app).length} пар, проблем ${problems.length + gaps.length}</p>
<nav>${zones.map((z) => `<a href="#${z}">${z}</a>`).join("")}</nav>
${problems.length || gaps.length ? `<h2>Без кадра</h2><ul>${[...problems, ...gaps].map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
${zones.map((z) => `<h2 id="${z}">${z}</h2>${pairs.filter((p) => p.row.zone === z).map(card).join("\n")}`).join("\n")}
</body></html>`;
  fs.writeFileSync(path.join(OUT, "index.html"), html);
}

const ok = pairs.filter((p) => p.mock && p.app).length;
console.log(`строк ${rows.length} (заменено ${skipped.length}), пар ${ok}, без сцены ${gaps.length}, без кадра или с ошибкой ${problems.length}, нечестных кадров ${unfair.length}`);
for (const [title, list] of [["без кадра", problems], ["без сцены", gaps], ["нет честного кадра", unfair]])
  if (list.length) { console.log(`\n${title}:`); for (const x of list) console.log(`  ${x}`); }
process.exit(problems.length || gaps.length ? 1 : 0);
