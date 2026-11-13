// F-c (D-041, stage of functions c): the review export's folder and format (p. 1), the checklist of the environment probe (p. 2),
// the line counters of the feed (p. 7) and the profile's new fields (p. 1, 3). The checks' network and writes (p. 3) are in
// checks-outside.test.mjs, «Open file» (p. 4) in orchestration-board-inbox.test.mjs. No model, no CLI.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createFrameMapper, diffDelta } from "../src/main/services/orchestration/activity.ts";
import { validateProfile } from "../src/main/services/orchestration/profile.ts";
import { buildReview, createReviewExporter, exportPaths, insideProject } from "../src/main/services/orchestration/reviewExport.ts";
import { exportView } from "../src/main/services/orchestration/orchestrationService.ts";
import { envRows } from "../src/renderer/src/features/orchestration/runModel.ts";
import { t } from "../src/renderer/src/lib/i18n.ts";

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fc-fn-")));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const RUN = "0f1e2d3c-4b5a-4968-8776-655443322110";
const input = {
  runId: RUN, task: { key: "T-1", ref: null }, boardTask: { title: "Заметки" }, commit: "a".repeat(40), tree: "b".repeat(40), checkedTree: "b".repeat(40),
  base: { branch: "main", commit: "c".repeat(40) }, branch: "feat/x", push: null, roles: { lead: "codex", executor: "claude", reviewer: null }, models: {},
  versions: { claude: null, codex: null }, conditions: [], findings: []
};
const fresh = () => {
  const root = fs.mkdtempSync(path.join(TMP, "root-"));
  fs.mkdirSync(path.join(root, "runs", RUN), { recursive: true });
  return root;
};
const ls = (dir) => fs.readdirSync(dir).sort();

