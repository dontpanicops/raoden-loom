// F-a (SPEC 11.7, D-041): the workspace label is an optional field 1..5: kept across a restart, cleared by null, never on the
// common canvas, and a file without it (1.5.20) or with a strange value stays readable.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { COMMON_WORKSPACE_ID } from "../src/shared/contracts.ts";
import { migrateWorkspaces, WORKSPACES_FILE, WorkspaceStore } from "../src/main/services/WorkspaceStore.ts";

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "canvastty-wslabel-")));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let n = 0;
const open = async (dir) => {
  const m = await migrateWorkspaces(dir);
  return new WorkspaceStore(dir, m, async () => ({ cards: 0, runs: 0 }));
};
const fresh = () => { const d = path.join(TMP, `ud-${++n}`); fs.mkdirSync(d); return d; };

test("a label is set on create, changed and cleared on update, and survives a restart", async () => {
  const dir = fresh();
  const store = await open(dir);
  const created = await store.create({ title: "Alpha", root: null, label: 2 });
  assert.equal(created.ok, true);
  const id = created.value.workspaces.find((w) => w.title === "Alpha").id;
  assert.equal(created.value.workspaces.find((w) => w.id === id).label, 2);
  await store.update(id, { label: 5 });
  assert.equal((await open(dir)).get().workspaces.find((w) => w.id === id).label, 5);
  const cleared = await store.update(id, { label: null });
  assert.equal("label" in cleared.value.workspaces.find((w) => w.id === id), false);
  assert.equal("label" in JSON.parse(fs.readFileSync(path.join(dir, WORKSPACES_FILE), "utf8")).workspaces.find((w) => w.id === id), false);
});

test("a label outside 1..5 is refused; the common canvas never gets one; a title-only update keeps the label", async () => {
  const store = await open(fresh());
  const id = (await store.create({ title: "B", root: null, label: 3 })).value.workspaces.find((w) => w.title === "B").id;
  for (const bad of [0, 6, 1.5, "2"]) assert.equal((await store.update(id, { label: bad })).ok, false);
  assert.equal((await store.update(id, { title: "B2" })).value.workspaces.find((w) => w.id === id).label, 3);
  const common = await store.update(COMMON_WORKSPACE_ID, { label: 1 });
  assert.equal("label" in common.value.workspaces.find((w) => w.id === COMMON_WORKSPACE_ID), false);
  assert.equal("label" in (await store.create({ title: "C", root: null, label: 9 })).value.workspaces.find((w) => w.title === "C"), false);
});

test("a file of 1.5.20 (no label) loads; a strange label value is dropped without calling the file damaged", async () => {
  const dir = fresh();
  const rec = (id, extra) => ({ id, title: id, root: null, createdAt: "2026-01-01T00:00:00Z", closed: false, camera: null, ...extra });
  fs.writeFileSync(path.join(dir, WORKSPACES_FILE), JSON.stringify({ v: 1, activeId: "common", workspaces: [rec("common", { label: 3 }), rec("a", {}), rec("b", { label: 4 }), rec("c", { label: 99 })] }));
  const m = await migrateWorkspaces(dir);
  assert.equal(m.error, null);
  const byId = Object.fromEntries(m.state.workspaces.map((w) => [w.id, w]));
  assert.equal(byId.a.label, undefined);
  assert.equal(byId.b.label, 4);
  assert.equal(byId.c.label, undefined);
  assert.equal(byId.common.label, undefined);
  assert.equal(fs.readdirSync(dir).some((f) => f.includes("damaged")), false);
});
