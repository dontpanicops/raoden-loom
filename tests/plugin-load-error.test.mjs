import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PluginManager } from "../src/main/services/PluginManager.ts";

test("a plugin whose package cannot be read stays listed with the reason, off, and can be removed", async () => {
  const userData = await mkdtemp(join(tmpdir(), "canvastty-plugin-broken-"));
  const fixture = new URL("../examples/plugins/studio-kit/", import.meta.url);
  const manager = new PluginManager(userData, async (_url, destination) => {
    await cp(fixture, destination, { recursive: true });
  });
  try {
    await manager.load();
    const installed = await manager.install((await manager.previewInstall("https://github.com/example/studio-kit")).token);
    await manager.dispose();
    await writeFile(join(userData, "plugins", installed.manifest.id, "canvastty.plugin.json"), "{ not json");
    const reloaded = new PluginManager(userData);
    const [row] = await reloaded.load();
    assert.equal(row.manifest.id, installed.manifest.id);
    assert.equal(row.enabled, false);
    assert.ok(row.loadError && !row.loadError.includes("\n"));
    await assert.rejects(reloaded.setEnabled(installed.manifest.id, true), /could not be loaded/);
    await reloaded.dispose();
    // kept in the registry across another start
    const again = new PluginManager(userData);
    assert.equal((await again.load())[0].loadError, row.loadError);
    await again.uninstall(installed.manifest.id);
    assert.deepEqual(again.list(), []);
    await again.dispose();
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("a manifest that parses but fails validation keeps its own name and version on the row", async () => {
  const userData = await mkdtemp(join(tmpdir(), "canvastty-plugin-broken-"));
  const fixture = new URL("../examples/plugins/studio-kit/", import.meta.url);
  const manager = new PluginManager(userData, async (_url, destination) => {
    await cp(fixture, destination, { recursive: true });
  });
  try {
    await manager.load();
    const installed = await manager.install((await manager.previewInstall("https://github.com/example/studio-kit")).token);
    await manager.dispose();
    const file = join(userData, "plugins", installed.manifest.id, "canvastty.plugin.json");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.contributions[0].kind = "panel";
    await writeFile(file, JSON.stringify(manifest));
    const [row] = await new PluginManager(userData).load();
    assert.equal(row.manifest.name, installed.manifest.name);
    assert.equal(row.manifest.version, installed.manifest.version);
    assert.match(row.loadError, /panel/);
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("D-043: the reason a plugin did not load is said in the interface's language; the raw line is not shown as is", async () => {
  const { pluginLoadReason } = await import("../src/renderer/src/features/plugins/pluginLoadReason.ts");
  assert.equal(pluginLoadReason("ru", "Unknown plugin contribution kind: panel."), "canvastty.plugin.json — тип вклада «panel» эта версия не знает");
  assert.match(pluginLoadReason("en", "Unknown plugin contribution kind: panel."), /does not know the contribution kind «panel»/);
  assert.equal(pluginLoadReason("ru", "Expected property name or '}' in JSON at position 2 (line 1 column 3)"), "canvastty.plugin.json — не JSON");
  assert.equal(pluginLoadReason("ru", "canvastty.plugin.json is missing or too large."), "нет canvastty.plugin.json или он слишком большой");
  assert.equal(pluginLoadReason("ru", "Contribution entry must be an HTML file."), "манифест плагина не прошёл проверку");
  for (const locale of ["ru", "en"]) assert.doesNotMatch(pluginLoadReason(locale, "Unknown plugin contribution kind: panel."), /Unknown/);
});