test("the review's target: markdown only, json only, both — in the folder of the person, <folder>/<run>/, never over an existing one", async () => {
  const root = fresh();
  const out = path.join(TMP, "reviews");
  for (const [format, files] of [["markdown", ["review.md"]], ["json", ["review.json"]], ["both", ["review.json", "review.md"]]]) {
    const dir = path.join(out, format);
    const ex = createReviewExporter({ root, source: async () => input, target: async () => ({ dir, format }) });
    assert.equal(await ex.write(RUN, true), true);
    assert.deepEqual(ls(path.join(dir, RUN)), files);
    assert.deepEqual(ls(dir), [RUN], "no temporary folder is left");
    assert.equal(await ex.write(RUN, true), false, "there already: never written again");
  }
  // the paths the view shows are those the exporter writes
  const p = exportPaths(root, RUN, { dir: out, format: "markdown" });
  assert.deepEqual([p.json, p.md], [null, path.join(out, RUN, "review.md")]);
  assert.match(fs.readFileSync(path.join(out, "markdown", RUN, "review.md"), "utf8"), /^# Review of T-1/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, "json", RUN, "review.json"), "utf8")).format, buildReview(input).format);
});

test("the review without a target is as before: the application's folder, both files; and a folder chosen later does not export old runs again", async () => {
  const root = fresh();
  const plain = createReviewExporter({ root, source: async () => input });
  assert.equal(await plain.write(RUN), true);
  assert.deepEqual(ls(path.join(root, "runs", RUN, "export")), ["review.json", "review.md"]);
  const out = path.join(TMP, "later");
  const later = createReviewExporter({ root, source: async () => input, target: async () => ({ dir: out, format: "both" }) });
  assert.deepEqual(await later.catchUp(), [], "the start's catch-up leaves a run that has its review");
  assert.equal(fs.existsSync(out), false);
  assert.equal(await later.write(RUN, true), true, "the person's own request writes where the settings say");
  assert.deepEqual(ls(path.join(out, RUN)), ["review.json", "review.md"]);
});

test("a folder inside the project is found, a link or a folder not made yet cannot hide it", async () => {
  const project = fs.mkdtempSync(path.join(TMP, "project-"));
  fs.mkdirSync(path.join(project, "sub"));
  const away = fs.mkdtempSync(path.join(TMP, "away-"));
  fs.symlinkSync(project, path.join(away, "link"));
  assert.equal(await insideProject(path.join(project, "sub"), project), true);
  assert.equal(await insideProject(path.join(project, ".loom", "reviews"), project), true, "not made yet");
  assert.equal(await insideProject(project, project), true);
  assert.equal(await insideProject(path.join(away, "link", "x"), project), true, "through a link");
  assert.equal(await insideProject(away, project), false);
  assert.equal(await insideProject(`${project}-next`, project), false, "a sibling of the same prefix");
});

test("security review L3: a folder that became a link into the project after the target was read gets nothing; a link elsewhere is written where it leads", async () => {
  const root = fresh();
  const project = fs.mkdtempSync(path.join(TMP, "project-"));
  const away = fs.mkdtempSync(path.join(TMP, "away-"));
  const dir = path.join(away, "reviews");
  // the target was read (and checked) while the folder was not there; a link into the project is put in its place
  const ex = createReviewExporter({ root, source: async () => { fs.symlinkSync(project, dir); return input; }, target: async () => ({ dir, format: "both", project }) });
  assert.equal(await ex.write(RUN, true), false);
  assert.deepEqual(ls(project), [], "nothing in the project's tree");
  // a link to another place outside the project: the files are written there, the link itself stays a link
  fs.unlinkSync(dir);
  const elsewhere = fs.mkdtempSync(path.join(TMP, "elsewhere-"));
  fs.symlinkSync(elsewhere, dir);
  const ok = createReviewExporter({ root, source: async () => input, target: async () => ({ dir, format: "json", project }) });
  assert.equal(await ok.write(RUN, true), true);
  assert.deepEqual(ls(path.join(elsewhere, RUN)), ["review.json"]);
  assert.equal(fs.lstatSync(dir).isSymbolicLink(), true);
});

test("the profile: the folder and the format — a relative folder is refused, ~/ is expanded, both is not stored, the flag alone is as before", () => {
  const base = { v: 1, workMode: "worktree", checks: [], prepare: { steps: [], auto: false }, env: { direnv: false }, finish: { commit: true, push: null, qa: null }, grants: [],
    runBase: { remote: "origin", branch: "main", remoteUrl: null }, reviewExport: true };
  const flagOnly = validateProfile(base);
  assert.equal("reviewExportDir" in flagOnly || "reviewExportFormat" in flagOnly, false, "an old profile reads and writes as it was");
  assert.equal(validateProfile({ ...base, reviewExportDir: "/Users/runner/reviews/", reviewExportFormat: "json" }).reviewExportDir, "/Users/runner/reviews");
  assert.equal(validateProfile({ ...base, reviewExportDir: "~/reviews" }).reviewExportDir, path.join(os.homedir(), "reviews"));
  assert.equal("reviewExportFormat" in validateProfile({ ...base, reviewExportFormat: "both" }), false);
  assert.throws(() => validateProfile({ ...base, reviewExportDir: ".loom/reviews" }), (e) => e.code === "review_export_dir_relative");
  assert.throws(() => validateProfile({ ...base, reviewExportFormat: "html" }), /reviewExportFormat/);
  assert.throws(() => validateProfile({ ...base, reviewExportDir: "/a\n/b" }), /reviewExportDir/);
});

test("exportView: the goal's folder and format give the paths; a completed board task's run with a commit is exportable by hand", () => {
  const st = (over = {}) => ({ runId: RUN, status: "completed", orch: { finish: [{ step: "commit", status: "done", commit: "a".repeat(40) }] }, ...over });
  const task = { id: "i", key: "T-1" };
  const base = { branch: "main", commit: "c".repeat(40), key: "T-0" };
  assert.deepEqual(exportView("/r", st(), { task, base }), { exportable: true }, "no automatic export asked: no paths, the button only");
  const v = exportView("/r", st(), { export: true, task, base, exportTo: { dir: "/out", format: "markdown" } });
  assert.deepEqual(v.export, { json: null, md: "/out/" + RUN + "/review.md" });
  assert.equal(v.exportable, true);
  assert.equal(exportView("/r", st(), { export: true }).export.json, `/r/runs/${RUN}/export/review.json`);
  assert.deepEqual(exportView("/r", st({ status: "running" }), { task, base }), {});
  assert.deepEqual(exportView("/r", st({ orch: { finish: [] } }), { export: true, task, base }), { export: null });
});

test("the checklist of the environment: the rows are the report's facts, nothing more", () => {
  const rows = envRows({
    checkedAt: "2026-11-12T14:10:00Z", shell: { shell: "/bin/zsh", direnv: "none", pathEntries: 5 },
    providers: [
      { provider: "codex", ok: true, error: null, items: [{ id: "mcp", value: "", confirmed: true, complete: true, servers: [
        { name: "gh", connection: null, auth: null, tools: [] }, { name: "db", connection: "connected", auth: null, tools: ["q"] }, { name: "fs", connection: null, auth: null, tools: [] }] }] },
      { provider: "claude", ok: false, error: "no answer", items: [] }
    ]
  });
  assert.deepEqual(rows.map((r) => [r.id, r.level]), [["shell", "ok"], ["codex:cli", "ok"], ["codex:mcp", "warning"], ["claude:cli", "fail"]]);
  const mcp = rows.find((r) => r.id === "codex:mcp");
  assert.deepEqual([mcp.params.n, mcp.params.names, mcp.unchecked], [2, "gh, fs", ["gh", "fs"]]);
  const none = envRows({ checkedAt: "", shell: { shell: null, direnv: "none", pathEntries: 0 }, providers: [
    { provider: "claude", ok: true, error: null, items: [{ id: "mcp", value: "0", confirmed: true, complete: true }] },
    { provider: "codex", ok: true, error: null, items: [{ id: "mcp", value: "", confirmed: false, complete: false, incomplete: "timeout" }] }] });
  assert.deepEqual(none.map((r) => [r.id, r.level, r.key]), [["shell", "warning", "orchEnvRow_noShell"], ["claude:cli", "ok", "orchEnvRow_cli"], ["claude:mcp", "ok", "orchEnvRow_mcpNone"],
    ["codex:cli", "ok", "orchEnvRow_cli"], ["codex:mcp", "warning", "orchEnvRow_mcpNoList"]]);
  for (const locale of ["ru", "en"]) for (const r of [...rows, ...none]) assert.ok(t(locale, r.key), `${locale}: ${r.key}`);
});

test("the feed's counters: from the lines the CLI itself sent, nothing guessed", () => {
  const c = createFrameMapper("claude", "executor", "/p");
  const ev = (value) => ({ kind: "event", type: value.type, value, bytes: 1 });
  const use = (id, name, input) => c(ev({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } }));
  const done = (id) => c(ev({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } }));
  use("e1", "Edit", { file_path: "/p/a.ts", old_string: "x\ny", new_string: "a\nb\nc" });
  assert.deepEqual(done("e1").find((d) => d.kind === "tool_finished").detail, { tool: "Edit", target: "a.ts", ok: true, added: 3, removed: 2 });
  use("e2", "MultiEdit", { file_path: "/p/a.ts", edits: [{ old_string: "", new_string: "1\n2" }, { old_string: "q", new_string: "" }] });
  const multi = done("e2").find((d) => d.kind === "tool_finished").detail;
  assert.deepEqual([multi.added, multi.removed], [2, 1]);
  use("w1", "Write", { file_path: "/p/b.ts", content: "l1\nl2\n" });
  const wrote = done("w1").find((d) => d.kind === "tool_finished").detail;
  assert.deepEqual([wrote.added, "removed" in wrote], [2, false], "a Write: what it replaced is not known");
  use("r1", "Read", { file_path: "/p/a.ts" });
  assert.equal("added" in done("r1").find((d) => d.kind === "tool_finished").detail, false);
  use("e3", "Edit", { file_path: "/p/a.ts", old_string: 5 });
  assert.equal("added" in done("e3").find((d) => d.kind === "tool_finished").detail, false, "an input that is not text: no counter");
  // Codex: only a diff the CLI sent
  const x = createFrameMapper("codex", "lead", "/p");
  const item = (changes) => x(ev({ method: "item/completed", params: { item: { type: "fileChange", changes } } }));
  assert.deepEqual(diffDelta("--- a\n+++ b\n@@\n-old\n+new\n+more\n context"), { added: 2, removed: 1 });
  assert.equal(diffDelta(""), undefined);
  const withDiff = item([{ path: "/p/a.ts", kind: "update", diff: "@@\n-old\n+new" }, { path: "/p/b.ts", kind: "add" }]);
  assert.deepEqual(withDiff.map((d) => [d.text, d.detail.added, d.detail.removed]), [["a.ts", 1, 1], ["b.ts", undefined, undefined]], "a change with no diff has no counter");
});
