// F4, T-9 (docs/agent-orchestration/implementation/stage-f-external-projects.md §8): the review export of a completed
// board task's run — board-review/v1 (docs/board-review-v1.schema.json) as review.json, and the same for a person as
// review.md, in <userData>/orchestration/runs/<runId>/export/: outside the project's tree, never in a commit. Written once
// per run (single-flight by runId), whole or not at all: a temporary folder next to it, then rename; a folder that is
// there already is never written again. Nothing here follows a symbolic link or writes into a project.
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { closedByPerson } from "../../../shared/orchestration.ts";
import { isUuid } from "./journal.ts";

export const REVIEW_FORMAT = "board-review/v1";
const SEMVER = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;
type Role = "lead" | "executor" | "reviewer";
type Cli = "claude" | "codex";

// О7: the first word of the first line of `<cli> --version` that is a version; the line itself cut to 128
export function cliVersions(line: string | null): { cliVersionAtExport: string | null; cliVersionRaw: string | null } {
  if (line === null) return { cliVersionAtExport: null, cliVersionRaw: null };
  const first = line.split(/\r?\n/)[0] ?? "";
  return { cliVersionAtExport: first.split(/\s+/).find((w) => SEMVER.test(w) && w.length <= 128) ?? null, cliVersionRaw: first.slice(0, 128) };
}

// What the export is made of, each from the source §8 names (the manager reads them; nothing here reads the journal)
export interface ReviewInput {
  runId: string;
  task: { key: string; ref: string | null }; // goal.task
  boardTask: { title: string; issue?: string; scope?: string[] } | null; // the board's task now (null: removed)
  commit: string; // the confirmed commit of the run
  tree: string; // git rev-parse <commit>^{tree}
  checkedTree: string; // the commit result's tree (the checked snapshot)
  base: { branch: string; commit: string }; // goal.base
  branch: string; // goal.branch, else the worktree's branch
  push: { remote: string; at: string } | null; // the confirmed push, if one was asked and made
  roles: Record<Role, Cli | null>; // the provider of each role's last turn (turn.intent); null: no turn of that role
  models: Partial<Record<Role, string>>; // goal.models (aliases)
  versions: Record<Cli, string | null>; // the first line of `<cli> --version` now (null: not read)
  conditions: readonly { id: string; text: string; covers: string[]; stage: number; status: string; stale?: boolean; evidence: { kind: string; check?: string; command?: string | null } }[];
  findings: readonly { id: string; severity: string; status: string; downgraded?: boolean; problem: string; evidence: string; closeWhen: string; paths: string[]; history: readonly { kind: string }[] }[];
}

export function buildReview(i: ReviewInput) {
  const role = (r: Role) => {
    const cli = i.roles[r];
    return cli ? { provider: cli, cli, model: i.models[r] ?? null, modelActual: null, ...cliVersions(i.versions[cli]) } : null;
  };
  const findings = i.findings.map((f) => ({
    id: f.id, severity: f.severity, status: f.status, closedBy: f.status === "closed" ? (closedByPerson(f) ? "person" : "reviewer") : null,
    downgraded: f.downgraded === true, problem: f.problem, evidence: f.evidence, closeWhen: f.closeWhen, paths: [...f.paths]
  }));
  return {
    format: REVIEW_FORMAT, run: i.runId,
    task: { key: i.task.key, ref: i.task.ref, title: i.boardTask?.title ?? null, issue: i.boardTask?.issue ?? null },
    commit: i.commit, tree: i.tree, checkedTree: i.checkedTree, base: { branch: i.base.branch, commit: i.base.commit }, branch: i.branch,
    push: i.push ? { remote: i.push.remote, at: i.push.at, result: "confirmed" as const } : null,
    lead: role("lead"), executor: role("executor"), reviewer: role("reviewer"),
    conditions: i.conditions.map((c) => {
      const check = c.evidence.kind === "check";
      return { id: c.id, text: c.text, covers: [...c.covers], stage: c.stage, status: c.status, stale: c.stale === true,
        evidence: { kind: c.evidence.kind, check: check ? c.evidence.check ?? null : null, command: check ? c.evidence.command ?? null : null } };
    }),
    findings,
    openBlocking: findings.filter((f) => f.severity === "blocking" && f.status === "open").length,
    scope: i.boardTask?.scope ? [...i.boardTask.scope] : null
  };
}
export type BoardReview = ReturnType<typeof buildReview>;

