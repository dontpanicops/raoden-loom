// R2 part 2b: the drawn curve of a link (automatic S / corridor / bend), the handle <-> bend round trip, the chip on the curve,
// and the CSS invariants (no backdrop-filter on links, the march stops under reduced motion).
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { arrowPath, bendFromHandle, linkGeometry, linkPath } from "../src/renderer/src/features/orchestration/linkCurve.ts";
import { chipOnCurve } from "../src/renderer/src/features/orchestration/linkChip.ts";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("automatic curve: S to the right, symmetric about the middle", () => {
  const g = linkGeometry({ x: 0, y: 0 }, { x: 400, y: 100 });
  close(g.mid.x, 200); close(g.mid.y, 50);
  assert.ok(g.c1.y === 0 && g.c2.y === 100 && g.c1.x > 0 && g.c2.x < 400);
  assert.match(linkPath(g), /^M 0 0 C /);
  assert.deepEqual(g.arrow, { x: 1, y: 0 });
});

test("executor left of the lead: the curve leaves right, enters from the left, passes between the cards vertically", () => {
  const g = linkGeometry({ x: 500, y: 0 }, { x: 100, y: 300 });
  assert.ok(g.c1.x > 500 && g.c2.x < 100);
  assert.ok(g.mid.y > 0 && g.mid.y < 300);
});

test("bend: the curve passes through (M+P)/2 and the handle round-trips to the same bend", () => {
  const f = { x: 0, y: 0 }, t = { x: 400, y: 0 }, bend = { along: 0.1, across: 0.5 };
  const g = linkGeometry(f, t, bend);
  const P = { x: 200 + 0.1 * 400, y: 0.5 * 400 };
  close(g.mid.x, (200 + P.x) / 2); close(g.mid.y, (0 + P.y) / 2);
  const back = bendFromHandle(f, t, g.mid);
  close(back.along, bend.along); close(back.across, bend.across);
});

test("strong bend: leaves right, enters from the left (arrow points right, not up/down), handle stays finite and round-trips continuously", () => {
  const f = { x: 0, y: 0 }, t = { x: 300, y: 120 };
  for (const bend of [{ along: 0, across: 2 }, { along: 0, across: -2 }, { along: 1.5, across: 1 }, { along: -1.5, across: -2 }]) {
    const g = linkGeometry(f, t, bend);
    assert.ok(g.c1.x >= f.x + 40 && g.c2.x <= t.x - 40, "control points keep a horizontal run at both ports");
    assert.ok(g.arrow.x > 0.4 && Math.abs(g.arrow.y) <= 2 * g.arrow.x + 1e-9, "arrow points rightwards into the left face");
    assert.ok(Object.values(g.mid).every(Number.isFinite));
  }
  const g = linkGeometry(f, t, { along: 0, across: 0.3 });
  assert.ok(g.arrow.x > 0.9);
});

test("degenerate ports and arrow path are finite", () => {
  const g = linkGeometry({ x: 5, y: 5 }, { x: 5, y: 5 }, { along: 0, across: 1 });
  assert.ok(Object.values(g.mid).every(Number.isFinite));
  assert.equal(bendFromHandle({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 9, y: 9 }), null);
  assert.ok(!/NaN/.test(arrowPath(linkGeometry({ x: 0, y: 0 }, { x: 300, y: 0 }), 12)));
});

test("chip: on the curve at t=0.5, shifts along t off a card, skips the handle when selected, never on a card if a t is free", () => {
  const size = { width: 40, height: 26 };
  const g = linkGeometry({ x: 0, y: 0 }, { x: 1000, y: 0 });
  const over = (c, r) => c.x - 20 < r.x + r.width && r.x < c.x + 20 && c.y - 13 < r.y + r.height && r.y < c.y + 13;
  const mid = chipOnCurve(g, [], size);
  close(mid.x, g.mid.x); close(mid.y, g.mid.y);
  const card = { x: g.mid.x - 10, y: g.mid.y - 30, width: 20, height: 60 };
  const moved = chipOnCurve(g, [card], size);
  assert.ok(!over(moved, card), "clear of the card");
  assert.ok(Math.abs(moved.x - g.mid.x) > 1, "moved along the curve");
  const sel = chipOnCurve(g, [], size, true);
  assert.ok(Math.abs(sel.x - g.mid.x) > 1, "not on the handle");
});

test("css: links without backdrop-filter, the dashed march stops under prefers-reduced-motion", () => {
  const css = fs.readFileSync(new URL("../src/renderer/src/styles/app.css", import.meta.url), "utf8");
  const rules = css.split("}").filter((r) => /\.agent-link/.test(r));
  assert.ok(rules.length > 5);
  assert.ok(!rules.some((r) => /backdrop-filter/.test(r)));
  assert.match(css, /\.agent-link--waiting \.agent-link__line[^}]*stroke: var\(--status-waiting\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.agent-link--waiting \.agent-link__line \{ animation: none; \} \}/);
});
