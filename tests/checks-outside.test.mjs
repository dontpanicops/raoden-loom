// F-c (D-041 p. 3): «Разрешать проверкам сеть и запись вне папки». Off by default: without the profile's checksOutside the
// check profile is what it was and its refusals stand (run in the real Seatbelt on macOS); with it the profile adds
// outside addresses and closes more of the home to reading, and nothing else — writes stay in the work folder and the
// check's own temporary folder (the tools' caches are pointed there, security review H1), the secrets of the environment
// are not passed (M1), the credential stores, the orchestration data, the work folder's .git and listening stay
// refused. The autopilot never accepts the lead's check commands of such a goal. No model, no CLI.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { autoAccepts } from "../src/main/services/orchestration/cycle.ts";
import { textsConflict } from "../src/main/services/orchestration/journal.ts";
import { validateProfile } from "../src/main/services/orchestration/profile.ts";
import { buildCheckProfile, CACHE_ENV, checkEnv, checkSelftest } from "../src/main/services/orchestration/sandbox.ts";
import { t as words } from "../src/renderer/src/lib/i18n.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NODE = fs.realpathSync(process.execPath);
const LAUNCH = { command: NODE, args: [path.join(HERE, "..", "src", "orchestration", "supervisor.mjs")], env: {} };
const DARWIN = { skip: process.platform !== "darwin" && "Seatbelt is macOS's", timeout: 120_000 };
// what a home holds that is read by nobody but its owner: the probe reads each of them (review M1)
const PRIVATE = [".zsh_history", ".bash_history", ".git-credentials", ".pypirc", ".config/gcloud/credentials.db", ".azure/msal_token_cache.json",
  ".cargo/credentials.toml", ".terraform.d/credentials.tfrc.json", "Library/Application Support/Google/Chrome/Default/Cookies",
  "Library/Application Support/Firefox/profiles.ini", "Library/Cookies/Cookies.binarycookies", "Library/Mail/x", "Library/Messages/chat.db"];

function fixture() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fco-")));
  // the stand-in home lies outside the temporary folder (as the real one does), else the allow of the folder would cover it
  const home = fs.realpathSync(fs.mkdtempSync(path.join(HERE, ".fco-home-")));
  for (const x of ["work", "tmp", "root", "other-check"]) fs.mkdirSync(path.join(d, x), { recursive: true });
  for (const x of [".npm/_npx", ".cache", "Library/Caches", ".ssh", ".config/gh", "Library/Keychains"]) fs.mkdirSync(path.join(home, x), { recursive: true });
  for (const f of PRIVATE) { fs.mkdirSync(path.dirname(path.join(home, f)), { recursive: true }); fs.writeFileSync(path.join(home, f), "secret"); }
  return { d, home, paths: { work: path.join(d, "work"), tmp: path.join(d, "tmp"), root: path.join(d, "root"), realHome: home } };
}
const drop = (f) => { fs.rmSync(f.d, { recursive: true, force: true }); fs.rmSync(f.home, { recursive: true, force: true }); };

