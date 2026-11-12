// F-c (D-041 p. 3): «Разрешать проверкам сеть и запись вне папки». Off by default: without the profile's checksOutside the
// check profile is byte-for-byte what it was and its refusals stand (run in the real Seatbelt on macOS); with it the
// profile adds outside addresses and writes to the temporary folders and the tools' caches, and nothing else — the home
// itself, the credential stores, the orchestration data, the work folder's .git and listening stay refused. The
// autopilot never accepts the lead's check commands of such a goal. No model, no CLI.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { autoAccepts } from "../src/main/services/orchestration/cycle.ts";
import { validateProfile } from "../src/main/services/orchestration/profile.ts";
import { buildCheckProfile, checkSelftest } from "../src/main/services/orchestration/sandbox.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NODE = fs.realpathSync(process.execPath);
const LAUNCH = { command: NODE, args: [path.join(HERE, "..", "src", "orchestration", "supervisor.mjs")], env: {} };
const DARWIN = { skip: process.platform !== "darwin" && "Seatbelt is macOS's", timeout: 120_000 };

function fixture() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fco-")));
  // the stand-in home lies outside the temporary folder (as the real one does), else the allow of the folder would cover it
  const home = fs.realpathSync(fs.mkdtempSync(path.join(HERE, ".fco-home-")));
  for (const x of ["work", "tmp", "root"]) fs.mkdirSync(path.join(d, x), { recursive: true });
  for (const x of [".npm", ".ssh", ".config/gh", "Library/Keychains"]) fs.mkdirSync(path.join(home, x), { recursive: true });
  return { d, home, paths: { work: path.join(d, "work"), tmp: path.join(d, "tmp"), root: path.join(d, "root"), realHome: home } };
}
const drop = (f) => { fs.rmSync(f.d, { recursive: true, force: true }); fs.rmSync(f.home, { recursive: true, force: true }); };

