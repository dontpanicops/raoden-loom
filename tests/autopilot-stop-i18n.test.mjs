import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const board = readFileSync(new URL("../src/shared/taskBoard.ts", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/renderer/src/lib/i18n.ts", import.meta.url), "utf8");
const en = source.indexOf("\nconst en:");
const list = board.match(/export const AUTOPILOT_STOP_CODES = \[([^\]]+)\] as const/);

test("every autopilot stop code has a label in Russian and English", () => {
  assert.ok(list && en > 0);
  const codes = [...list[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
  assert.equal(codes.length, 23);
  for (const code of codes) {
    const at = [...source.matchAll(new RegExp(`\\n\\s+boardApStop_${code}: "[^"]+"`, "g"))].map((m) => m.index);
    assert.equal(at.filter((i) => i < en).length, 1, `${code} in ru`);
    assert.equal(at.filter((i) => i > en).length, 1, `${code} in en`);
  }
});

test("the waiting chip has a label for each wait", () => {
  for (const w of ["run", "person", "external", "provider_limit"]) {
    assert.ok(source.includes(`boardApWaits_${w}:`), w);
  }
});