test("the profile: nothing of checksOutside without the flag; with it the network and more denied reads, never more writes", () => {
  const fx = fixture(); const { paths } = fx;
  const off = buildCheckProfile(paths);
  assert.equal(buildCheckProfile({ ...paths, outside: false }).sha256, off.sha256, "false is the same profile as absent");
  assert.doesNotMatch(off.text, /checksOutside|mDNSResponder|\(remote ip "\*:\*"\)|_history/);
  const on = buildCheckProfile({ ...paths, outside: true });
  assert.notEqual(on.sha256, off.sha256);
  assert.match(on.text, /\(remote ip "\*:\*"\)/);
  // review H1: no write beyond the work folder and the check's temporary folder — the same allows of writes as off
  const writes = (t) => t.split("\n").filter((l) => /\(allow file-(read\* )?write\*/.test(l));
  assert.deepEqual(writes(on.text), writes(off.text));
  assert.doesNotMatch(on.text, /"\/private\/tmp"|\/\.npm"|Library\/Caches"|\/\.cache"/);
  // review M1: the extra denies of reading stand before the allows of the folders (the last matching rule wins)
  assert.ok(on.text.indexOf("_history") < on.text.indexOf("(allow file-read* file-write*"));
  assert.doesNotMatch(on.text, /network-(bind|inbound) \(local ip "\*/, "no listening beyond localhost");
  drop(fx);
});

test("the environment of a sandboxed check: its own TMPDIR; with outside the caches in it and no secret-looking variable", () => {
  const env = { PATH: "/usr/bin", HOME: "/Users/runner", GITHUB_TOKEN: "t", AWS_SECRET_ACCESS_KEY: "s", OPENAI_API_KEY: "k", PGPASSWORD: "p",
    GOOGLE_APPLICATION_CREDENTIALS: "c", npm_token: "n", XDG_CACHE_HOME: "/Users/runner/.cache" };
  assert.deepEqual(checkEnv(env, "/t"), { ...env, TMPDIR: "/t" }, "off: as before");
  const on = checkEnv(env, "/t", true);
  assert.deepEqual(Object.keys(on).filter((k) => !CACHE_ENV.includes(k)).sort(), ["HOME", "PATH", "TMPDIR"]);
  for (const k of ["npm_config_cache", "XDG_CACHE_HOME", "PIP_CACHE_DIR", "UV_CACHE_DIR", "GOCACHE", "YARN_CACHE_FOLDER", "npm_config_store_dir", "PLAYWRIGHT_BROWSERS_PATH"]) {
    assert.equal(on[k], "/t/cache", k);
  }
});

test("the risk beside the box says what the network gives a check: the home is read, not closed (D-025, review M1)", () => {
  assert.match(words("ru", "projChecksOutsideRisk"), /сможет читать файлы домашней папки и переменные окружения и отправлять их в сеть/);
  assert.match(words("en", "projChecksOutsideRisk"), /can read the files of your home folder and the environment variables and send them/);
  for (const locale of ["ru", "en"]) assert.doesNotMatch(words(locale, "projChecksOutsideRisk"), /домашняя папка .*закрыт|the home folder .*stay closed|~\/\.npm/, locale);
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

// review M2: checks.proposed says "denied" for a profile that may reach the network (the record's two values are what
// 1.5.20 reads); the goal's checksOutside in run.created is what says the network, and the second stage of reading
// refuses an autopilot acceptance of such lines
test("the journal: an autopilot acceptance of the lead's lines of a checksOutside goal is a conflict; the person's is not", () => {
  const state = (by, count = 2) => ({ kind: "goal", checks: {}, completion: null,
    orch: { checksProposal: { turnId: "t", count, sandboxNetwork: "denied" }, checksDecision: { decision: "accept", by, count }, amended: {}, plan: null } });
  const lines = (n, origin) => Array.from({ length: n }, (_, i) => ({ id: `cmd-${i + 1}`, command: `c${i}`, ...(origin ? { origin } : {}) }));
  const texts = (goal, n = 2) => ({ goal: { commands: [], mode: "autopilot", ...goal }, proposal: { checks: lines(n) }, decision: { checks: lines(n, "lead") } });
  assert.equal(textsConflict(state("autopilot"), texts({})), null, "as before without the setting");
  assert.match(textsConflict(state("autopilot"), texts({ checksOutside: true })), /network/);
  assert.equal(textsConflict(state("person"), texts({ checksOutside: true })), null, "the person read the lines");
  assert.equal(textsConflict(state("autopilot", 0), texts({ checksOutside: true }, 0)), null, "no command proposed: nothing runs");
});

// the operations run inside the profile by the application's own Node; each answers ok or the error code
const PROBE = String.raw`
const fs = require("node:fs"), net = require("node:net");
const [tmpdirReal, home, root, work, ext, port, otherCheck, privateFiles] = JSON.parse(process.argv[1]);
const id = ".fco-" + process.pid;
const out = {};
const w = (name, p) => { try { fs.writeFileSync(p, "x"); fs.unlinkSync(p); out[name] = "ok"; } catch (e) { out[name] = e.code || "error"; } };
w("write-private-tmp", "/private/tmp/" + id);
w("write-user-tmpdir", tmpdirReal + "/" + id);
w("write-other-check", otherCheck + "/.canvastty-profile.sb");
w("write-npm-cache", home + "/.npm/" + id);
w("write-npx", home + "/.npm/_npx/" + id);
w("write-dot-cache", home + "/.cache/" + id);
w("write-library-caches", home + "/Library/Caches/" + id);
w("write-home", home + "/" + id);
w("write-ssh", home + "/.ssh/" + id);
w("write-gh-config", home + "/.config/gh/" + id);
w("write-root", root + "/" + id);
w("write-git", work + "/.git/" + id);
w("write-check-tmp", process.env.TMPDIR + "/" + id);
if (process.env.npm_config_cache) { fs.mkdirSync(process.env.npm_config_cache, { recursive: true }); w("write-npm-config-cache", process.env.npm_config_cache + "/" + id); }
for (const f of privateFiles) { try { fs.readFileSync(home + "/" + f); out["read:" + f] = "ok"; } catch (e) { out["read:" + f] = e.code || "error"; } }
out.env = Object.keys(process.env);
out.npmCache = process.env.npm_config_cache ?? null;
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

const SECRETS = { GITHUB_TOKEN: "t", AWS_SECRET_ACCESS_KEY: "s", OPENAI_API_KEY: "k", PGPASSWORD: "p", GOOGLE_APPLICATION_CREDENTIALS: "c" };

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
  const args = JSON.stringify([fs.realpathSync(os.tmpdir()), paths.realHome, paths.root, paths.work, ext, port, path.join(d, "other-check"), PRIVATE]);
  // the environment as userCheck gives it (checkEnv), from a person's environment with secrets in it
  const env = checkEnv({ ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin:/bin", HOME: paths.realHome, ...SECRETS }, paths.tmp, outside);
  // asynchronously: the server above lives in this process
  const child = await new Promise((res) => {
    const c = spawn("/usr/bin/sandbox-exec", ["-f", profilePath, "--", NODE, "-e", PROBE, args], { cwd: paths.work, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    c.stdout.setEncoding("utf8").on("data", (x) => { stdout += x; });
    c.on("close", () => res({ stdout, pid: c.pid }));
  });
  server.close();
  const got = JSON.parse(child.stdout.trim().split("\n").at(-1));
  const selftest = await checkSelftest({ profilePath, ...paths, ...(outside ? { outside: true } : {}), launch: LAUNCH });
  drop(fx);
  for (const p of [`/private/tmp/.fco-${child.pid}`, path.join(fs.realpathSync(os.tmpdir()), `.fco-${child.pid}`)]) fs.rmSync(p, { force: true });
  return { got, selftest, paths };
}

const WRITES_OUTSIDE = ["write-private-tmp", "write-user-tmpdir", "write-other-check", "write-npm-cache", "write-npx", "write-dot-cache", "write-library-caches"];
const ALWAYS_DENIED = ["write-home", "write-ssh", "write-gh-config", "write-root", "write-git", "write-git-dir"];

test("real Seatbelt, flag off: network, writes outside the folder are refused as before; listening is as before (localhost covers this host)", DARWIN, async () => {
  const { got, selftest } = await probe(false);
  assert.deepEqual(selftest, { passed: true, checks: 11, failed: [] });
  for (const k of [...WRITES_OUTSIDE, ...ALWAYS_DENIED, "tcp-external"]) assert.equal(got[k], "EPERM", k);
  assert.equal(got["tcp-localhost"], "ok", "this machine's localhost, as before");
  assert.equal(got["write-check-tmp"], "ok");
});

test("real Seatbelt, flag on: outside addresses; writes only in the folders of the check, the caches in its own; secrets neither read nor passed", DARWIN, async () => {
  const { got, selftest, paths } = await probe(true);
  assert.deepEqual(selftest, { passed: true, checks: 11, failed: [] });
  assert.equal(got["tcp-localhost"], "ok");
  assert.notEqual(got["tcp-external"], "EPERM", "an outside address is not refused by the sandbox");
  // review H1: nothing that runs later outside the sandbox can be written — the shared temporary folders, another
  // check's folder, the home's caches
  for (const k of [...WRITES_OUTSIDE, ...ALWAYS_DENIED]) assert.equal(got[k], "EPERM", k);
  // the package tools' cache is the check's own
  assert.equal(got.npmCache, path.join(paths.tmp, "cache"));
  assert.equal(got["write-npm-config-cache"], "ok");
  assert.equal(got["write-check-tmp"], "ok");
  // review M1: what could be sent is not read, the environment's secrets do not arrive
  for (const f of PRIVATE) assert.equal(got[`read:${f}`], "EPERM", f);
  for (const k of Object.keys(SECRETS)) assert.equal(got.env.includes(k), false, k);
});

test("the self-test catches a profile that is not the one asked for: the network either way, writes to caches and temporary folders", DARWIN, async () => {
  const fx = fixture(); const { d, paths } = fx;
  const on = path.join(d, "on.sb");
  const off = path.join(d, "off.sb");
  const wide = path.join(d, "wide.sb");
  const onText = buildCheckProfile({ ...paths, outside: true }).text;
  fs.writeFileSync(on, onText);
  fs.writeFileSync(off, buildCheckProfile(paths).text);
  // the writes the first version of checksOutside allowed (review H1)
  const tmpReal = fs.realpathSync(os.tmpdir());
  const h = paths.realHome;
  fs.writeFileSync(wide, onText.replace("(allow file-read*)\n", `(allow file-read*)\n(allow file-write* (subpath "/private/tmp") (subpath "${tmpReal}") (subpath "${h}/.npm") (subpath "${h}/.cache") (subpath "${h}/Library/Caches"))\n`));
  const a = await checkSelftest({ profilePath: off, ...paths, outside: true, launch: LAUNCH });
  assert.equal(a.passed, false);
  assert.ok(a.failed.some((f) => f.name === "allow.tcp-external"), JSON.stringify(a.failed));
  const b = await checkSelftest({ profilePath: on, ...paths, launch: LAUNCH });
  assert.ok(b.failed.some((f) => f.name === "deny.tcp-external"), "a flag-off run in a flag-on profile is caught");
  const c = await checkSelftest({ profilePath: wide, ...paths, outside: true, launch: LAUNCH });
  assert.deepEqual(c.failed.map((f) => f.name).sort(), ["deny.write-home-cache", "deny.write-shared-tmp", "deny.write-user-tmpdir"]);
  drop(fx);
});

test("outside: the wider secret names and a password inside a URL value are not passed; PATH and the like are", async () => {
  const { checkEnv } = await import("../src/main/services/orchestration/sandbox.ts");
  const got = checkEnv({ PATH: "/usr/bin", HOME: "/h", LANG: "C", NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    DB_PASS: "p", SENTRY_DSN: "d", GH_PAT: "x", HTTP_AUTH: "a", SESSION_ID: "s", MY_COOKIE: "c",
    DATABASE_URL: "postgres://u:hunter2@db/x", GIT_REMOTE: "https://ghp_abc@github.com/o/r", MAIL: "a@b.c" }, "/t", true);
  for (const k of ["PATH", "HOME", "LANG", "NPM_CONFIG_REGISTRY", "MAIL"]) assert.ok(k in got, k);
  for (const k of ["DB_PASS", "SENTRY_DSN", "GH_PAT", "HTTP_AUTH", "SESSION_ID", "MY_COOKIE", "DATABASE_URL", "GIT_REMOTE"]) assert.equal(k in got, false, k);
});
