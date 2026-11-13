// R5g: the settings screen follows the mock-up, the settings file does not change.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SettingsStore } from "../src/main/services/SettingsStore.ts";

const read = (path) => readFile(new URL(`../src/renderer/src/${path}`, import.meta.url), "utf8");

test("settings.json keeps the same set of keys (the UI redo does not touch the format)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "r5g-keys-"));
  try {
    const keys = Object.keys(await new SettingsStore(dir, "en").load()).sort();
    assert.deepEqual(keys, KEYS);
    const notifications = Object.keys((await new SettingsStore(dir, "en").load()).notifications).sort();
    assert.deepEqual(notifications, ["banner", "board", "boardHead", "bounce", "completed", "dockBadge", "failed", "system", "waiting"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Switch is a button with role=switch and aria-checked; a toggle flips the value", async () => {
  const src = await read("components/Switch.tsx");
  assert.match(src, /type="button"/);
  assert.match(src, /role="switch"/);
  assert.match(src, /aria-checked=\{checked\}/);
  assert.match(src, /aria-label=\{label\}/);
  assert.match(src, /onClick=\{\(\) => onChange\(!checked\)\}/);
});

test("boolean settings use the Switch, the segment stays for three and more choices", async () => {
  const panel = await read("features/settings/SettingsPanel.tsx");
  assert.doesNotMatch(panel, /\["on", t\(locale, "on"\)\]/);
  assert.doesNotMatch(panel, /\["off", t\(locale, "notifyOff"\)\]/);
  assert.match(panel, /<Switch /);
  assert.match(panel, /\["off", t\(locale, "focusActivationOff"\)\]/);
  assert.match(await read("features/settings/AgentHooksSettings.tsx"), /<Switch/);
});

test("the settings texts say «холст», not «канвас», and «О программе»", async () => {
  const i18n = await read("lib/i18n.ts");
  const ru = i18n.slice(0, i18n.indexOf("const en:"));
  for (const key of ["canvasColor", "canvasPattern", "canvasLauncherItems", "canvasLauncherItemsDescription", "snapToGrid", "uiScaleDescription", "canvasWheelCaptureDescription"]) {
    const line = ru.split("\n").find((l) => l.startsWith(`  ${key}:`));
    assert.ok(line, key);
    assert.doesNotMatch(line, /[Кк]анвас|Canvas/u, key);
  }
  assert.match(ru, /\n  about: "О программе"/);
});

test("About links point at the repository: releases, LICENSE, issues", async () => {
  const about = await read("features/settings/AboutSettings.tsx");
  assert.match(about, /dontpanicops\/raoden-loom/);
  for (const path of ["/releases", "/blob/main/LICENSE", "/issues"]) assert.ok(about.includes(path), path);
  assert.match(about, /appManifest\.version/);
});

test("Even G2 stays in «Controls» as a collapsible block at the end (D-012)", async () => {
  const panel = await read("features/settings/SettingsPanel.tsx");
  const controls = panel.slice(panel.indexOf('section === "controls"'), panel.indexOf('section === "browser"'));
  assert.match(controls, /<details className="settings-fold"[^>]*>\s*<summary>Even G2<\/summary>\s*<EvenG2Controls/);
  assert.ok(controls.indexOf("settings-fold") > controls.indexOf("canvasWheelDirection"));
});

const KEYS = ["acknowledgedDangerousProfiles","agentLifecycleHooksEnabled","browserAgentAccess","browserCanvas","browserDownloadDir","browserRestoreTabs","browserShowAgentPresence","canvasColor","canvasControlsPlacement","canvasLauncherItems","canvasMenuStyle","canvasNavigationOverride","canvasRegions","canvasWheelCaptureMode","canvasWheelOverride","checkUpdates","commandPaletteShortcut","edgePan","edgePanSpeed","focusActivation","followSystem","homeAccentColors","homeAccentPreset","homeGridSize","homeLauncherProviders","homeLayout","homeLimitProviders","hoverFocus","hoverFocusSpeed","invertCanvasWheel","invertTerminalWheel","lastDirectory","locale","mediaFit","mediaPath","minimapInteractionMode","minimapPlacement","notifications","onboardingDismissed","palette","pattern","persistCanvasRegions","persistStickyNotes","pluginCanvas","radialLauncherEnabled","radialLauncherItems","reduceTransparency","restoreTerminalSessions","sessionRowColorMode","shortcutHintsPlacement","shortcuts","showShortcutHints","snapToGrid","stickyNotes","uiScale","useScrollWheelToZoom","zoomSensitivity"];
