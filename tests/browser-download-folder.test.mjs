// Settings → Browser → Downloads: a chosen folder takes over the saves of the browser card; files in it can be sent as before.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
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
    await policy.downloadCompleted(join(chosen, "a2-y.txt"));
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

test("security review L5: a saved file may be sent only once complete and only as itself — not a link or another file put in its place", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "browser-dl-")));
  try {
    const chosen = join(base, "chosen");
    await mkdir(chosen);
    await writeFile(join(base, "secret.txt"), "s");
    const policy = new BrowserPolicyService({ downloadRoot: join(base, "session"), uploadStagingRoot: join(base, "staging") });
    policy.setDownloadRoot(chosen);
    // not complete yet: no upload right
    const a = policy.resolveDownloadPath("a1", "a.txt");
    await writeFile(a, "a");
    await assert.rejects(policy.validateUploadPaths([a]), /outside authorized|No upload directory/);
    await policy.downloadCompleted(a);
    assert.equal((await policy.validateUploadPaths([a])).length, 1);
    // replaced by a link to another file after the download: refused
    await rm(a);
    await symlink(join(base, "secret.txt"), a);
    await assert.rejects(policy.validateUploadPaths([a]), /outside authorized/);
    // replaced by another file of the same name: refused
    await rm(a);
    await writeFile(join(base, "other"), "o");
    await rename(join(base, "other"), a);
    await assert.rejects(policy.validateUploadPaths([a]), /outside authorized/);
    // a link that was there when the download completed is not taken either
    const b = policy.resolveDownloadPath("b1", "b.txt");
    await symlink(join(base, "secret.txt"), b);
    await policy.downloadCompleted(b);
    await assert.rejects(policy.validateUploadPaths([join(base, "secret.txt")]), /outside authorized/);
    await assert.rejects(policy.validateUploadPaths([b]), /outside authorized/);
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

test("security review L4: ~/Library and hidden folders of the home are refused — a saved file there runs at the next login or shell", async () => {
  const { isTooBroadDownloadFolder: broad } = await import("../src/shared/downloadFolder.ts");
  const bad = ["/Users/dm/Library", "/Users/dm/Library/LaunchAgents", "/Users/dm/library/Application Support/x", "/Users/dm/.config/fish/conf.d",
    "/Users/dm/.ssh", "/Users/dm/projects/app/.git/hooks", "/Users/dm/.zshrc.d"];
  for (const p of bad) {
    assert.equal(broad(p, "/Users/dm"), true, `main: ${p}`);
    assert.equal(broad(p), true, `window: ${p}`);
  }
  for (const p of ["/Users/dm/Downloads", "/Users/dm/Documents/Library of mine", "/Users/dm/Desktop/dl", "/Users/dm/my.files"]) {
    assert.equal(broad(p, "/Users/dm"), false, p);
    assert.equal(broad(p), false, p);
  }
});

test("the too-wide check sees through dots, doubled slashes and letter case", async () => {
  const { isTooBroadDownloadFolder } = await import("../src/shared/downloadFolder.ts");
  for (const folder of ["//Users", "/USERS/", "/Users/me/x/..", "/./System/Library", "/users/me/./", "/ETC"]) {
    assert.equal(isTooBroadDownloadFolder(folder), true, folder);
  }
  assert.equal(isTooBroadDownloadFolder("/Users/me/Downloads/agents"), false);
  assert.equal(isTooBroadDownloadFolder("/Users/ME/", "/Users/me"), true);
});
