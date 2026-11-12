// scripts/conformance-pairs.mjs: a crop at offset 0 0 takes the top-left corner (macOS sips centres it), and scene.dpr scales appCrop.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

const crc = (buf) => { let c, t = [], r = ~0; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } for (const b of buf) r = t[(r ^ b) & 255] ^ (r >>> 8); return ~r >>> 0; };
const chunk = (type, data) => { const b = Buffer.concat([Buffer.from(type), data]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([len, b, c]); };
// W x H PNG: the left quarter (x < W / 4) red, the rest blue
const png = (W, H) => {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = x < W / 4 ? 255 : 0; raw[o + 2] = x < W / 4 ? 0 : 255; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};
// the colour of the middle pixel of a JPEG (through a BMP)
const middle = (jpg, dir) => {
  const bmp = path.join(dir, "m.bmp");
  execFileSync("sips", ["-s", "format", "bmp", jpg, "--out", bmp]);
  const b = fs.readFileSync(bmp), w = b.readInt32LE(18), h = Math.abs(b.readInt32LE(22)), bpp = b.readUInt16LE(28) / 8, row = Math.ceil(w * bpp / 4) * 4;
  const o = b.readUInt32LE(10) + Math.floor(h / 2) * row + Math.floor(w / 2) * bpp;
  return { r: b[o + 2], b: b[o] };
};

test("crop at 0 0 is the top-left corner; dpr scales appCrop", { skip: process.platform !== "darwin" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cpairs-"));
  try {
    const shots = path.join(dir, "shots"), mocks = path.join(dir, "mocks");
    fs.mkdirSync(shots); fs.mkdirSync(mocks);
    fs.writeFileSync(path.join(shots, "sand-a.png"), png(400, 200));
    fs.writeFileSync(path.join(mocks, "m-sand.png"), png(2880, 1800));
    const row = (id, appCrop, dpr) => ({ id, zone: "Z0", mock: "m", themes: ["sand"], mockCrop: { x: 0, y: 0, w: 100, h: 60 }, scene: { script: "s", file: "{theme}-a.png", ...(dpr ? { dpr } : {}) }, appCrop, scale: "", data: "", notes: "" });
    // 0 0 crop of 80 x 40: the left quarter is 100 px wide, so the whole crop is red; a centre crop would be blue
    // dpr 2: the CSS crop 0 0 20 x 20 is 40 x 40 frame pixels, still red
    fs.writeFileSync(path.join(dir, "inv.json"), JSON.stringify({ rows: [row("corner", { x: 0, y: 0, w: 80, h: 40 }), row("dpr", { x: 0, y: 0, w: 20, h: 20 }, 2)] }));
    execFileSync("node", ["scripts/conformance-pairs.mjs", "--inventory", path.join(dir, "inv.json"), "--shots", shots, "--out", path.join(dir, "out"), "--mocks", path.join(dir, "none"), "--mocks-png", mocks]);
    for (const id of ["corner", "dpr"]) {
      const c = middle(path.join(dir, "out/Z0", `${id}-sand-app.jpg`), dir);
      assert.ok(c.r > 200 && c.b < 60, `${id}: red expected, got ${JSON.stringify(c)}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
