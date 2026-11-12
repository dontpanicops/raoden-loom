// Settings → Notifications: «Banner in the app» and «System notification» really switch the two channels.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_NOTIFY_PREFS, noteChannel } from "../src/renderer/src/features/orchestration/notify.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsStore } from "../src/main/services/SettingsStore.ts";

test("both channels are on by default, as the app behaved before the switches", () => {
  assert.equal(DEFAULT_NOTIFY_PREFS.banner, true);
  assert.equal(DEFAULT_NOTIFY_PREFS.system, true);
  assert.equal(noteChannel(DEFAULT_NOTIFY_PREFS, false), "system");
  assert.equal(noteChannel(DEFAULT_NOTIFY_PREFS, true), "banner"); // macOS refused: the banner
});

test("each switch turns its channel off", () => {
  const P = DEFAULT_NOTIFY_PREFS;
  assert.equal(noteChannel({ ...P, system: false }, false), "banner");
  assert.equal(noteChannel({ ...P, banner: false }, false), "system");
  assert.equal(noteChannel({ ...P, banner: false }, true), null);
  assert.equal(noteChannel({ ...P, system: false, banner: false }, false), null);
});

test("a settings file without the two fields reads as on; saved values are kept", async () => {
  const dir = await mkdtemp(join(tmpdir(), "notify-channels-"));
  try {
    await writeFile(join(dir, "settings.json"), JSON.stringify({ settingsVersion: 16, notifications: { waiting: false } }));
    const store = new SettingsStore(dir, "en");
    await store.load();
    assert.deepEqual([store.get().notifications.banner, store.get().notifications.system, store.get().notifications.waiting], [true, true, false]);
    await store.update({ notifications: { ...store.get().notifications, banner: false, system: false } });
    const again = new SettingsStore(dir, "en");
    await again.load();
    assert.deepEqual([again.get().notifications.banner, again.get().notifications.system], [false, false]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
