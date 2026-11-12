// Settings → Browser → Downloads: a chosen folder takes over the saves of the browser card; files in it can be sent as before.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrowserPolicyService } from "../src/main/services/browser/BrowserPolicyService.ts";

test("downloads land in the chosen folder, and uploads are allowed from it, not from the old one", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "browser-dl-")));
  try {
    const oldRoot = join(base, "old");
    const chosen = join(base, "chosen");
    await mkdir(oldRoot);
    await mkdir(chosen);
    const policy = new BrowserPolicyService({ downloadRoot: oldRoot, uploadRoots: [oldRoot], uploadStagingRoot: join(base, "staging") });
    assert.equal(policy.resolveDownloadPath("a1", "x.txt"), join(oldRoot, "a1-x.txt"));

    policy.setDownloadRoot(chosen);
    assert.equal(policy.resolveDownloadPath("a2", "y.txt"), join(chosen, "a2-y.txt"));
    assert.equal(policy.resolveDownloadPath("a3", "../../escape.txt").startsWith(chosen), true); // names stay inside

    await writeFile(join(chosen, "a2-y.txt"), "y"); // saved by the browser: may be sent
    await writeFile(join(chosen, "other.txt"), "o"); // just lying in the chosen folder: may not
    await writeFile(join(oldRoot, "a1-x.txt"), "x");
    assert.equal((await policy.validateUploadPaths([join(chosen, "a2-y.txt")])).length, 1);
    await assert.rejects(policy.validateUploadPaths([join(chosen, "other.txt")]), /outside authorized/);
    assert.equal((await policy.validateUploadPaths([join(oldRoot, "a1-x.txt")])).length, 1); // the session folder as before

    policy.setDownloadRoot(oldRoot); // back to the app's own folder
    assert.equal(policy.resolveDownloadPath("a4", "z.txt"), join(oldRoot, "a4-z.txt"));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("a wide download folder (home) does not open its files to uploads", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "browser-dl-")));
  try {
    const home = join(base, "home");
    await mkdir(home);
    await writeFile(join(home, "secret.txt"), "s");
    const policy = new BrowserPolicyService({ downloadRoot: join(base, "session"), uploadStagingRoot: join(base, "staging") });
    policy.setDownloadRoot(home);
    await assert.rejects(policy.validateUploadPaths([join(home, "secret.txt")]));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("too wide download folders are refused", async () => {
  const { isTooBroadDownloadFolder: broad } = await import("../src/shared/downloadFolder.ts");
  for (const p of ["/", "/Users", "/Users/dm", "/Users/dm/", "/home/dm", "/System/Library", "/usr/local", "/etc", "/Applications"]) assert.equal(broad(p), true, p);
  assert.equal(broad("/srv/me", "/srv/me"), true);
  for (const p of ["/Users/dm/Files", "/Users/dm/Downloads/CanvasTTY", "/Volumes/Disk/dl", "/private/tmp/x", "/private/var/folders/a/b"]) assert.equal(broad(p, "/Users/dm"), false, p);
}
);
