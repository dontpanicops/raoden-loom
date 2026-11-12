import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dialogPath = new URL("../src/renderer/src/features/launcher/AgentLaunchDialog.tsx", import.meta.url);

test("agent launcher takes a pasted project path through the clipboard clean-up", async () => {
  const source = await readFile(dialogPath, "utf8");

  assert.match(source, /directoryPathFromClipboard\(event\.clipboardData\.getData\("text\/plain"\)\)/);
  assert.match(source, /onPaste=\{pastePath\}/);
});

test("R5e: a popover at the dock button, a dialog elsewhere; YOLO needs a tick that is not remembered; a missing CLI has its own card", async () => {
  const [source, dialog, styles] = await Promise.all([
    readFile(dialogPath, "utf8"),
    readFile(new URL("../src/renderer/src/components/Dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/src/styles/app.css", import.meta.url), "utf8")
  ]);
  assert.match(source, /anchor=\{anchor\}/);
  assert.match(dialog, /if \(anchor\) return createPortal\(card, host\);/); // no .dialog-backdrop around a popover
  assert.match(dialog, /className=\{`dialog-backdrop /); // the class every smoke relies on stays
  assert.match(dialog, /key === "Escape"/);
  assert.match(source, /disabled=\{busy \|\| \(yolo && !understood\)\}/);
  assert.doesNotMatch(source, /onAcknowledge/);
  assert.match(source, /data-launch-missing/);
  assert.match(source, /installUrl\(locale\)/);
  assert.match(source, /providers\.available\(\)/);
  assert.doesNotMatch(styles, /\.dialog-backdrop[^{]*\{[^}]*backdrop-filter/); // В-7: no blur behind a form
});
