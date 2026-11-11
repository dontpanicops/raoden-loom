import assert from "node:assert/strict";
import test from "node:test";
import { earlyTheme, windowBackground } from "../src/shared/appearance.ts";

const raw = (o) => JSON.stringify(o);

test("early theme: no file, broken JSON, junk -> dark default", () => {
  for (const text of [null, "", "{", "[]", "null", "42", raw({ palette: 5 }), raw({ palette: "constructor" }), raw({ palette: "__proto__" })]) {
    assert.equal(earlyTheme(text, true), "sand", String(text));
    assert.equal(windowBackground(earlyTheme(text, true)), "#24221E");
  }
});

test("early theme: new and old ids, followSystem", () => {
  assert.equal(earlyTheme(raw({ palette: "paper" }), true), "paper");
  assert.equal(earlyTheme(raw({ palette: "frost" }), true), "frost");
  assert.equal(windowBackground(earlyTheme(raw({ palette: "paper" }), true)), "#EDE9E1");
  assert.equal(windowBackground(earlyTheme(raw({ palette: "frost" }), false)), "#E8EDF5");
  assert.equal(earlyTheme(raw({ palette: "night" }), false), "bay");
  assert.equal(earlyTheme(raw({ palette: "lilac" }), false), "bay");
  assert.equal(earlyTheme(raw({ palette: "sage" }), false), "sand");
  assert.equal(earlyTheme(raw({ palette: "bay", followSystem: true }), false), "paper");
  assert.equal(earlyTheme(raw({ palette: "bay", followSystem: true }), true), "sand");
  assert.equal(earlyTheme(raw({ palette: "bay", followSystem: "true" }), false), "bay");
});
