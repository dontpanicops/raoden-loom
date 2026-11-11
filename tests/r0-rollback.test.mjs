// R0 (docs/ux-audit/2026-11-10/stage-r-redesign.md, R0.3): the v1.5.20 normalizer reads a v16 settings file with the
// default look (sage / sage / classic) and changes nothing else. The old build comes from git (git archive), offline.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { SettingsStore } from "../src/main/services/SettingsStore.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAG = "v1.5.20";
const present = (() => {
  try { execFileSync("git", ["-C", REPO, "cat-file", "-e", `${TAG}^{commit}`], { stdio: "ignore" }); return true; } catch { return false; }
})();

test("R0: the v1.5.20 build reads a v16 file with default look, everything else kept", { skip: !present && `${TAG} is not in this clone` }, async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "canvastty-r0-rollback-")));
  try {
    const old = path.join(tmp, "old-build");
    fs.mkdirSync(old);
    execFileSync("sh", ["-c", `git -C "$1" archive "$2" src | tar -x -C "$3"`, "sh", REPO, TAG, old]);
    const Old = await import(pathToFileURL(path.join(old, "src/main/services/SettingsStore.ts")).href);

    const dir = path.join(tmp, "new");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({
      settingsVersion: 15, palette: "lilac", canvasColor: "sage", homeAccentPreset: "classic",
      homeLauncherProviders: ["codex", "claude"], shortcuts: { home: "Cmd+H", renameWindow: "F3" },
      homeLayout: [{ id: "clock", column: 1, row: 1, columns: 3, rows: 2 }],
      canvasRegions: [{ id: "r", title: "R", color: "#112233", position: { x: 11, y: 12 }, size: { width: 401, height: 301 } }],
      stickyNotes: [{ id: "n", text: "t", position: { x: 21, y: 22 }, size: { width: 302, height: 222 } }]
    }));
    const s = new SettingsStore(dir, "en"); await s.load();
    await s.update({ palette: "paper", canvasColor: "linen", homeAccentPreset: "dusk", reduceTransparency: true });
    const written = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));
    assert.equal(written.settingsVersion, 16);

    const readOld = async (value) => {
      const d = fs.mkdtempSync(path.join(tmp, "old-"));
      fs.writeFileSync(path.join(d, "settings.json"), JSON.stringify(value));
      const o = new Old.SettingsStore(d, "en"); await o.load(); return o.get();
    };
    const a = await readOld(written);
    assert.deepEqual([a.palette, a.canvasColor, a.homeAccentPreset], ["sage", "sage", "classic"]);
    const b = await readOld({ ...written, palette: "sage", canvasColor: "sage", homeAccentPreset: "classic", reduceTransparency: undefined });
    assert.deepEqual(a, b, "only the look differs; agents, HOME layout, regions, notes and shortcuts are as written");
    const kept = ["homeLauncherProviders", "shortcuts", "homeLayout", "canvasRegions", "stickyNotes"];
    for (const k of kept) assert.deepEqual(a[k], written[k], k);

    // R4a: paper + followSystem -> the old build shows sage and drops the unknown field; the way back restores paper
    const c = await s.update({ palette: "paper", followSystem: true });
    assert.equal(c.followSystem, true);
    const writtenC = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));
    assert.equal(writtenC.followSystem, true);
    assert.equal(writtenC.settingsVersion, 16);
    const oldC = await readOld(writtenC);
    assert.equal(oldC.palette, "sage");
    assert.equal("followSystem" in oldC, false, "the 1.5.20 normalizer drops the field");
    const oldD = await readOld({ ...writtenC, palette: "sage", followSystem: undefined });
    assert.deepEqual(oldC, oldD, "nothing else changes");
    const back = new SettingsStore(dir, "en"); await back.load();
    assert.deepEqual([back.get().palette, back.get().followSystem], ["paper", true], "the return to the new build keeps paper");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