// review.md: the same data for a person — no labels, verdict or vocabulary of any project
export function reviewMarkdown(r: BoardReview): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const roleLine = (name: string, x: BoardReview["lead"]) =>
    `- ${name}: ${x ? `${x.provider}${x.model ? `, model ${x.model}` : ""}${x.cliVersionRaw ? `, ${x.cliVersionRaw}` : ""}` : "—"}`;
  return [
    `# Review of ${r.task.key}${r.task.ref ? ` (${r.task.ref})` : ""}${r.task.title ? `: ${r.task.title}` : ""}`, "",
    `- Run: ${r.run}`, ...(r.task.issue ? [`- Issue: ${r.task.issue}`] : []),
    `- Commit: ${r.commit} (tree ${r.tree}; checked tree ${r.checkedTree})`,
    `- Branch: ${r.branch}, base ${r.base.branch} at ${r.base.commit}`,
    `- Push: ${r.push ? `${r.push.remote} at ${r.push.at}` : "none"}`,
    ...(r.scope ? [`- Scope: ${r.scope.join(", ")}`] : []), "",
    "## Roles", "", roleLine("Lead", r.lead), roleLine("Executor", r.executor), roleLine("Reviewer", r.reviewer), "",
    "## Conditions", "",
    ...(r.conditions.length ? r.conditions.map((c) => `- ${c.id} (${c.status}${c.stale ? ", stale" : ""}): ${cell(c.text)}${c.evidence.command ? ` — \`${cell(c.evidence.command)}\`` : ""}`) : ["No conditions."]), "",
    `## Findings (${r.openBlocking} open blocking)`, "",
    ...(r.findings.length ? ["| Id | Severity | Status | Closed by | Problem | Close when | Paths |", "|---|---|---|---|---|---|---|",
      ...r.findings.map((f) => `| ${f.id} | ${f.severity}${f.downgraded ? " (downgraded)" : ""} | ${f.status} | ${f.closedBy ?? "—"} | ${cell(f.problem)} | ${cell(f.closeWhen)} | ${cell(f.paths.join(", "))} |`)]
      : ["No findings."]),
    ""
  ].join("\n");
}

export const exportPaths = (root: string, runId: string) => {
  const dir = join(root, "runs", runId, "export");
  return { dir, json: join(dir, "review.json"), md: join(dir, "review.md") };
};
const TMP_PREFIX = "export.tmp-";

export interface ReviewExporterDeps {
  root: string; // <userData>/orchestration
  // the export's data, or null: no export is due (not completed, no goal.export, nothing committed…)
  source(runId: string): Promise<ReviewInput | null>;
  // tests only: a crash after the temporary folder is written, before the rename
  afterTmp?(runId: string): Promise<void> | void;
}

export function createReviewExporter(deps: ReviewExporterDeps) {
  const flying = new Map<string, Promise<boolean>>();
  // true: written now; false: nothing to write (no export due, or written before)
  async function write(runId: string): Promise<boolean> {
    const runDir = join(deps.root, "runs", runId);
    const real = await lstat(runDir).catch(() => null);
    if (!real?.isDirectory()) return false; // a symbolic link is never followed
    const { dir } = exportPaths(deps.root, runId);
    if (await lstat(dir).catch(() => null)) return false; // there already: never written again
    const input = await deps.source(runId);
    if (!input) return false;
    const review = buildReview(input);
    const tmp = join(runDir, `${TMP_PREFIX}${randomUUID()}`);
    await mkdir(tmp, { mode: 0o700 });
    try {
      for (const [name, text] of [["review.json", `${JSON.stringify(review, null, 2)}\n`], ["review.md", reviewMarkdown(review)]] as const) {
        const fh = await open(join(tmp, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await fh.writeFile(text, "utf8"); await fh.sync(); } finally { await fh.close(); }
      }
      await deps.afterTmp?.(runId);
      if (await lstat(dir).catch(() => null)) return false;
      await rename(tmp, dir);
      return true;
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }
  return {
    // single-flight by runId: two calls at once write once
    write(runId: string): Promise<boolean> {
      let p = flying.get(runId);
      if (!p) {
        p = write(runId).finally(() => flying.delete(runId));
        flying.set(runId, p);
      }
      return p;
    },
    // the application's start: every run without its export gets one, if due; a temporary folder a crash left is removed
    async catchUp(): Promise<string[]> {
      const written: string[] = [];
      for (const id of await readdir(join(deps.root, "runs")).catch(() => [] as string[])) {
        if (!isUuid(id)) continue; // a foreign name is not a run
        const runDir = join(deps.root, "runs", id);
        if (!(await lstat(runDir).catch(() => null))?.isDirectory()) continue; // a symbolic link is never followed
        if (flying.has(id)) continue; // its write is going on: its temporary folder is live
        for (const n of await readdir(runDir).catch(() => [] as string[])) {
          if (n.startsWith(TMP_PREFIX) && !flying.has(id)) await rm(join(runDir, n), { recursive: true, force: true }).catch(() => {});
        }
        if (await this.write(id).catch(() => false)) written.push(id);
      }
      return written;
    }
  };
}