test("the profile: nothing of checksOutside without the flag; the extra rules only with it, before the denies", () => {
  const fx = fixture(); const { d, paths } = fx;
  const off = buildCheckProfile(paths);
  assert.equal(buildCheckProfile({ ...paths, outside: false }).sha256, off.sha256, "false is the same profile as absent");
  assert.doesNotMatch(off.text, /checksOutside|mDNSResponder|\(remote ip "\*:\*"\)|\.npm"\)/);
  const on = buildCheckProfile({ ...paths, outside: true });
  assert.notEqual(on.sha256, off.sha256);
  assert.match(on.text, /\(remote ip "\*:\*"\)/);
  // the allows of writes stand before the credential and orchestration denies (the last matching rule wins)
  assert.ok(on.text.indexOf("/private/tmp") < on.text.indexOf("(deny file-read* file-write*"));
  assert.ok(on.text.indexOf(".npm") < on.text.indexOf(".ssh"));
  assert.doesNotMatch(on.text, /network-(bind|inbound) \(local ip "\*/, "no listening beyond localhost");
  drop(fx);
});

test("the profile's setting: absent or false is none, true is kept, anything else is refused", () => {
  const base = { v: 1, workMode: "copy", checks: [], prepare: { steps: [], auto: false }, env: { direnv: false }, finish: { commit: false, push: null, qa: null }, grants: [] };
  assert.equal("checksOutside" in validateProfile(base), false);
  assert.equal("checksOutside" in validateProfile({ ...base, checksOutside: false }), false);
  assert.equal(validateProfile({ ...base, checksOutside: true }).checksOutside, true);
  assert.throws(() => validateProfile({ ...base, checksOutside: "yes" }), /checksOutside/);
});

test("the autopilot never accepts the lead's check commands of a goal whose checks may leave the folder", () => {
  assert.equal(autoAccepts({ mode: "autopilot" }, "denied", 2), true);
  assert.equal(autoAccepts({ mode: "autopilot", checksOutside: true }, "denied", 2), false);
  assert.equal(autoAccepts({ mode: "autopilot", checksOutside: true }, "open", 2), false);
  assert.equal(autoAccepts({ mode: "autopilot", checksOutside: true }, "denied", 0), true, "no command proposed: nothing runs");
  assert.equal(autoAccepts({ mode: "steps" }, "denied", 2), false);
});

// the operations run inside the profile by the application's own Node; each answers ok or the error code
const PROBE = String.raw`
const fs = require("node:fs"), net = require("node:net");
const [tmpdirReal, home, root, work, ext, port] = JSON.parse(process.argv[1]);
const id = ".fco-" + process.pid;
const out = {};
const w = (name, p) => { try { fs.writeFileSync(p, "x"); fs.unlinkSync(p); out[name] = "ok"; } catch (e) { out[name] = e.code || "error"; } };
w("write-private-tmp", "/private/tmp/" + id);
w("write-user-tmpdir", tmpdirReal + "/" + id);
w("write-npm-cache", home + "/.npm/" + id);
w("write-home", home + "/" + id);
w("write-ssh", home + "/.ssh/" + id);
w("write-gh-config", home + "/.config/gh/" + id);
w("write-root", root + "/" + id);
w("write-git", work + "/.git/" + id);
const git = work + "/.git";
try { fs.mkdirSync(git + "/" + id, { recursive: true }); out["write-git-dir"] = "ok"; fs.rmSync(git, { recursive: true }); } catch (e) { out["write-git-dir"] = e.code || "error"; }
const tcp = (host, p) => new Promise((res) => { const c = net.connect(p, host); const t = setTimeout(() => { c.destroy(); res("ETIMEDOUT"); }, 5000);
  c.on("connect", () => { clearTimeout(t); c.destroy(); res("ok"); }); c.on("error", (e) => { clearTimeout(t); res(e.code || "error"); }); });
(async () => {
  out["tcp-localhost"] = await tcp("127.0.0.1", port);
  out["tcp-external"] = await tcp(ext.host, ext.port);
  out["listen-any"] = await new Promise((res) => { const s = net.createServer(); s.on("error", (e) => res(e.code || "error")); s.listen({ host: "0.0.0.0", port: 0 }, () => { s.close(); res("ok"); }); });
  process.stdout.write(JSON.stringify(out) + "\n");
})();
`;

async function probe(outside) {
  const fx = fixture(); const { d, paths } = fx;
  fs.mkdirSync(path.join(paths.work, ".git"));
  const profilePath = path.join(d, "p.sb");
  fs.writeFileSync(profilePath, buildCheckProfile({ ...paths, ...(outside ? { outside: true } : {}) }).text);
  const quiet = (c) => { c.on("error", () => {}); c.end(); };
  const server = net.createServer(quiet).on("error", () => {});
  await new Promise((res) => server.listen({ host: "0.0.0.0", port: 0 }, res));
  const port = server.address().port;
  const ext = { host: "1.1.1.1", port: 443 }; // a LAN address of this host is "localhost" to Seatbelt
  const args = JSON.stringify([fs.realpathSync(os.tmpdir()), paths.realHome, paths.root, paths.work, ext, port]);
  // asynchronously: the server above lives in this process
  const child = await new Promise((res) => {
    const c = spawn("/usr/bin/sandbox-exec", ["-f", profilePath, "--", NODE, "-e", PROBE, args],
      { cwd: paths.work, env: { ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin:/bin", HOME: paths.realHome, TMPDIR: paths.tmp }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    c.stdout.setEncoding("utf8").on("data", (x) => { stdout += x; });
    c.on("close", () => res({ stdout, pid: c.pid }));
  });
  server.close();
  const got = JSON.parse(child.stdout.trim().split("\n").at(-1));
  const selftest = await checkSelftest({ profilePath, ...paths, ...(outside ? { outside: true } : {}), launch: LAUNCH });
  drop(fx);
  try { fs.unlinkSync(`/private/tmp/.fco-${child.pid}`); } catch { /* nothing was written */ }
  return { got, selftest };
}

test("real Seatbelt, flag off: network, writes outside the folder are refused as before; listening is as before (localhost covers this host)", DARWIN, async () => {
  const { got, selftest } = await probe(false);
  assert.deepEqual(selftest, { passed: true, checks: 8, failed: [] });
  for (const k of ["write-private-tmp", "write-user-tmpdir", "write-npm-cache", "write-home", "write-ssh", "write-gh-config", "write-root", "write-git", "write-git-dir", "tcp-external"]) {
    assert.equal(got[k], "EPERM", k);
  }
  assert.equal(got["tcp-localhost"], "ok", "this machine's localhost, as before");
});

test("real Seatbelt, flag on: outside addresses and temporary folders and caches; the rest stays refused", DARWIN, async () => {
  const { got, selftest } = await probe(true);
  assert.deepEqual(selftest, { passed: true, checks: 9, failed: [] });
  for (const k of ["write-private-tmp", "write-user-tmpdir", "write-npm-cache", "tcp-localhost"]) assert.equal(got[k], "ok", k);
  assert.notEqual(got["tcp-external"], "EPERM", "an outside address is not refused by the sandbox");
  // the home itself, the credential stores, the orchestration data (inside the temporary folder here), .git and listening
  for (const k of ["write-home", "write-ssh", "write-gh-config", "write-root", "write-git", "write-git-dir"]) assert.equal(got[k], "EPERM", k);
});

test("the flag-on self-test fails on a profile that lacks the extras, the flag-off one on a profile that has them", DARWIN, async () => {
  const fx = fixture(); const { d, paths } = fx;
  const on = path.join(d, "on.sb");
  const off = path.join(d, "off.sb");
  fs.writeFileSync(on, buildCheckProfile({ ...paths, outside: true }).text);
  fs.writeFileSync(off, buildCheckProfile(paths).text);
  const a = await checkSelftest({ profilePath: off, ...paths, outside: true, launch: LAUNCH });
  assert.equal(a.passed, false);
  assert.ok(a.failed.some((f) => f.name === "allow.write-shared-tmp"));
  const b = await checkSelftest({ profilePath: on, ...paths, launch: LAUNCH });
  assert.ok(b.failed.some((f) => f.name === "deny.tcp-external"), "a flag-off run in a flag-on profile is caught");
  drop(fx);
});
