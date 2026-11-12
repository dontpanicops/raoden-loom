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

    await writeFile(join(chosen, "a2-y.txt"), "y");
    await writeFile(join(oldRoot, "a1-x.txt"), "x");
    assert.equal((await policy.validateUploadPaths([join(chosen, "a2-y.txt")])).length, 1);
    await assert.rejects(policy.validateUploadPaths([join(oldRoot, "a1-x.txt")]));

    policy.setDownloadRoot(oldRoot); // back to the app's own folder
    assert.equal(policy.resolveDownloadPath("a4", "z.txt"), join(oldRoot, "a4-z.txt"));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
