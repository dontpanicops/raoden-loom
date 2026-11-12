// F-b settings fields: the command palette chord, the browser download folder, «Check for updates» (off by default).
// Added without a new settings version: a v16 file without them reads as the defaults (tests/r0-rollback.test.mjs: 1.5.20 reads them too).
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SettingsStore } from "../src/main/services/SettingsStore.ts";
import { matchesShortcut } from "../src/renderer/src/lib/shortcuts.ts";

const load = async (dir, file) => {
  if (file) await writeFile(join(dir, "settings.json"), JSON.stringify({ settingsVersion: 16, ...file }));
  const store = new SettingsStore(dir, "en");
  await store.load();
  return store;
};

test("defaults for a file without the fields: built-in palette chord, app's own download folder, updates off", async () => {
  const dir = await mkdtemp(join(tmpdir(), "settings-fb-"));
  try {
    const s = (await load(dir, {})).get();
    assert.equal(s.commandPaletteShortcut, null);
    assert.equal(s.browserDownloadDir, null);
    assert.equal(s.checkUpdates, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("saved values are kept, garbage is ignored, the version stays 16", async () => {
  const dir = await mkdtemp(join(tmpdir(), "settings-fb-"));
  try {
    const store = await load(dir, {});
    await store.update({ commandPaletteShortcut: "Alt+P", browserDownloadDir: "/Users/x/Files", checkUpdates: true });
    const again = (await load(dir)).get();
    assert.deepEqual([again.commandPaletteShortcut, again.browserDownloadDir, again.checkUpdates], ["Alt+P", "/Users/x/Files", true]);
    assert.equal(JSON.parse(await readFile(join(dir, "settings.json"), "utf8")).settingsVersion, 16);

    await store.update({ commandPaletteShortcut: "???", browserDownloadDir: "relative/dir", checkUpdates: "yes" });
    const kept = store.get();
    assert.deepEqual([kept.commandPaletteShortcut, kept.browserDownloadDir, kept.checkUpdates], ["Alt+P", "/Users/x/Files", true]);

    await store.update({ commandPaletteShortcut: null, browserDownloadDir: null });
    assert.deepEqual([store.get().commandPaletteShortcut, store.get().browserDownloadDir], [null, null]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the chosen chord is the one the keyboard handler matches", () => {
  const ev = (key, mods = {}) => ({ key, code: `Key${key.toUpperCase()}`, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });
  assert.equal(matchesShortcut(ev("p", { altKey: true }), "Alt+P"), true);
  assert.equal(matchesShortcut(ev("k", { metaKey: true }), "Alt+P"), false);
});
