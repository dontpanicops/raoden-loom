// R2 (stage-r-redesign.md): the bend of a link. The data side: canvasStore.setLinkBend validates, resets and keeps the
// field across load/save and createLink; the geometry in src/shared/linkBend.ts is one formula for main and renderer.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createCanvasStore } from "../src/main/services/orchestration/canvasStore.ts";
import { bendCurve, bendFromPoint } from "../src/shared/linkBend.ts";

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "canvastty-bend-")));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const box = (x) => ({ position: { x, y: 0 }, size: { width: 300, height: 222 } });

async function withLink(name) {
  const file = path.join(TMP, `${name}.json`);
  const store = createCanvasStore(file);
  const lead = randomUUID(), exec = randomUUID(), linkId = randomUUID();
  await store.createAgent({ agentId: lead, provider: "codex", project: TMP, bounds: box(0), workspaceId: "common" });
  await store.createAgent({ agentId: exec, provider: "claude", project: TMP, bounds: box(500), workspaceId: "common" });
  await store.createLink({ linkId, fromAgentId: lead, toAgentId: exec });
  return { file, store, linkId, lead, exec };
}
const linkIn = async (store, linkId) => (await store.read(async () => true)).links.find((l) => l.linkId === linkId);

test("setLinkBend validates, saves, resets with null and refuses an unknown link", async () => {
  const { file, store, linkId } = await withLink("set");
  for (const bad of [{ along: NaN, across: 0 }, { along: 0, across: Infinity }, { along: 2.01, across: 0 }, { along: 0, across: -2.01 },
    { along: 0 }, { along: 0, across: 0, extra: 1 }, { along: "0", across: 0 }, [0, 0], 5, "x", undefined]) {
    await assert.rejects(store.setLinkBend(linkId, bad), (e) => e.code === "invalid_argument", JSON.stringify(bad));
  }
  assert.equal((await linkIn(store, linkId)).bend, undefined, "nothing was written");
  await assert.rejects(store.setLinkBend(randomUUID(), { along: 0, across: 0 }), (e) => e.code === "link_not_found");

  const set = await store.setLinkBend(linkId, { along: -2, across: 2 });
  assert.deepEqual(set.bend, { along: -2, across: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).links[0].bend, { along: -2, across: 2 });
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).v, 1, "the format version does not change");

  const reset = await store.setLinkBend(linkId, null);
  assert.equal("bend" in reset, false);
  assert.equal("bend" in JSON.parse(fs.readFileSync(file, "utf8")).links[0], false, "the field is removed, not nulled");
});

test("createLink again with the same linkId does not touch the bend", async () => {
  const { store, linkId, lead, exec } = await withLink("again");
  await store.setLinkBend(linkId, { along: 0.25, across: -0.5 });
  const same = await store.createLink({ linkId, fromAgentId: lead, toAgentId: exec });
  assert.deepEqual(same.bend, { along: 0.25, across: -0.5 });
  assert.deepEqual((await linkIn(store, linkId)).bend, { along: 0.25, across: -0.5 });
});

test("a canvas file without bend is read; load then save keeps a bend, also when another link changes", async () => {
  const { file, store, linkId, lead, exec } = await withLink("roundtrip");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal("bend" in raw.links[0], false);
  assert.equal((await createCanvasStore(file).read(async () => true)).links.length, 1, "no bend reads fine");

  await store.setLinkBend(linkId, { along: 0.1, across: 0.7 });
  const fresh = createCanvasStore(file); // a restart
  await fresh.moveAgent(lead, box(40)); // any save
  assert.deepEqual((await linkIn(fresh, linkId)).bend, { along: 0.1, across: 0.7 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).links[0].bend, { along: 0.1, across: 0.7 });

  // a link of another version with a bend this one never wrote is kept as it was
  raw.links[0].bend = { along: 1, across: 1 };
  fs.writeFileSync(file, JSON.stringify(raw));
  const third = createCanvasStore(file);
  await third.moveAgent(exec, box(520));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).links[0].bend, { along: 1, across: 1 });
});

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("bend geometry: zero bend puts P in the middle, across follows n = (-dy, dx)/|d| with y down", () => {
  const f = { x: 0, y: 0 }, t = { x: 100, y: 0 };
  const flat = bendCurve(f, t, { along: 0, across: 0 });
  assert.deepEqual(flat.p, { x: 50, y: 0 });
  near(flat.c1.x, 100 / 3); near(flat.c2.x, 200 / 3); // the straight line's thirds
  const down = bendCurve(f, t, { along: 0, across: 0.5 }); // d = (100, 0): n = (0, 1), i.e. down on screen
  near(down.p.x, 50); near(down.p.y, 50);
  near(down.c1.y, 100 / 3); near(down.c2.y, 100 / 3);
  const along = bendCurve(f, t, { along: 0.25, across: 0 });
  near(along.p.x, 75);
  const diag = bendCurve({ x: 0, y: 0 }, { x: 0, y: 100 }, { along: 0, across: 1 }); // d = (0, 100): n = (-1, 0)
  near(diag.p.x, -100); near(diag.p.y, 50);
});

test("bend geometry: no bend, or ports under 1px apart, give no curve", () => {
  assert.equal(bendCurve({ x: 0, y: 0 }, { x: 100, y: 0 }, null), null);
  assert.equal(bendCurve({ x: 0, y: 0 }, { x: 100, y: 0 }, undefined), null);
  assert.equal(bendCurve({ x: 5, y: 5 }, { x: 5.5, y: 5.5 }, { along: 0, across: 1 }), null);
  assert.equal(bendFromPoint({ x: 5, y: 5 }, { x: 5.5, y: 5 }, { x: 0, y: 0 }), null);
  assert.notEqual(bendCurve({ x: 0, y: 0 }, { x: 1, y: 0 }, { along: 0, across: 1 }), null, "exactly 1px still bends");
});

test("bendFromPoint is the inverse of bendCurve's P and clamps to [-2, 2]", () => {
  const f = { x: 10, y: -20 }, t = { x: 310, y: 140 };
  for (const b of [{ along: 0, across: 0 }, { along: 0.3, across: -0.8 }, { along: -1.5, across: 1.9 }, { along: 2, across: -2 }]) {
    const back = bendFromPoint(f, t, bendCurve(f, t, b).p);
    near(back.along, b.along); near(back.across, b.across);
  }
  assert.deepEqual(bendFromPoint(f, t, { x: 1e6, y: 1e6 }).across <= 2 && bendFromPoint(f, t, { x: -1e6, y: -1e6 }).across >= -2, true);
  const far = bendFromPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 5000, y: -5000 });
  assert.deepEqual(far, { along: 2, across: -2 });
});
