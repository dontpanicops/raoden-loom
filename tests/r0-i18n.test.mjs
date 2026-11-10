import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/renderer/src/lib/i18n.ts", import.meta.url), "utf8");
const en = source.indexOf("\nconst en:");

test("the R0 appearance labels exist in Russian and English", () => {
  assert.ok(en > 0);
  for (const key of ["themeSand", "themeBay", "reduceTransparency", "reduceTransparencyDescription", "homePresetTheme",
    "homePresetPastel", "homePresetDusk", "canvasColorTheme", "canvasColorStone", "canvasColorLinen", "canvasColorGraphite"]) {
    const line = new RegExp(`\\n\\s+${key}: "[^"]+"`, "g");
    const at = [...source.matchAll(line)].map((m) => m.index);
    assert.equal(at.filter((i) => i < en).length, 1, `${key} in ru`);
    assert.equal(at.filter((i) => i > en).length, 1, `${key} in en`);
  }
});
