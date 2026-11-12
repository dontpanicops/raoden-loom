// The one panel of a link's latest run (stage-8-contract.md §1, stage 11). A pinned summary on top — the state in plain
// words, who works on which stage, why it is paused, the next step, the question with its answer field and the commands
// this state allows — and below it tabs: overview, the live activity of one participant, changes, the technical log,
// the journal's history. Nothing is shown as done before main answers.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { LocaleId } from "../../../../shared/contracts";
import type {
  OrchestrationActivityEntry,
  OrchestrationChanges,
  OrchestrationConditions,
  OrchestrationConditionStatus,
  OrchestrationDecisions,
  OrchestrationFindings,
  OrchestrationFormField,
  OrchestrationHistoryRecord,
  OrchestrationLimitKind,
  OrchestrationPermissionOption,
  OrchestrationPermissionRequest,
  OrchestrationPersonDecide,
  OrchestrationPlanChoice,
  OrchestrationPlanDecide,
  OrchestrationResult,
  OrchestrationRunView,
  OrchestrationTake,
  OrchestrationTakeOutcome
} from "../../../../shared/orchestration";
import { Term } from "../../components/Term";
import { UiIcon } from "../../components/UiIcon";
import { ActionZone, DangerConfirm, PanelFoot } from "./ActionZone";
import { t, type TranslationKey } from "../../lib/i18n";
import { copyKey, useCopy } from "../../lib/useCopy";
import {
  ACTIVE_STATUSES,
  activeRole,
  byReviewer,
  costOf,
  takeOutcomeText,
  takeSourceText,
  takenLines,
  limitRows,
  LIMIT_KINDS,
  tokensText,
  type Cost,
  type CostRole,
  actionEnabled,
  actionZone,
  type ZoneButton,
  availableActions,
  proposalBlocks,
  TERMINAL_STATUSES,
  commandOf,
  digest,
  finishStatus,
  formatText,
  historyLines,
  lineRole,
  outcomeOf,
  parsePlan,
  causeText,
  headlineKey,
  pauseCause,
  glossarySplit,
  idLabel,
  idNumber,
  factLines,
  conditionStatusKey,
  requirementStatusKey,
  pauseLabel,
  pauseText,
  providerName,
  PAUSES,
  pausedTurn,
  lastLines,
  prepareReason,
  prepareReasonText,
  viewCause,
  orchestrationAvailableHere,
  orchestrationEntry,
  participantState,
  roleModel,
  runStatusKey,
  resultFacts,
  runHeadline,
  type HistoryLine,
  type LineText,
  type ParticipantState,
  type PendingCommand,
  type RunAction,
  type RunDigest,
  type ResultFacts
} from "./runModel";
import { duration, spanText, findingsLine, finishText, isServiceEntry, outcomeKey, personDecisionsLine, readJournal, reportParts, saidKey, summaryModel, type ReportParts, type RunJournalState, type TextRef } from "./runStatus";
import { pickDocs, planDoc, readCreatedFile, resultDoc, toMarkdown, type CreatedDocs, type CreatedFile, type DocInput, type Loaded, type PlanEntry, type PlanJson, type RunDoc } from "./runDocs";
import type { PanelRole, PanelState } from "./useAgentCanvasUi";
import type { PanelMode, PanelSection, PanelTab, PanelView } from "./panelTabs";
import { outcomeText, type Orchestration, type RunActivityState } from "./useOrchestration";

// What stays different from the same CLI in a terminal (stage 12). Shown before the start and in the run panel.
export const DIFFERENCES = ["tui", "rcHooks", "codexExperimental", "claudeQuestions", "elicitation", "snapshots", "sequential"] as const;
export function Differences({ locale }: { locale: LocaleId }): React.JSX.Element {
  return (
    <details className="orch-diffs" data-orch-differences>
      <summary>{t(locale, "orchDiffTitle")}</summary>
      <ul>{DIFFERENCES.map((d) => <li key={d} data-difference={d}>{tr(locale, `orchDiff_${d}`)}</li>)}</ul>
    </details>
  );
}

const SILENCE_MS = 15_000;
const api = () => window.canvasTTY.orchestration;
const tr = (locale: LocaleId, key: string): string => t(locale, key as TranslationKey) ?? key;
const time = (locale: LocaleId, ts: string | null) => (ts ? new Date(ts).toLocaleTimeString(locale) : "—");
// A key the dictionary has (dynamic keys built from main's values may be missing).
const known = (locale: LocaleId, key: string): boolean => (t(locale, key as TranslationKey) as string | undefined) !== undefined;

// A clock for durations and silence: re-renders once a second while mounted.
function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(id); }, [ms]);
  return now;
}

// Why the run is paused: the step that ended the turn when main recorded it, else the reason's general words.
// A paused run's headline and why are its pause's words (runModel pauseText) wherever the panel says them: the header,
// the summary's outcome, its reason line.
// A copy or a worktree: what became of its dependency folders (main's plan per folder, cloneDependencies), one phrase
// when all agree. A folder a preparation step installs is said by that step's last result, nothing until there is one.
// failed: a step failed, its output is in the activity of the checks.
function dependenciesText(locale: LocaleId, entries: readonly OrchestrationActivityEntry[]): { text: string; failed: boolean } | null {
  const d = entries.find((e) => e.kind === "prepare_finished" && e.detail?.dependencies === true)?.detail;
  if (!d) return null;
  // null: the step that installs it has no result yet (or was stopped)
  const all = Object.entries(d).flatMap(([dir, v]): [string, string | null][] => {
    if (dir === "dependencies" || dir.startsWith("step:") || typeof v !== "string") return [];
    if (v !== "install") return known(locale, `orchDeps_${v}`) ? [[dir, v]] : [];
    const step = d[`step:${dir}`];
    const last = entries.filter((e) => e.kind === "prepare_finished" && e.detail?.step === step && typeof e.detail.ok === "boolean").at(-1);
    return [[dir, !last || last.detail!.stopped === true ? null : last.detail!.ok ? "installed" : "failed"]];
  });
  // a folder the project does not need is named only when no folder is needed at all
  const needed = all.filter(([, r]) => r !== "not_needed");
  const dirs = (needed.length ? needed : all).filter((x): x is [string, string] => x[1] !== null);
  if (!dirs.length) return null;
  const word = (r: string) => tr(locale, `orchDeps_${r}`);
  return {
    text: dirs.every(([, r]) => r === dirs[0][1]) ? word(dirs[0][1]) : dirs.map(([dir, r]) => `${dir} — ${word(r)}`).join(" · "),
    failed: dirs.some(([, r]) => r === "failed")
  };
}

// A status line's reason: a pause by pauseCause with the turn it followed, anything else as main said it.
function statusReason(locale: LocaleId, status: unknown, reason: unknown, turnId: string | null, entries: readonly OrchestrationActivityEntry[]): string {
  if (typeof reason !== "string" || !reason) return "";
  return ` — ${causeText(locale, status === "paused" ? pauseCause(reason, turnId, entries) : { kind: "reason", reason })}`;
}

// A status in words: a pause by its one short form (runModel pauseLabel, as on the link chip and the cards); anything
// else as the status with main's reason.
function statusWords(locale: LocaleId, status: unknown, reason: unknown, turnId: string | null, entries: readonly OrchestrationActivityEntry[]): string {
  if (status === "paused" && typeof reason === "string" && PAUSES[reason]) return pauseLabel(locale, pauseCause(reason, turnId, entries));
  return `${tr(locale, `orchStatus_${status}`)}${statusReason(locale, status, reason, turnId, entries)}`;
}

// A text with the glossary's words explained on hover (runModel GLOSSARY).
export function Termed({ locale, text }: { locale: LocaleId; text: string }): React.JSX.Element {
  return <>{glossarySplit(locale, text).map((p) => typeof p === "string" ? p
    : <Term key={p.at} locale={locale} id={p.term} hint={p.hint}>{p.text}</Term>)}</>;
}

// A journal id (F1, C1, R1) as the person reads it, the id in the tooltip (runModel idLabel).
function IdLabel({ locale, id, plain }: { locale: LocaleId; id: string; plain?: boolean }): React.JSX.Element {
  return plain ? <span title={id} data-id={id}>{idLabel(locale, id)}</span> : <b title={id} data-id={id}>{idLabel(locale, id)}</b>;
}

function lineText(locale: LocaleId, line: HistoryLine, entries: readonly OrchestrationActivityEntry[]): string {
  const p = line.parts;
  const head = tr(locale, `orchLine_${line.kind}`);
  switch (line.kind) {
    case "status": return `${head}: ${statusWords(locale, p.status, p.reason, typeof p.turnId === "string" ? p.turnId : null, entries)}`;
    case "turn": return `${head}: ${tr(locale, `orchPurpose_${p.purpose}`)}${p.stage !== null ? ` · ${t(locale, "orchStage")} ${p.stage}` : ""}`;
    case "turn_failed": return `${head}: ${p.purpose ? `${tr(locale, `orchPurpose_${p.purpose}`)} — ` : ""}${p.outcome}`;
    case "report": return head;
    case "review": return `${head}: ${tr(locale, `orchVerdict_${p.verdict}`)}${p.stage !== null ? ` · ${t(locale, "orchStage")} ${p.stage}` : ""}`;
    case "stage_accepted": return `${head} ${p.stage}`;
    case "check": return `${head} ${p.checkId ?? ""}: ${tr(locale, `orchCheck_${p.status}`)}`
      + `${p.reason ? ` — ${tr(locale, `orchCheckReason_${p.reason}`)}` : ""}${p.exitCode !== null && p.status === "failed" ? ` (${t(locale, "orchExitCode")} ${p.exitCode})` : ""}`;
    case "limit": return `${head}: ${tr(locale, `orchLimit_${p.kind}`)} = ${p.value}`;
    case "plan": return `${head} (v${p.version})`;
    case "prepare_finished": return `${head}: ${tr(locale, `orchPrepare_${p.status}`)}${p.failed !== null ? ` · ${t(locale, "orchPrepareStepN")} ${p.failed}` : ""}`;
    default: return head;
  }
}

// A failed preparation on the board: the step that failed and one line of why, its output's last 40 lines on demand.
// Only what is recorded: the journal's output text, the exit code from the step's activity entry.
function PrepareFailure({ orch, runId, locale, prepare, entries }: { orch: Orchestration; runId: string; locale: LocaleId;
  prepare: NonNullable<OrchestrationRunView["progress"]>["prepare"] & object; entries: readonly OrchestrationActivityEntry[] }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const stored = useStored(orch, runId, prepare.output?.sha256);
  const step = prepare.failed === null ? null : Number(prepare.failed);
  const exit = entries.filter((e) => e.kind === "prepare_finished" && e.detail?.step === step && e.detail?.ok === false && typeof e.detail.exitCode === "number").at(-1)?.detail?.exitCode;
  const why = prepareReasonText(locale, prepareReason(stored.text, typeof exit === "number" ? exit : null));
  return (
    <span data-prepare-failure>
      {prepare.command && <> — {t(locale, "orchPrepareStep").replace("{command}", prepare.command)}</>}{why && <span data-prepare-why>: {why}</span>}
      {prepare.output && <> <button type="button" data-prepare-output-toggle onClick={() => setOpen((v) => !v)}>{t(locale, open ? "orchPrepareHideOutput" : "orchPrepareShowOutput")}</button></>}
      {open && <pre className="orch-panel__text" data-prepare-output>{stored.text !== null ? lastLines(stored.text) : t(locale, stored.status === "error" ? "orchError_generic" : "orchLoading")}</pre>}
    </span>
  );
}

// A stored text of the run through the one cache of useOrchestration (read once, shared with the cards and the widget).
function useStored(orch: Orchestration, runId: string | null, sha256: string | undefined): { status: "none" | "loading" | "error" | "ready"; text: string | null; retry(): void } {
  useEffect(() => { if (runId && sha256) orch.loadText(runId, sha256); }, [orch.loadText, runId, sha256]);
  const s = sha256 ? orch.texts[sha256] : undefined;
  return {
    status: !sha256 ? "none" : s?.status ?? "loading",
    text: s?.status === "ready" ? s.text : null,
    retry: () => { if (runId && sha256) orch.loadText(runId, sha256, true); }
  };
}
const useText = (orch: Orchestration, runId: string | null, sha256: string | undefined): string | null => useStored(orch, runId, sha256).text;
const NO_RECORDS: OrchestrationHistoryRecord[] = [];

// A journal text behind a history line, loaded on demand through text(runId, sha256). Loading, a failure to load
// and a text the journal did not keep are each said in words.
function LineDetails({ runId, text, dropped, locale }: { runId: string; text: LineText; dropped: number; locale: LocaleId }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "loaded"; text: string } | null>(null);
  const load = async (): Promise<void> => {
    if (!text.ref) return;
    setState({ kind: "loading" });
    const { outcome, value } = await outcomeOf(() => api().text(runId, text.ref!.sha256));
    if (outcome.kind === "accepted" && value) setState({ kind: "loaded", text: value.text });
    else setState({ kind: "error", message: outcomeText(locale, outcome) ?? t(locale, "orchError_generic") });
  };
  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    if (next && (state === null || state.kind === "error")) void load();
  };
  const shown = state?.kind === "loaded" ? formatText(text.kind, state.text) : null;
  return (
    <div className="orch-details">
      <button type="button" className="orch-details__toggle" aria-expanded={open} onClick={toggle}>
        <UiIcon name="chevron" size={12} />{t(locale, (open ? "orchHide" : `orchShow_${text.kind}`) as TranslationKey)}
      </button>
      {open && (
        <div className="orch-details__body" data-details-state={!text.ref ? "missing" : state?.kind ?? "loading"}>
          {!text.ref ? (
            <p className="orch-details__missing">{t(locale, "orchTextMissing")}{text.missing ? ` (${t(locale, `orchTextWhy_${text.missing}` as TranslationKey) ?? text.missing})` : ""}</p>
          ) : state?.kind === "error" ? (
            <p className="orch-details__error" role="alert">{t(locale, "orchTextLoadFailed")}: {state.message}
              {" "}<button type="button" onClick={() => void load()}>{t(locale, "orchRepeat")}</button></p>
          ) : !shown ? (
            <p className="orch-hint">{t(locale, "orchLoading")}</p>
          ) : (
            <>
              {shown.items.length > 0 && <ul>{shown.items.map((item, i) => <li key={i}>{item}</li>)}</ul>}
              {shown.body && <pre>{shown.body}</pre>}
              {!shown.items.length && !shown.body && <p className="orch-hint">{t(locale, "orchNothingYet")}</p>}
            </>
          )}
          {text.kind === "output" && dropped > 0 && <p className="orch-hint">{t(locale, "orchOutputDropped")}: {dropped}</p>}
        </div>
      )}
    </div>
  );
}

// What a role works with: the model its CLI reported, else the chosen one (marked), else «As in the CLI».
const modelLabel = (locale: LocaleId, m: { model: string | null; reported: boolean }): string =>
  m.model === null ? t(locale, "orchModelCli") : m.reported ? m.model : `${m.model} (${t(locale, "orchModelChosen")})`;
const roleName = (locale: LocaleId, role: PanelRole) =>
  role === "lead" ? `Codex · ${t(locale, "orchRoleLead")}` : role === "executor" ? `Claude · ${t(locale, "orchRoleExecutor")}`
    : role === "reviewer" ? `Codex · ${t(locale, "orchRoleReviewer")}` : t(locale, "orchObserveChecks");

function phaseText(locale: LocaleId, p: ParticipantState, now: number): string {
  const since = p.since ? ` · ${duration(locale, now - Date.parse(p.since))}` : "";
  const why = p.phase === "interrupted" && p.outcome
    ? ` (${tr(locale, known(locale, `orchPhaseWhy_${p.outcome}`) ? `orchPhaseWhy_${p.outcome}` : `orchOutcome_${p.outcome}`)})` : "";
  return `${tr(locale, `orchPhase_${p.phase}`)}${why}${p.phase === "running" || p.phase === "starting" || p.phase === "finishing" ? since : ""}`;
}

// ---------- activity feed ----------

const LOG_KINDS = new Set(["task_sent", "stderr", "error", "process_started", "process_exited", "usage", "truncated", "session", "check_output", "turn_finished", "refusal"]);
// R5h-A (mock-up 20): the feed has the work (thoughts, tools, files, messages) and what needs the person; the application's own lines
// (task sent, process started and exited, session) are in «Журнал»
export const FEED_KINDS = new Set(["thinking", "message", "tool_started", "tool_finished", "file_read",
  "file_changed", "subagent", "refusal", "error", "turn_finished", "check_started", "check_finished", "status", "truncated",
  "permission_requested", "permission_decided", "permission_applied", "prepare_started", "prepare_finished", "external_action", "report_note"]);
// the agent card keeps «task sent» (the hand-over of a turn), the run panel's feed has it only in «Журнал»
export const CARD_FEED_KINDS: ReadonlySet<string> = new Set([...FEED_KINDS, "task_sent"]);

// «— CLI: <its reason> (<its type>)», as the CLI put it; nothing when it gave none
export function cliWhy(locale: LocaleId, d: Readonly<Record<string, unknown>>): string {
  const text = typeof d.reason === "string" && d.reason ? d.reason : null;
  const type = typeof d.reasonType === "string" && d.reasonType ? d.reasonType : null;
  if (!text && !type) return "";
  return ` — ${t(locale, "orchCliWhy")}: ${text ?? type}${text && type ? ` (${type})` : ""}`;
}

export function entryLabel(locale: LocaleId, e: OrchestrationActivityEntry, entries: readonly OrchestrationActivityEntry[]): string {
  const d = e.detail ?? {};
  switch (e.kind) {
    case "thinking": return tr(locale, "orchAct_thinking");
    case "turn_finished": return `${tr(locale, "orchAct_turn_finished")}: ${tr(locale, `orchOutcome_${e.text}`)}${d.reportedDone === true ? ` · ${tr(locale, "orchAct_reportedDone")}` : d.reportedDone === false ? ` · ${tr(locale, "orchAct_reportedNotDone")}` : ""}${d.question === true ? ` · ${tr(locale, "orchAct_asked")}` : ""}${typeof d.endStep === "string" && d.endStep !== "ok" && known(locale, `orchEnding_${d.endStep}`) ? ` — ${tr(locale, `orchEnding_${d.endStep}`)}` : ""}`;
    case "status": {
      const at = entries.findIndex((x) => x.id === e.id);
      const turn = typeof d.reason === "string" && at >= 0 ? pausedTurn(entries, at, d.reason) : null;
      return `${tr(locale, "orchAct_status")}: ${statusWords(locale, d.status, d.reason, turn, entries)}`;
    }
    case "task_sent": return `${tr(locale, "orchAct_task_sent")}: ${tr(locale, `orchPurpose_${d.purpose}`)}${d.stage !== null && d.stage !== undefined ? ` · ${t(locale, "orchStage")} ${d.stage}` : ""}`;
    case "process_exited": return `${tr(locale, "orchAct_process_exited")}${d.code !== null && d.code !== undefined ? ` (${t(locale, "orchExitCode")} ${d.code})` : d.signal ? ` (${d.signal})` : ""}`;
    case "tool_finished": return `${tr(locale, "orchAct_tool_finished")}: ${e.text}${typeof d.exitCode === "number" ? ` (${t(locale, "orchExitCode")} ${d.exitCode})` : ""}`;
    case "check_finished": return typeof d.status === "string"
      ? `${tr(locale, "orchAct_check_finished")}: ${String(d.checkId ?? "")}: ${tr(locale, `orchCheck_${d.status}`)}${typeof d.reason === "string" && d.reason ? ` — ${tr(locale, `orchCheckReason_${d.reason}`)}` : ""}`
      : `${tr(locale, "orchAct_check_finished")}: ${e.text}`;
    case "external_action": {
      // "<step>: <phase> — <command or evidence>": the step and phase in words, the command as it ran
      const rest = e.text.includes(" — ") ? e.text.slice(e.text.indexOf(" — ")) : "";
      const phase = String(d.phase ?? "");
      const phaseKey = known(locale, `orchFinishStatus_${phase}`) ? `orchFinishStatus_${phase}` : `orchFinishPhase_${phase}`;
      return typeof d.step === "string" ? `${tr(locale, "orchAct_external_action")}: ${tr(locale, `orchFinishStep_${d.step}`)}: ${known(locale, phaseKey) ? tr(locale, phaseKey) : phase}${rest}`
        : `${tr(locale, "orchAct_external_action")}: ${e.text}`;
    }
    case "prepare_finished": {
      // the preparation's outcome (with why it failed), or a step with nothing to install; a step's own result as it ran
      if (d.summary === true) {
        const why = d.status === "failed" ? prepareReasonText(locale, prepareReason(typeof d.output === "string" ? d.output : null, typeof d.exitCode === "number" ? d.exitCode : null)) : "";
        return `${tr(locale, "orchAct_prepare_summary")}: ${tr(locale, `orchPrepare_${d.status}`)}${typeof d.command === "string" ? ` — ${t(locale, "orchPrepareStep").replace("{command}", d.command)}` : ""}${why ? `: ${why}` : ""}`;
      }
      if (d.nothing === true) return `${tr(locale, "orchAct_prepare_finished")}: ${e.text.replace(/: nothing to install$/, "")}: ${t(locale, "orchPrepareNothing")}`;
      return `${tr(locale, "orchAct_prepare_finished")}: ${e.text}`;
    }
    case "report_note": // a mark the application left out: never counted
      return typeof d.ignoredMark === "string"
        ? t(locale, `orchAct_markIgnored_${d.by === "person" || d.by === "dropped" || d.by === "unchanged" || d.by === "unconfirmed" ? d.by : "check"}`).replace("{role}", t(locale, e.role === "lead" ? "orchRoleLead" : "orchRoleReviewer").toLowerCase())
          .replace("{id}", d.ignoredMark).replace("{paths}", String(d.paths ?? ""))
        : e.text;
    // B3 (§5.3 п. 4–5): why the CLI asked, as it said it; the host's own answer apart from the person's
    case "permission_requested": return `${tr(locale, "orchAct_permission_requested")}: ${e.text}${cliWhy(locale, d)}`;
    case "permission_applied": return d.scope === "sandbox_static"
      ? `${tr(locale, "orchAct_permission_host")}: ${e.text}${cliWhy(locale, d)}`
      : `${tr(locale, "orchAct_permission_applied")}: ${e.text}`;
    case "usage": return `${tr(locale, "orchAct_usage")}${typeof d.costUsd === "number" ? ` · $${d.costUsd.toFixed(4)}` : ""}${typeof d.outputTokens === "number" ? ` · ${d.inputTokens ?? "?"}/${d.outputTokens} tok` : ""}`;
    default: {
      // a CLI reported another rights mode than the one chosen: a warning about rights, not a failed turn
      if (e.kind === "error" && d.accessMismatch === true) {
        return `${tr(locale, "orchAct_accessMismatch")}: ${String(d.field ?? "")} — ${tr(locale, "orchAct_accessAsked")} ${String(d.asked ?? "")}, ${tr(locale, "orchAct_accessReported")} ${String(d.reported ?? "")}`;
      }
      // R6-A: an MCP stop is said in words, not as the raw code "mcp"
      if (e.kind === "error" && (d.mcp === "mcp_present" || d.mcp === "mcp_unchecked") && typeof d.cli === "string") return causeText(locale, { kind: "mcp", reason: "needs_user_action", code: d.mcp, cli: d.cli, names: String(d.names ?? "") });
      if (e.kind === "message" && d.plan === true) return tr(locale, "orchAct_codexPlan"); // the plan's text is below the line
      // R5b: the two English words of the application's own entries are said in the interface's language
      if (e.kind === "process_started") return tr(locale, "orchAct_process_started");
      if (e.kind === "session" && /^session started/.test(e.text)) return `${tr(locale, "orchAct_sessionStarted")}${e.text.slice("session started".length)}`;
      const sub = typeof d.subagent === "string" ? ` (${t(locale, "orchActInSub")}: ${d.subagent})` : "";
      return (e.text ? `${tr(locale, `orchAct_${e.kind}`)}: ${e.text}` : tr(locale, `orchAct_${e.kind}`)) + sub;
    }
  }
}

// R6-A (mock-up 07): a feed line as the mock-up draws it - no "Tool:" / "Message:" prefix, commands and paths in mono, the end of a
// tool folded into its start line ("· ok")
const MONO_KINDS: ReadonlySet<string> = new Set(["tool_started", "tool_finished", "file_read", "file_changed"]);
function feedLine(locale: LocaleId, e: OrchestrationActivityEntry, entries: readonly OrchestrationActivityEntry[]): string {
  const d = e.detail ?? {};
  switch (e.kind) {
    case "thinking": return tr(locale, "orchFeed_thought");
    case "tool_started": return e.text;
    case "tool_finished": {
      const bad = d.ok === false || (typeof d.exitCode === "number" && d.exitCode !== 0);
      const good = d.ok === true || d.exitCode === 0;
      return bad || good ? `${e.text} · ${tr(locale, bad ? "orchFeed_toolFailed" : "orchFeed_toolOk")}` : e.text;
    }
    case "message": return d.plan === true ? entryLabel(locale, e, entries) : e.text;
    default: return entryLabel(locale, e, entries);
  }
}
// the start lines a finish line of the same turn and text replaces
function foldedStarts(list: readonly OrchestrationActivityEntry[]): Set<number> {
  const open = new Map<string, number>();
  const out = new Set<number>();
  for (const e of list) {
    const key = `${e.turnId ?? ""}\u0000${e.text}`;
    if (e.kind === "tool_started") open.set(key, e.id);
    else if (e.kind === "tool_finished" && open.has(key)) { out.add(open.get(key)!); open.delete(key); }
  }
  // an MCP stop at the tail of the feed is already said in the action zone: only «Turn finished: CLI error» stays in the feed
  list.slice(-3).forEach((e) => { if (e.kind === "error" && (e.detail?.mcp === "mcp_present" || e.detail?.mcp === "mcp_unchecked")) out.add(e.id); });
  return out;
}

// A structured answer a CLI wrote as its message (a report as JSON): shown as text and lists, never as raw JSON.
export function structured(e: OrchestrationActivityEntry): ReportParts | null {
  if (e.kind !== "message" || !/^\s*[[{]/.test(e.text)) return null;
  const p = reportParts(e.text);
  return p.text === null ? p : null;
}

export function ReportView({ locale, parts }: { locale: LocaleId; parts: ReportParts }): React.JSX.Element {
  return (
    <div className="orch-report" data-orch-report>
      {parts.text !== null && <p className="orch-panel__text">{parts.text}</p>}
      {parts.summary && <p className="orch-panel__text">{parts.summary}</p>}
      {parts.done !== null && <p><b>{t(locale, parts.done ? "orchSumDone_true" : "orchSumDone_false")}</b></p>}
      {parts.verdict && <p><b>{t(locale, "orchSumVerdict")}:</b> {tr(locale, `orchVerdict_${parts.verdict}`)}</p>}
      {parts.findings.length > 0 && <><b>{t(locale, "orchSumFindings")}:</b><ul>{parts.findings.map((f, i) => <li key={i}>{f}</li>)}</ul></>}
      {parts.question && <p><b>{t(locale, "orchSumQuestion")}:</b> {parts.question}</p>}
      {parts.next && <p><b>{t(locale, "orchSum_next")}:</b> {parts.next}</p>}
      {parts.other.length > 0 && <dl className="orch-report__other">{parts.other.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
    </div>
  );
}

// Consecutive entries of one turn of an agent (lead, executor, reviewer) form a group drawn as a card
function groupTurns(list: readonly OrchestrationActivityEntry[]): { turn: string | null; card: boolean; items: OrchestrationActivityEntry[] }[] {
  const out: { turn: string | null; card: boolean; items: OrchestrationActivityEntry[] }[] = [];
  for (const e of list) {
    const last = out.at(-1);
    if (e.turnId && last?.turn === e.turnId) last.items.push(e);
    else out.push({ turn: e.turnId, card: !!e.turnId && (e.role === "lead" || e.role === "executor" || e.role === "reviewer"), items: [e] });
  }
  return out;
}

function ActivityList({ locale, entries, gaps, filter, emptyText, silence }: {
  locale: LocaleId; entries: readonly OrchestrationActivityEntry[]; gaps: RunActivityState["gaps"];
  filter: (e: OrchestrationActivityEntry) => boolean; emptyText: string; silence: string | null;
}): React.JSX.Element {
  // Service events (hooks) are folded by default; the full feed stays one click away.
  const [service, setService] = useState(false);
  const serviceCount = useMemo(() => entries.filter((e) => filter(e) && isServiceEntry(e)).length, [entries, filter]);
  const shown = useMemo(() => entries.filter((e) => filter(e) && (service || !isServiceEntry(e))), [entries, filter, service]);
  const [limit, setLimit] = useState(300);
  const list = shown.slice(Math.max(0, shown.length - limit));
  const folded = foldedStarts(list);
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const seen = useRef(shown.length);
  const [unseen, setUnseen] = useState(0);
  // Follows new entries only while the reader is at the bottom; otherwise counts them for the "new events" button.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const added = shown.length - seen.current;
    seen.current = shown.length;
    if (atBottom.current) el.scrollTop = el.scrollHeight;
    else if (added > 0) setUnseen((n) => n + added);
  }, [shown.length]);
  const onScroll = (): void => {
    const el = box.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom.current) setUnseen(0);
  };
  const gapAfter = new Map(gaps.map((g) => [g.afterId, g.reason]));
  return (
    <div className="orch-feed">
      {serviceCount > 0 && (
        <p className="orch-feed__service" data-orch-service={service ? "shown" : "folded"}>
          {t(locale, "orchFeedService").replace("{n}", String(serviceCount))}{" "}
          <button type="button" onClick={() => setService((v) => !v)}>{t(locale, service ? "orchFeedServiceHide" : "orchFeedServiceShow")}</button>
        </p>
      )}
      {shown.length > list.length && <button type="button" className="orch-feed__earlier" onClick={() => setLimit((l) => l + 300)}>{t(locale, "orchFeedEarlier")} ({shown.length - list.length})</button>}
      <div className="orch-feed__list" ref={box} onScroll={onScroll} data-orch-feed data-wheel-owner="local">
        {list.length === 0 && <p className="orch-hint">{emptyText}</p>}
        {groupTurns(list).map((g) => {
          const rows = g.items.filter((e) => !folded.has(e.id)).map((e) => { const report = structured(e); return (
          <div key={e.id} className={`orch-feed__item orch-feed__item--${e.detail?.accessMismatch === true ? "warning" : e.kind}${isServiceEntry(e) ? " orch-feed__item--service" : ""}`} data-activity-kind={e.kind} data-activity-id={e.id}>
            <time>{time(locale, e.ts)}</time>
            {/* a structured answer is its own summary line below: the same words are not said twice */}
            {!report && <span className={`orch-feed__text${MONO_KINDS.has(e.kind) ? " orch-feed__text--mono" : ""}`}>{feedLine(locale, e, entries)}</span>}
            {report && <details open data-orch-structured><summary>{t(locale, "orchFeedReport")}</summary><ReportView locale={locale} parts={report} /></details>}
            {typeof e.detail?.output === "string" && e.detail.output && (
              <details><summary>{t(locale, "orchFeedOutput")}</summary><pre>{e.detail.output}</pre></details>
            )}
            {e.kind === "message" && e.detail?.plan === true && e.text && <details open><summary>{t(locale, "orchPlan")}</summary><pre>{e.text}</pre></details>}
            {gapAfter.has(e.id) && <div className="orch-feed__gap" role="note">{tr(locale, `orchGap_${gapAfter.get(e.id)}`)}</div>}
          </div>
          ); });
          // R5b (P-15): the entries of one turn are a card: who and when, then its lines (the mock-up 13)
          return g.card
            ? <section key={g.items[0].id} className="orch-turn" data-orch-turn={g.turn}>
              <header className="orch-turn__head"><b>{roleName(locale, g.items[0].role as PanelRole)}</b><time>{time(locale, g.items[0].ts)}</time></header>
              {rows}
            </section>
            : rows;
        })}
        {silence && <div className="orch-feed__silence" role="status" data-orch-silence>{silence}</div>}
      </div>
      {unseen > 0 && (
        <button type="button" className="orch-feed__new" onClick={() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; atBottom.current = true; setUnseen(0); }}>
          {t(locale, "orchFeedNew")} ({unseen})
        </button>
      )}
    </div>
  );
}

// ---------- changes ----------

function ChangesTab({ locale, runId, seq, inPlace }: { locale: LocaleId; runId: string; seq: number; inPlace: boolean }): React.JSX.Element {
  const [changes, setChanges] = useState<OrchestrationChanges | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ path: string; text: string; truncated: boolean } | null>(null);
  const load = useCallback(async () => {
    const { outcome, value } = await outcomeOf(() => api().changes(runId));
    if (outcome.kind === "accepted" && value) { setChanges(value); setError(null); } else setError(outcomeText(locale, outcome));
  }, [locale, runId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: seq is the trigger: reload the changes when the run moves
  useEffect(() => { const id = window.setTimeout(() => void load(), 300); return () => window.clearTimeout(id); }, [load, seq]);
  const open = async (path: string): Promise<void> => {
    if (diff?.path === path) return setDiff(null);
    const { outcome, value } = await outcomeOf(() => api().diff(runId, path));
    if (outcome.kind === "accepted" && value) setDiff(value); else setError(outcomeText(locale, outcome));
  };
  if (error) return <p className="dialog-error" role="alert">{error} <button type="button" onClick={() => void load()}>{t(locale, "orchRepeat")}</button></p>;
  if (!changes) return <p className="orch-hint">{t(locale, "orchLoading")}</p>;
  const last = changes.checkpoints.at(-1);
  return (
    <div className="orch-changes" data-orch-changes>
      <p className="orch-hint">{tr(locale, `orchChangesAt_${changes.at}`)}{changes.atTs ? ` · ${time(locale, changes.atTs)}` : ""}</p>
      {changes.files.length === 0 ? <p>{t(locale, "orchChangesNone")}</p> : (
        <ul className="orch-changes__files">
          {changes.files.map((f) => (
            <li key={f.path}>
              <button type="button" className="orch-changes__file" aria-expanded={diff?.path === f.path} onClick={() => void open(f.path)}>
                <span className={`orch-changes__status orch-changes__status--${f.status}`}>{tr(locale, `orchFileStatus_${f.status}`)}</span> <code>{f.path}</code>
              </button>
              {diff?.path === f.path && <pre className="orch-changes__diff" data-orch-diff>{diff.text || (diff.truncated ? t(locale, "orchDiffTooLarge") : t(locale, "orchDiffEmpty"))}</pre>}
            </li>
          ))}
        </ul>
      )}
      {changes.truncated && <p className="orch-hint">{t(locale, "orchChangesTruncated")}</p>}
      {inPlace ? (
        <div className="orch-take">
          <h4>{t(locale, "orchTakeTitle")}</h4>
          <p>{t(locale, "orchTakeInPlace")}</p>
          {/* git diff <commit> sees tracked paths only: new untracked files are listed by git status */}
          <pre data-orch-take>{`git diff ${changes.baselineRef}\ngit status --short`}</pre>
        </div>
      ) : (
        <div className="orch-take">
          <h4>{t(locale, "orchTakeTitle")}</h4>
          <p>{last ? `${t(locale, "orchTakeCheckpoint")} ${last.stage}: ` : t(locale, "orchTakeNoCheckpoint")}</p>
          {last && <pre data-orch-take>{`git diff ${changes.baselineRef} ${last.ref}\ngit switch -c agents/${runId.slice(0, 8)} ${last.ref}`}</pre>}
          <p className="orch-hint">{t(locale, "orchNotTransferred")}</p>
        </div>
      )}
    </div>
  );
}

// ---------- a CLI's permission prompt, question, plan or MCP form (stages 12–13) ----------

type Decide = (decision: OrchestrationPermissionOption, extra?: { answers?: Record<string, string[]>; content?: Record<string, unknown>; feedback?: string }) => void;

// An MCP server's form: one input per field, the server's own default as the start value, nothing else filled in.
// The browser checks what it can (required, number bounds, lengths); main checks everything again before sending.
function FormFields({ locale, fields, values, onChange }: {
  locale: LocaleId; fields: OrchestrationFormField[]; values: Record<string, unknown>; onChange(name: string, value: unknown): void;
}): React.JSX.Element {
  return (
    <div className="orch-form-fields" data-orch-form-fields>
      {fields.map((f) => {
        const v = values[f.name];
        const label = <span>{f.title}{f.required ? <small> · {t(locale, "orchPermFormRequired")}</small> : null}</span>;
        const hint = f.description ? <small className="orch-hint">{f.description}</small> : null;
        if (f.type === "boolean") {
          return (
            <label key={f.name} className="orch-check" data-form-field={f.name}>
              <input type="checkbox" checked={v === true} onChange={(e) => onChange(f.name, e.target.checked)} />{label}{hint}
            </label>
          );
        }
        if (f.type === "enum") {
          return (
            <label key={f.name} className="orch-field" data-form-field={f.name}>{label}
              <select value={typeof v === "string" ? v : ""} required={f.required} onChange={(e) => onChange(f.name, e.target.value || undefined)}>
                <option value="">{t(locale, "orchPermFormNoAnswer")}</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>{hint}
            </label>
          );
        }
        if (f.type === "multi") {
          const list = Array.isArray(v) ? v as string[] : [];
          return (
            <fieldset key={f.name} className="orch-field" data-form-field={f.name}><legend>{label}</legend>
              {f.options.map((o) => (
                <label key={o.value} className="orch-check">
                  <input type="checkbox" checked={list.includes(o.value)}
                    onChange={(e) => onChange(f.name, e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value))} />
                  <span>{o.label}</span>
                </label>
              ))}{hint}
            </fieldset>
          );
        }
        const numeric = f.type === "number" || f.type === "integer";
        const type = numeric ? "number" : f.format === "email" ? "email" : f.format === "uri" ? "url" : f.format === "date" ? "date" : f.format === "date-time" ? "datetime-local" : "text";
        return (
          <label key={f.name} className="orch-field" data-form-field={f.name}>{label}
            <input type={type} value={v === undefined || v === null ? "" : String(v)} required={f.required}
              min={f.minimum ?? undefined} max={f.maximum ?? undefined} step={f.type === "integer" ? 1 : numeric ? "any" : undefined}
              minLength={f.minLength ?? undefined} maxLength={f.maxLength ?? undefined}
              onChange={(e) => onChange(f.name, e.target.value === "" ? undefined : e.target.value)} />{hint}
          </label>
        );
      })}
    </div>
  );
}

function PermissionBlock({ locale, request, more, sending, onDecide }: {
  locale: LocaleId; request: OrchestrationPermissionRequest; more: number; sending: boolean; onDecide: Decide;
}): React.JSX.Element {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [own, setOwn] = useState<Record<string, string>>({});
  const form = request.kind === "elicitation" ? request.form ?? null : null;
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(
    (form?.mode === "form" ? form.fields : []).filter((f) => f.default !== null).map((f) => [f.name, f.default])));
  const [feedback, setFeedback] = useState("");
  const question = request.kind === "question";
  const answers = () => Object.fromEntries(request.questions.map((q) => [q.id, [...(picked[q.id] ?? []), ...(own[q.id]?.trim() ? [own[q.id].trim()] : [])]]));
  const answered = !question || request.questions.every((q) => (picked[q.id]?.length ?? 0) > 0 || !!own[q.id]?.trim());
  const title = question ? "orchPermQuestion" : request.kind === "plan" ? "orchPermPlan" : request.kind === "elicitation" ? "orchPermForm" : "orchPermTitle";
  // D-018: the zone's headline already says who asks and what (mock-ups 02, 03): a plain request or a question has no title of its own
  const head = title === "orchPermTitle" || question ? null : <h4>{`${t(locale, title)} · ${roleName(locale, request.role)}`}</h4>;
  // R5b (D-017): no hint under the buttons (mock-up 03); only the count of the others waiting
  const foot = more > 0 ? <p className="orch-hint">{t(locale, "orchPermMore")} {more}.</p> : null;

  if (request.kind === "plan") {
    return (
      <div className="orch-permission orch-permission--plan" data-orch-permission="plan" data-request-id={request.requestId}>
        {head}
        <pre className="orch-permission__plan" data-orch-plan-text>{request.plan ?? request.summary}</pre>
        <textarea rows={2} value={feedback} placeholder={t(locale, "orchPermPlanFeedback")} onChange={(e) => setFeedback(e.target.value)} />
        <div className="orch-panel__actions">
          <button type="button" className="orch-primary" data-decision="allow_once" disabled={sending} onClick={() => onDecide("allow_once")}>{t(locale, "orchPermPlanApprove")}</button>
          <button type="button" data-decision="deny" disabled={sending || !feedback.trim()} onClick={() => onDecide("deny", { feedback: feedback.trim() })}>{t(locale, "orchPermPlanBack")}</button>
        </div>
        {foot}
      </div>
    );
  }
  if (request.kind === "elicitation") {
    return (
      <form className="orch-permission orch-permission--form" data-orch-permission="elicitation" data-request-id={request.requestId}
        onSubmit={(e) => { e.preventDefault(); onDecide("allow_once", form?.mode === "form" ? { content: values } : {}); }}>
        {head}
        <p>{request.server ? <><b>{t(locale, "orchPermServer")}:</b> <code>{request.server}</code> · </> : null}{request.summary}</p>
        {form?.mode === "form" && <FormFields locale={locale} fields={form.fields} values={values} onChange={(name, value) => setValues((cur) => ({ ...cur, [name]: value }))} />}
        {form?.mode === "url" && <><p>{t(locale, "orchPermFormUrl")}</p><pre data-orch-form-url>{form.url}</pre></>}
        {form?.mode === "unsupported" && <p className="dialog-error">{t(locale, "orchPermFormUnsupported")} {form.reason}</p>}
        <div className="orch-panel__actions">
          {form?.mode !== "unsupported" && (
            <button type="submit" className="orch-primary" data-decision="allow_once" disabled={sending}>
              {t(locale, form?.mode === "url" ? "orchPermFormUrlDone" : "orchPermFormSend")}
            </button>
          )}
          <button type="button" className="orch-danger" data-decision="deny" disabled={sending} onClick={() => onDecide("deny")}>{t(locale, "orchPermFormDecline")}</button>
        </div>
        {foot}
      </form>
    );
  }
  if (question) {
    // mock-up 02: the question in a plate, the answer field, one button
    return (
      <div className="orch-permission orch-permission--question" data-orch-permission="question" data-request-id={request.requestId}>
        {request.questions.map((q) => (
          <fieldset key={q.id} className="orch-permission__q">
            <legend className="orch-permission__ask">{q.question}</legend>
            {q.options.map((o) => (
              <label key={o} className="orch-check">
                <input type={q.multiple ? "checkbox" : "radio"} name={`q-${request.requestId}-${q.id}`} checked={(picked[q.id] ?? []).includes(o)}
                  onChange={(e) => setPicked((cur) => ({ ...cur, [q.id]: q.multiple ? (e.target.checked ? [...(cur[q.id] ?? []), o] : (cur[q.id] ?? []).filter((x) => x !== o)) : [o] }))} />
                <span>{o}</span>
              </label>
            ))}
            {q.other && (q.options.length === 0 && !q.secret
              ? <textarea rows={3} aria-label={q.question} value={own[q.id] ?? ""} onChange={(e) => setOwn((cur) => ({ ...cur, [q.id]: e.target.value }))} />
              : <input type={q.secret ? "password" : "text"} autoComplete={q.secret ? "off" : undefined} placeholder={t(locale, "orchPermOther")} aria-label={q.question} value={own[q.id] ?? ""} onChange={(e) => setOwn((cur) => ({ ...cur, [q.id]: e.target.value }))} />)}
          </fieldset>
        ))}
        <div className="orch-panel__actions">
          <button type="button" className="orch-primary" data-decision="allow_once" disabled={sending || !answered} onClick={() => onDecide("allow_once", { answers: answers() })}>{t(locale, "orchPause_awaiting_answer_button")}</button>
          <button type="button" className="orch-textual" data-decision="deny" disabled={sending} onClick={() => onDecide("deny")}>{t(locale, "orchPermDecline")}</button>
        </div>
        {foot}
      </div>
    );
  }
  return (
    <div className="orch-permission" data-orch-permission={request.kind} data-request-id={request.requestId}>
      {head}
      <p className="orch-permission__cmd"><b>{request.tool}</b>{request.summary ? <> · <code>{request.summary}</code></> : null}</p>
      {/* D-022: the person must be able to see what they allow — the full request stays one click away */}
      {request.detail && <details><summary>{t(locale, "orchPermDetail")}</summary><pre>{request.detail}</pre></details>}
      <div className="orch-panel__actions">
        {request.options.map((o) => (
          <button key={o} type="button" data-decision={o} className={o === "deny" ? "orch-danger" : o === "allow_once" ? "orch-primary" : undefined}
            disabled={sending} onClick={() => onDecide(o)}>
            {tr(locale, `orchPerm_${o}`)}
          </button>
        ))}
      </div>
      {(request.options.includes("allow_run") || request.options.includes("allow_project")) && <p className="orch-hint" data-orch-scope-hint>{t(locale, "orchPermScopeHint")}</p>}
      {request.options.includes("allow_readonly_run") && <p className="orch-hint" data-orch-readonly-hint>{t(locale, "orchPermReadOnlyHint")}</p>}
      {request.alwaysAsk && <p className="orch-hint" data-orch-always-ask>{t(locale, "orchPermAlwaysAsk")}</p>}
      {foot}
    </div>
  );
}

// ---------- stage 13: what the CLIs reported they loaded in this run ----------

const ENV_FIELDS = ["model", "permissionMode", "approvalPolicy", "sandbox", "mcp", "skills", "plugins", "agents", "instructionSources", "toolCount", "slashCommands", "outputStyle"] as const;

// ---------- the run summary (stage 13 UX): what the run was for and what it ended with ----------

// Nothing recorded — or, while the journal is only partly read, nothing recorded in the part read so far.
function NotSpecified({ locale, incomplete }: { locale: LocaleId; incomplete: boolean }): React.JSX.Element {
  return incomplete
    ? <p className="orch-hint" data-sum-not-loaded>{t(locale, "orchSumNotLoaded")}</p>
    : <p className="orch-hint" data-sum-missing>{t(locale, "orchSumNotSpecified")}</p>;
}
// A stored text: loading, a failure with a retry, or its content; a text the journal never kept is "not specified".
function Stored({ orch, runId, textRef, locale, incomplete, children }: {
  orch: Orchestration; runId: string; textRef: TextRef | null; locale: LocaleId; incomplete: boolean; children(text: string): React.ReactNode;
}): React.JSX.Element {
  const s = useStored(orch, runId, textRef?.sha256);
  if (s.status === "none") return <NotSpecified locale={locale} incomplete={incomplete} />;
  if (s.status === "error") {
    return <p className="dialog-error" role="alert" data-sum-failed>{t(locale, "orchSumLoadFailed")} <button type="button" onClick={s.retry}>{t(locale, "orchRepeat")}</button></p>;
  }
  if (s.text === null) return <p className="orch-hint">{t(locale, "orchLoading")}</p>;
  return <>{children(s.text)}</>;
}
// D-018: one block of the summary, as the mock-ups 13 and 17 draw it — a small title (and what belongs beside it) over plates
function Section({ id, title, aside, attrs, children }: { id: string; title?: string; aside?: React.ReactNode; attrs?: Record<string, string | undefined>; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="orch-sum-block" data-sum={id} {...attrs}>
      {(title || aside) && <header>{title && <h4>{title}</h4>}{aside}</header>}
      {children}
    </section>
  );
}
// a row of a plate: the name on the left, the value (the same line) on the right
function Row({ label, mark, dd, children, attrs }: { label: React.ReactNode; mark?: "done" | "idle" | "failed" | "paused" | "waiting"; dd?: Record<string, string | undefined>; children?: React.ReactNode; attrs?: Record<string, string | undefined> }): React.JSX.Element {
  return <div className="orch-kv__row" {...attrs}><dt>{mark && <UiIcon name={mark === "waiting" ? "bell" : `status-${mark}`} size={14} />}{label}</dt><dd {...dd}>{children}</dd></div>;
}

// R6-A (mock-up 13): the steps after success the run asked for, one row each: the step and what is known of it
function FinishSteps({ locale, steps }: { locale: LocaleId; steps: NonNullable<OrchestrationRunView["progress"]>["finish"] }): React.JSX.Element | null {
  const rows = steps.filter((x) => x.asked && !x.declined);
  if (rows.length === 0) return null;
  const name = (step: string): string => { const w = tr(locale, `orchFinishStep_${step}`); return w.charAt(0).toLocaleUpperCase() + w.slice(1); };
  return (
    <dl className="orch-kv orch-zone__steps" data-orch-finish-steps>
      {rows.map((f) => (
        <Row key={f.step} label={name(f.step)} attrs={{ "data-finish-step": f.step, "data-finish-status": f.status }}>
          {f.step === "commit" && f.commit && <><code>{f.commit.slice(0, 7)}</code> · </>}
          {f.status === "unconfirmed" ? <b className="orch-zone__warn">{t(locale, "orchZone_finishRowUnconfirmed")}</b>
            : f.status === "done" ? t(locale, "orchZone_finishRowDone") : tr(locale, `orchFinishStatus_${f.status}`)}
        </Row>
      ))}
    </dl>
  );
}

// Journal v2, A2 (journal-v2-format.md §2.7): each requirement with the conditions that prove it, the status of each and
// its proof — the check run (its output) or the lead's review (paths, note). The same facts the completion decides on.
function Conditions({ orch, runId, c, locale, incomplete, completion }: {
  orch: Orchestration; runId: string; c: OrchestrationConditions; locale: LocaleId; incomplete: boolean; completion?: string | null;
}): React.JSX.Element {
  const noChecks = completion === "no_checks";
  const status = (s: OrchestrationConditionStatus, key: TranslationKey = `orchCond_${s}` as TranslationKey) => <b className={`orch-cond orch-cond--${s}`}>{t(locale, key)}</b>;
  const item = (x: OrchestrationConditions["conditions"][number]) => (
    <li key={x.id} data-condition={x.id} data-condition-status={x.status}>
      <IdLabel locale={locale} id={x.id} /> {x.text} · <span className="orch-hint">{x.evidence.kind === "check"
        ? fill(t(locale, "orchCondEvidence_check"), { cmd: x.evidence.command ?? x.evidence.check }) : t(locale, `orchCondEvidence_${x.evidence.kind}`)}</span> — {status(x.status, conditionStatusKey(x.status, noChecks, x.evidence.kind === "check"))}
      {x.stale && <p className="orch-hint orch-hint--warn" data-condition-stale>{t(locale, "orchCondStale")}</p>}
      {x.proof && "decision" in x.proof && <p className="orch-hint" data-condition-proof="person">{fill(t(locale, "orchCondProofPerson"), { decision: t(locale, `orchCond_${x.proof.decision}`) })}</p>}
      {x.proof && "checkRunId" in x.proof && (
        <details data-condition-proof="run">
          <summary>{fill(t(locale, "orchCondProofRun"), { run: x.proof.checkRunId.slice(0, 8) })}</summary>
          {x.proof.output
            ? <Stored orch={orch} runId={runId} textRef={x.proof.output} locale={locale} incomplete={incomplete}>{(text) => <pre className="orch-panel__text">{text.slice(-4000)}</pre>}</Stored>
            : <p className="orch-hint">{t(locale, "orchCondNoOutput")}</p>}
        </details>
      )}
      {x.proof && "reviewTurnId" in x.proof && (
        <p className="orch-hint" data-condition-proof="review">{fill(t(locale, "orchCondProofReview"), { paths: x.proof.paths.join(", ") || "—" })}{x.proof.note ? ` — ${x.proof.note}` : ""}</p>
      )}
    </li>
  );
  const loose = c.conditions.filter((x) => x.covers.length === 0);
  return (
    // no "confirmed by the journal" mark: a "change" condition's evidence is the lead's word (each line says which)
    // R6-A (D-018): one line with the count; the requirements and their criteria open on a click
    <details className="orch-sum-block orch-sum-fold" data-sum="conditions" title={t(locale, "orchCondCoversHint")}>
      <summary><h4>{t(locale, "orchSum_conditions")}</h4><span data-sum-conditions-count title={fill(t(locale, "orchConditionsCount"), { met: c.met, total: c.total })}>{fill(t(locale, "orchConditionsFold"), { met: c.met, total: c.total }).replace(`${t(locale, "orchSum_conditions")} · `, "")}</span></summary>
      <ul className="orch-sum__requirements">{c.requirements.map((r) => (
        <li key={r.id} data-requirement={r.id} data-requirement-status={r.status}>
          <IdLabel locale={locale} id={r.id} /> {r.text} — {status(r.status, requirementStatusKey(r.status, noChecks))}
          {r.why && <span className="orch-hint"> · {fill(t(locale, "orchCondWhy"), { why: r.why })}</span>}
          <ul>{r.conditions.map((id) => item(c.conditions.find((x) => x.id === id)!))}</ul>
        </li>
      ))}</ul>
      {loose.length > 0 && <><b>{t(locale, "orchCondLoose")}</b><ul>{loose.map(item)}</ul></>}
      {(c.dropped ?? []).length > 0 && <><b>{t(locale, "orchCondDropped")}</b><ul data-conditions-dropped>{c.dropped.map((x) => (
        <li key={x.id} data-condition={x.id} data-condition-status="dropped"><IdLabel locale={locale} id={x.id} /> {x.text} — {status("dropped")} · <span className="orch-hint">{fill(t(locale, "orchCondWhy"), { why: x.why })}</span></li>
      ))}</ul></>}
    </details>
  );
}

// Journal v2, A3 (journal-v2-format.md §2.8): the reviewer's findings — number, severity, status, the stage that owns an
// open one, and what each review did with it on which tree. "Open blocking: N" is findingsLine, as the cards say it.
// A4: the person's decisions are said as such (closed by the person, made a wish — never as fixed); onDecide: the pause
// lets the person close an open finding or make a blocking one a wish.
function Findings({ f, locale }: { f: OrchestrationFindings; locale: LocaleId }): React.JSX.Element {
  const item = (x: OrchestrationFindings["items"][number]) => (
    <li key={x.id} className="orch-finding" data-finding={x.id} data-finding-severity={x.severity} data-finding-status={x.status} data-finding-downgraded={x.downgraded ? "yes" : undefined}>
      <span className="orch-finding__text">
        <b><IdLabel locale={locale} id={x.id} /></b> {x.problem}
        <small className="orch-hint"> {t(locale, `orchFinding_${x.severity}`)} · <b className={`orch-cond orch-cond--${x.status === "closed" ? "met" : "not_met"}`}>{t(locale, `orchFinding_${x.status}`)}</b>
          {x.downgraded && <> · <b className="orch-cond orch-cond--not_met" data-finding-person="to_wish">{t(locale, "orchFindingDowngraded")}</b></>}
          {x.status === "open" && <> · {x.stage !== null ? fill(t(locale, "orchFindingStage"), { n: x.stage }) : t(locale, "orchFindingNextPlan")}</>}
          {x.condition && <> · <IdLabel locale={locale} id={x.condition} plain /></>}
          {x.possibleRepeatOf && <> · <span data-finding-repeat={x.possibleRepeatOf}>{fill(t(locale, "orchFindingRepeat"), { n: idNumber(x.possibleRepeatOf) })}</span></>}
          {x.paths.length > 0 && <> · {x.paths.join(", ")}</>}
        </small>
      </span>
      {/* what the person decided about it (mock-up 13): the segment shows the choice made; it is made on the pause (PersonDecide) */}
      {(x.downgraded || (x.status === "closed" && x.history.some((h) => h.by === "person"))) && (
        // biome-ignore lint/a11y/useSemanticElements: a button segment, not a form group
        <div className="orch-seg orch-finding__seg" role="group" aria-label={t(locale, "orchSumDecisions")}>
          <button type="button" disabled aria-pressed={!x.downgraded} className={x.downgraded ? undefined : "orch-tabs__on"}>{t(locale, "orchSumDecideClose")}</button>
          <button type="button" disabled aria-pressed={!!x.downgraded} className={x.downgraded ? "orch-tabs__on" : undefined}>{t(locale, "orchSumDecideWish")}</button>
        </div>
      )}
      <details data-finding-history>
        <summary>{t(locale, "orchFindingHistory")}</summary>
        <p className="orch-hint">{fill(t(locale, "orchFindingCloseWhen"), { text: x.closeWhen })}</p>
        <ol>{x.history.map((h, i) => (
          <li key={`${h.kind}:${h.reviewTurnId ?? h.by}:${h.index ?? i}`} data-finding-event={h.kind} data-finding-by={h.by} data-finding-review={h.reviewTurnId ?? undefined} data-finding-tree={h.tree}>
            {fill(t(locale, `orchFindingHist_${h.kind}`), { turn: (h.reviewTurnId ?? "").slice(0, 8), note: h.note ?? "" })}
            {h.by === "person" && <> · <b data-finding-person-event>{t(locale, "orchFindingByPerson")}</b></>}
            {" · "}<code>{fill(t(locale, "orchFindingTree"), { tree: h.tree.slice(0, 12) })} · {fill(t(locale, "orchFindingState"), { key: h.runKey.slice(0, 12) })}</code>
            {h.reason && <> — {t(locale, `orchFindingRefused_${h.reason}` as TranslationKey)}</>}
          </li>
        ))}</ol>
      </details>
    </li>
  );
  const blocking = f.items.filter((x) => x.severity === "blocking");
  const wishes = f.items.filter((x) => x.severity === "wish");
  return (
    // a finding is the reviewer's word; what the application did with it is the journal's (history)
    <Section id="findings" title={t(locale, "orchSumDecisions")} aside={<small className="orch-hint" data-sum-findings-open={f.openBlocking}>{findingsLine(locale, { progress: { findings: f } as OrchestrationRunView["progress"] })}</small>}>
      {blocking.length > 0 && <ul className="orch-findings" data-findings="blocking">{blocking.map(item)}</ul>}
      {f.disputed.length > 0 && <ul className="orch-findings" data-findings="disputed">{f.disputed.map((d) => (
        <li key={`${d.reviewTurnId}:${d.index}`} className="orch-finding"><span className="orch-finding__text">{d.problem} <small className="orch-hint" title={d.candidates.join(", ")}>· {d.candidates.map((c) => idLabel(locale, c)).join(", ")}</small></span></li>
      ))}</ul>}
      {wishes.length > 0 && <ul className="orch-findings" data-findings="wish">{wishes.map(item)}</ul>}
    </Section>
  );
}

type GoalJson = { text?: unknown; criteria?: unknown; commands?: unknown };
function parseGoal(text: string): GoalJson | null {
  try { const v = JSON.parse(text) as unknown; return v && typeof v === "object" ? v as GoalJson : null; } catch { return null; }
}
// R4.1: what takes focus when a decision form appears: its first field or choice
const FIRST_CHOICE = "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)";
const fill = (s: string, vars: Record<string, string | number>): string => Object.entries(vars).reduce((a, [k, v]) => a.replaceAll(`{${k}}`, String(v)), s);

// D-018: the summary as the mock-ups 13 and 17 draw it — the plates of what the run ended with (stages, checks, the review),
// then the blocks: result facts, plan, decisions on findings, the people / time (the panel's `middle`), the result. Only what the
// journal has: a block with nothing to say is not drawn.
function RunSummary({ orch, runId, view, records, locale, incomplete, facts, onOpen, middle, alerts, list }: {
  orch: Orchestration; runId: string; view: OrchestrationRunView; records: readonly OrchestrationHistoryRecord[];
  locale: LocaleId; incomplete: boolean; facts: ResultFacts;
  onOpen(section: "plan" | "result"): void; middle?: React.ReactNode; alerts?: React.ReactNode;
  list?: boolean; // R5h-A (mock-ups 02, 03, 07): only the list of the stages with their states, for the work tab of a paused run
}): React.JSX.Element {
  // Every plan's titles (a replan names the stages from its firstStage on), read through the shared text cache.
  const planShas = useMemo(() => records.filter((r) => r.type === "plan.recorded")
    .map((r) => (r.data.plan as TextRef | undefined)?.sha256).filter((x): x is string => typeof x === "string"), [records]);
  useEffect(() => { for (const sha of planShas) orch.loadText(runId, sha); }, [orch.loadText, planShas, runId]);
  const planKey = planShas.map((sha) => `${sha}:${orch.texts[sha]?.status ?? ""}`).join(",");
  const goalText = useText(orch, runId, (records.find((r) => r.type === "run.created")?.data.goal as TextRef | undefined)?.sha256);
  const commands = useMemo(() => { const g = goalText ? parseGoal(goalText) : null; return Array.isArray(g?.commands) ? g.commands.filter((c): c is string => typeof c === "string") : null; }, [goalText]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: planKey stands for orch.texts (the plan titles read)
  const m = useMemo(() => summaryModel(view, records, {
    planTitles: (sha) => { const s = orch.texts[sha]; return s?.status === "ready" ? parsePlan(s.text).map((p) => p.title) : null; },
    goalCommands: commands, complete: !incomplete
  }), [view, records, planKey, commands, incomplete]);
  const outcome = outcomeKey(view, m.finalVerdict, m.complete);
  // Read only in part: what was read stands, but nothing is concluded from what was not read yet.
  // A3: a run the reviewer reviews says so — the application accepts its stages, the reviewer concludes
  const said = (key: string) => tr(locale, saidKey(view, key));
  const stageStateText = (st: { state: string }) => said(!m.complete && st.state !== "done" ? "orchSumStage_unloaded" : `orchSumStage_${st.state}`);
  const progress = view.progress ?? null;
  const verdictText = (v: string | null) => (v ? tr(locale, `orchVerdict_${v}`) : "—");
  const countOf = (done: number, total: number) => fill(t(locale, "orchSumCountOf"), { done, total });
  const stageLabel = (n: number | null, title: string | null, plan?: number | null) =>
    `${n === null ? t(locale, "orchSumReviewFinal") : `${t(locale, "orchStage")} ${n}${title ? `: ${title}` : ""}`}${plan ? ` · ${fill(t(locale, "orchSumPlanVersion"), { v: plan })}` : ""}`;
  const findingsList = (ref: TextRef | null, attr: string) => (
    <Stored orch={orch} runId={runId} textRef={ref} locale={locale} incomplete={incomplete}>{(text) => {
      const f = reportParts(text).findings;
      return f.length ? <ul {...{ [attr]: "" }}>{f.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p>{said("orchSumRemarksNone")}</p>;
    }}</Stored>
  );
  const current = m.finalReport || m.finalVerdict ? null : m.currentReview;
  const history = m.reviews.filter((rv) => rv.state !== "current" && rv.state !== "final");
  const finished = TERMINAL_STATUSES.includes(view.status); // the blocks of the result are the finished run's (mock-ups 13, 17); a paused one shows only the rows it has (mock-ups 04, 06, 12)
  const reviewed = outcome === "completed" || outcome === "completed_no_checks";
  const stagesText = !m.stageCounts || m.stageCounts.total === 0 || (m.stageCounts.done === 0 && !finished) ? null : m.complete ? countOf(m.stageCounts.done, m.stageCounts.total) : fill(said("orchSumStages_countPartial"), m.stageCounts);
  const checksText = m.checks.length === 0 ? (m.checksKnown ? t(locale, "orchSumChecksNone") : null)
    : m.checksKnown && m.checks.every((c) => c.status === "not_run") ? t(locale, "orchSumChecksNotRunShort") : countOf(m.checkCounts.passed, m.checkCounts.total);
  const factChanges = factLines(locale, view, facts, !incomplete).find((f) => f.key === "changes");
  const hasFindings = !!progress?.findings && (progress.findings.items.length > 0 || progress.findings.disputed.length > 0);
  const legacyRemarks = !progress?.findings && !!(m.finalFindings || current?.findings);
  const hasReport = !!(m.stages?.some((s) => s.report) || m.lastReport);
  const hasExport = view.export !== undefined && !(view.export === null && view.status !== "completed");
  // D-027: under «Проверки» — the checks that did not pass, with their class and the reason the journal kept
  const failedChecks = useMemo(() => {
    const runCheck = new Map<string, string>();
    const reasons = new Map<string, string>();
    for (const r of records) {
      if (r.type === "check.started" && typeof r.data.checkRunId === "string" && typeof r.data.checkId === "string") runCheck.set(r.data.checkRunId, r.data.checkId);
      if (r.type === "check.finished") { const id = runCheck.get(r.data.checkRunId as string); if (id) { if (typeof r.data.reason === "string" && r.data.reason) reasons.set(id, r.data.reason); else reasons.delete(id); } }
    }
    return m.checks.filter((c) => c.status !== "passed" && c.status !== "not_run" && c.status !== "running")
      .map((c) => ({ id: c.id, title: c.title, status: c.status, cls: progress?.checks.find((x) => x.id === c.id)?.class ?? null, reason: reasons.get(c.id) ?? null }));
  }, [m.checks, records, progress?.checks]);
  // R5h-A (D-026, mock-ups 02, 03, 05, 07, 12, 14): under the zone of a pause, where the run stands — the plan, the stages up to the
  // one that waits, the commands asked, the check the sandbox refused; only what the journal has
  const waiting = !finished && (view.status === "paused" || !!view.permission);
  const waitKey = view.permission ? (view.permission.kind === "question" ? "orchRowWait_answer" : "orchRowWait_you") : view.status === "paused" ? "orchRowWait_paused" : view.status === "failed" ? "orchRowWait_failed" : null;
  const stageRows = (): React.ReactNode => {
    const stages = m.stages ?? [];
    const current = stages.find((st) => st.n === view.stage) ?? stages.find((st) => st.state !== "done");
    const upTo = current ? stages.filter((st) => st.n <= current.n) : stages;
    return <>
      {stages.length > 0 && !stages.some((st) => st.state === "done") && <Row label={t(locale, "orchRowPlanApproved")} mark="done" attrs={{ "data-pause-row": "plan" }} />}
      {upTo.map((st) => st === current && waitKey
        ? <Row key={st.n} label={`${t(locale, "orchStage")} ${st.n}${st.title ? ` · ${st.title}` : ""}`} mark={waitKey === "orchRowWait_paused" ? "paused" : waitKey === "orchRowWait_failed" ? "failed" : "waiting"} attrs={{ "data-pause-row": "stage", "data-stage-n": String(st.n) }}>{t(locale, waitKey)}</Row>
        : <Row key={st.n} label={`${t(locale, "orchStage")} ${st.n}${st.title ? ` · ${st.title}` : ""}`} mark={st.state === "done" ? "done" : "idle"} attrs={{ "data-pause-row": "stage", "data-stage-n": String(st.n) }} />)}
    </>;
  };
  const refusedRows = (): React.ReactNode => (failedChecks.length > 0
    ? failedChecks.map((c) => <Row key={c.id} label={c.title} mark="failed" attrs={{ "data-sum-failed-check": c.id, "data-check-class": c.cls ?? undefined }}>{[c.cls ? tr(locale, `orchClass_${c.cls}`) : null, c.reason && known(locale, `orchCheckReason_${c.reason}`) ? tr(locale, `orchCheckReason_${c.reason}`) : c.reason].filter(Boolean).join(" · ")}</Row>)
    : view.refused ? <Row label={view.refused.command} mark="failed" attrs={{ "data-sum-failed-check": view.refused.checkId }}>{tr(locale, "orchClass_sandbox")}</Row> : null);
  const ownList = waiting && ["awaiting_checks_decision", "check_needs_permissions", "awaiting_finish_confirmation"].includes(view.reason ?? ""); // drawn by their rows only (mock-ups 05, 12, 14)
  const shownRows = view.reason === "awaiting_checks_decision" && ownList
    ? <><Row label={t(locale, "orchRowPlanApproved")} mark="done" attrs={{ "data-pause-row": "plan" }} /><Row label={t(locale, "orchRowChecksProposal")} mark="waiting" attrs={{ "data-pause-row": "checks" }}>{t(locale, "orchRowWait_decision")}</Row></>
    : refusedRows();
  const rowsKind = view.reason === "awaiting_checks_decision" && ownList ? "pause" : "failed-checks";
  if (list) return <dl className="orch-kv orch-kv--pause" data-orch-pause-list>{stageRows()}</dl>;
  const person = personDecisionsLine(locale, view);
  const hasPlanDoc = planShas.length > 0 || records.some((r) => r.type.startsWith("decomposition."));
  return (
    <div className="orch-summary-view" data-orch-run-summary data-outcome={outcome} data-incomplete={incomplete ? "yes" : "no"}>
      {!(ownList && view.reason !== "awaiting_finish_confirmation") && <dl className="orch-kv orch-kv--status" data-sum="outcome">
        {stagesText && <Row label={t(locale, "orchSum_stages")} mark={m.complete && m.stageCounts && m.stageCounts.done === m.stageCounts.total ? "done" : "idle"}
          dd={{ "data-sum-stage-count": "", "data-partial": m.complete ? undefined : "yes" }}>{stagesText}</Row>}
        {checksText && <Row label={t(locale, "orchSum_checks")} mark={m.checks.length === 0 ? "idle" : m.complete && m.checkCounts.passed === m.checkCounts.total ? "done" : "idle"}
          dd={{ "data-sum-check-count": "", "data-checks-known": m.checksKnown ? "yes" : "no", ...(outcome === "completed_no_checks" ? { "data-sum-no-checks": "" } : {}) }}>{checksText}</Row>}
        {finished && <Row label={reviewed ? t(locale, "orchSumReviewFinal") : t(locale, "orchResult")} mark={reviewed ? "done" : outcome === "failed" ? "failed" : outcome === "paused" || outcome === "active" ? "paused" : "idle"}
          dd={{ "data-sum-outcome": outcome, "data-orch-proof": outcome, "data-orch-result": m.finalVerdict ?? undefined }}>{reviewed ? t(locale, "orchSumAccepted") : said(`orchSumOutcome_${outcome}`)}</Row>}
      </dl>}
      {shownRows && (ownList ? view.reason !== "awaiting_finish_confirmation" : failedChecks.length > 0) && (
        <dl className="orch-kv orch-kv--pause" data-sum={rowsKind} data-sum-failed-checks={rowsKind === "failed-checks" ? "" : undefined}>{shownRows}</dl>
      )}
      {person && <p className="orch-hint orch-hint--warn" data-sum-person>{person}</p>}

      {alerts}
      {finished && (m.finish || view.workMode || factChanges) && (
        <Section id="finish" title={t(locale, "orchSumFacts")} attrs={{ "data-orch-facts": "" }}>
          <dl className="orch-kv" data-orch-finish>
            {(m.finish ?? []).map((f) => (
              <Row key={f.step} label={t(locale, `orchSumRow_${f.step}` as TranslationKey)} attrs={{ "data-finish-step": f.step, "data-finish-status": f.asked ? finishStatus(f) : "not_asked" }}>
                {/* mock-up 17: a step that is done is its hash; any other state is said */}
                {f.step !== "qa" && f.asked && finishStatus(f) === "done" && f.commit ? null : <>{finishText(locale, f)}{f.commit ? " · " : ""}</>}{f.commit ? <code>{f.commit.slice(0, 7)}</code> : null}
              </Row>
            ))}
            {factChanges && facts.changes !== "unknown" && <Row label={t(locale, "orchSumRow_changes")} attrs={{ "data-fact": "changes" }}>{factChanges.value}</Row>}
            {view.workMode && (
              <Row label={t(locale, "orchSum_where")} attrs={{ "data-orch-where": view.workMode, title: view.workDir }}>
                {view.workMode === "worktree" && <><code>{progress?.branch ?? "?"}</code> · </>}<code>{view.workDir}</code>
              </Row>
            )}
          </dl>
        </Section>
      )}

      {!ownList && ((m.stages && m.stages.length > 0) || progress?.conditions || hasPlanDoc) && ( // a split that was refused has no stages, but its reasons are in the plan document
        <Section id="stages" title={finished || !m.stages?.length ? t(locale, "orchPlan") : undefined} aside={(finished || !m.stages?.length) &&
          <span className="orch-sum-block__aside">
            {planShas.map((sha, i) => <span key={sha} className={`orch-chip${i === planShas.length - 1 ? " orch-chip--on" : ""}`}>v{i + 1}</span>)}
            <button type="button" className="orch-textual" data-orch-open-doc="plan" onClick={() => onOpen("plan")}>{t(locale, "orchSumOpen")}</button>
          </span>}>
          <dl className="orch-kv">
            {(m.stages ?? []).map((st) => (
              <Row key={st.n} label={`${t(locale, "orchStage")} ${st.n}${st.title ? ` · ${st.title}` : ""}`} mark={st.state === "done" ? "done" : st.state === "not_done" ? "failed" : "idle"}
                attrs={{ "data-stage-state": st.state, "data-stage-n": String(st.n) }}>{st.state === "done" && m.complete ? t(locale, "orchSumStageShort_done") : st.state === "not_started" ? null : stageStateText(st)}{st.rounds > 1 ? ` · ${fill(t(locale, "orchSumRounds"), { n: st.rounds })}` : ""}</Row>
            ))}
            {m.openQuestion && <Row label={t(locale, "orchSumQuestionLead")} dd={{ "data-sum-question": "" }}>
              <Stored orch={orch} runId={runId} textRef={m.openQuestion} locale={locale} incomplete={incomplete}>{(text) => <>{text}</>}</Stored></Row>}
          </dl>
          {m.superseded.length > 0 && (
            <details className="orch-sum__superseded" data-sum-superseded>
              <summary>{t(locale, "orchSumSuperseded")} ({m.superseded.length})</summary>
              <ul>{m.superseded.map((st, i) => (
                <li key={i}>{stageLabel(st.n, st.title, st.plan)} — {st.verdict ? tr(locale, `orchVerdict_${st.verdict}`) : said(`orchSumStage_${st.state}`)}</li>
              ))}</ul>
            </details>
          )}
          {progress?.conditions && <Conditions orch={orch} runId={runId} c={progress.conditions} locale={locale} incomplete={incomplete} completion={progress.completion} />}
        </Section>
      )}

      {hasFindings && <Findings f={progress!.findings!} locale={locale} />}
      {legacyRemarks && (
        <Section id="remarks" title={t(locale, "orchSumDecisions")}>
          {current && <p className="orch-hint" data-sum-current-review={current.verdict ?? ""}>{fill(said(m.complete ? "orchSumCurrentReview" : "orchSumCurrentReviewPartial"), { stage: stageLabel(current.stage, current.title) })} · {verdictText(current.verdict)}</p>}
          {m.finalFindings ? findingsList(m.finalFindings, "data-sum-findings") : findingsList(current!.findings!, "data-sum-findings")}
          {history.length > 0 && (
            <details className="orch-sum__history" data-sum-review-history>
              <summary>{fill(t(locale, "orchSumHistory"), { n: history.length })}</summary>
              <ul>{history.map((rv) => (
                <li key={rv.seq} data-review-state={rv.state}>
                  {stageLabel(rv.stage, rv.title, rv.plan)} · {verdictText(rv.verdict)} — <i>{tr(locale, `orchSumReview_${rv.state}`)}</i>
                  {rv.findings && findingsList(rv.findings, "data-sum-old-findings")}
                </li>
              ))}</ul>
            </details>
          )}
        </Section>
      )}

      {finished && middle}

      {finished && (hasReport || hasExport) && (
        <Section id="result" title={t(locale, "orchSumResult")}>
          {hasReport && <dl className="orch-kv"><Row label={t(locale, "orchSumExecReport")}>
            <button type="button" className="orch-textual" data-orch-open-doc="result" onClick={() => onOpen("result")}>{t(locale, "orchSumOpen")}</button></Row></dl>}
          <ReviewExport locale={locale} view={view} />
        </Section>
      )}
    </div>
  );
}

// F4 (T-9, §10): the review export of a completed board task's run — its paths with «Copy the path», or why there is
// none (the run completed with nothing to commit); nothing when the run was not asked for one
function ReviewExport({ locale, view }: { locale: LocaleId; view: OrchestrationRunView }): React.JSX.Element | null {
  const [copied, copy] = useCopy();
  const [which, setWhich] = useState<string | null>(null);
  if (view.export === undefined || (view.export === null && view.status !== "completed")) return null;
  return (
    <div data-orch-export={view.export ? "paths" : "none"}>
      <h4>{t(locale, "orchExportPaths")}</h4>
      {view.export ? (
        <ul>
          {[view.export.json, view.export.md].map((path) => (
            <li key={path} data-orch-export-path={path}>
              <code>{path}</code>{" "}
              <button type="button" data-orch-export-copy={path} onClick={() => { setWhich(path); void copy(path); }}>
                {which === path ? t(locale, copyKey(copied, "orchExportCopy", "docCopied")) : t(locale, "orchExportCopy")}
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="orch-hint">{t(locale, "orchExportNone")}</p>}
    </div>
  );
}

// biome-ignore-start lint/suspicious/noArrayIndexKey: a document's lines are built once, in order, never reordered
function RunDocView({ doc, kind, locale, onNote }: { doc: RunDoc; kind: "plan" | "result"; locale: LocaleId; onNote?: (markdown: string) => void }): React.JSX.Element {
  const [copied, copy] = useCopy();
  const [noted, setNoted] = useState(false);
  useEffect(() => {
    if (!noted) return;
    const timer = window.setTimeout(() => setNoted(false), 2000);
    return () => window.clearTimeout(timer);
  }, [noted]);
  const md = toMarkdown(doc);
  const body = (lines: RunDoc["sections"][number]["lines"], at: number[]) => lines.map((l, j) => { const i = at[j]; return l.kind === "item"
    ? <li key={i} data-doc-mark={l.mark ?? ""}>{l.mark ? <span className={`orch-doc__mark orch-doc__mark--${l.mark}`} aria-hidden="true" /> : null}{l.text}</li>
    : l.kind === "file"
      ? <section key={i} className="orch-doc__file" data-doc-file={l.path}><h5><code>{l.path}</code></h5>{l.note && <p className="orch-hint" data-doc-file-note>{l.note}</p>}{l.body !== null && <pre>{l.body}</pre>}</section>
      : <p key={i} className="orch-panel__text">{l.text}{l.said && <i className="orch-doc__said"> ({l.said})</i>}</p>; });
  // items of a section are one list; text and files stand between lists
  const group = (lines: RunDoc["sections"][number]["lines"]) => {
    const out: React.ReactNode[] = [];
    let items: RunDoc["sections"][number]["lines"] = [];
    let at: number[] = [];
    const flush = () => { if (items.length) out.push(<ul key={`u${out.length}`}>{body(items, at)}</ul>); items = []; at = []; };
    // a line's key is its position in the section
    lines.forEach((l, i) => { if (l.kind === "item") { items.push(l); at.push(i); } else { flush(); out.push(...body([l], [i])); } });
    flush();
    return out;
  };
  return (
    <article className="orch-doc" data-run-doc={kind}>
      <div className="orch-doc__actions">
        <button type="button" data-run-doc-copy onClick={() => copy(md)}>{t(locale, copyKey(copied, "docCopy", "docCopied"))}</button>
        {onNote && <button type="button" data-run-doc-note onClick={() => { onNote(md); setNoted(true); }}>{t(locale, noted ? "docOnCanvas" : "docToCanvas")}</button>}
      </div>
      <h3>{doc.title}</h3>
      <p className="orch-hint">{doc.asOf}</p>
      {doc.sections.map((s, i) => s.collapsed
        ? <details key={i} className="orch-doc__section"><summary>{s.heading}</summary>{group(s.lines)}</details>
        : <section key={i} className="orch-doc__section"><h4>{s.heading}</h4>{group(s.lines)}</section>)}
    </article>
  );
}
// biome-ignore-end lint/suspicious/noArrayIndexKey: see the start

// The documents a task created, exactly from the run's tree (their diff only as a fallback): the list again when the run
// moves (as the «Changes» tab); a file again when its tree changed (the tree's name and time, or the run's revision when
// main gives no time: last check, checkpoint, baseline) or its path; a restored text is read again every time. Entries of
// other trees are dropped. One call at a time. Skipped for a newer version's run (main gives no changes for it).
function useCreatedDocs(locale: LocaleId, runId: string, seq: number, skip: boolean): { docs: CreatedDocs; retry(): void } {
  const [docs, setDocs] = useState<CreatedDocs>(skip ? { state: "skipped" } : { state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const cache = useRef(new Map<string, CreatedFile>());
  const shown = useRef(0);
  useEffect(() => {
    if (skip) { setDocs({ state: "skipped" }); return; }
    // «loading» again when the tab was skipped, after an error, or on a repeat; a moving run keeps the list it shows
    const repeated = shown.current !== attempt;
    shown.current = attempt;
    setDocs((d) => (d.state === "skipped" || d.state === "error" || repeated ? { state: "loading" } : d));
    let live = true;
    const id = window.setTimeout(() => void (async () => {
      const ch = await outcomeOf(() => api().changes(runId));
      if (!live) return;
      if (ch.outcome.kind !== "accepted" || !ch.value) { setDocs({ state: "error", message: outcomeText(locale, ch.outcome) ?? "" }); return; }
      const picked = pickDocs(ch.value.files);
      const tree = `${ch.value.at}:${ch.value.atTs ?? `s${seq}`}`;
      for (const k of [...cache.current.keys()]) if (!k.startsWith(`${tree}:`)) cache.current.delete(k);
      const files: CreatedFile[] = [];
      for (const path of picked.paths) {
        const key = `${tree}:${path}`;
        let file = cache.current.get(key);
        if (!file) {
          const ok = async <T,>(call: () => Promise<OrchestrationResult<T>>): Promise<T | null> => {
            const r = await outcomeOf(call);
            return r.outcome.kind === "accepted" && r.value ? r.value : null;
          };
          file = await readCreatedFile(path, () => ok(() => api().file(runId, path)), () => ok(() => api().diff(runId, path)));
          if (!live) return;
          // a restored text is not kept: the next pass tries the exact read again
          if (file.why !== "unavailable" && !file.restored) cache.current.set(key, file);
        }
        files.push(file);
      }
      setDocs({ state: "ready", at: ch.value.at, files, more: picked.more });
    })(), 300);
    return () => { live = false; window.clearTimeout(id); };
  }, [locale, runId, seq, skip, attempt]);
  return { docs, retry: () => setAttempt((n) => n + 1) };
}

const splitRef = (r: OrchestrationHistoryRecord) => ((r.data.proposal ?? r.data.reasons ?? r.data.why) as TextRef | undefined)?.sha256;

function RunDocs({ kind, orch, runId, view, records, locale, task, take, seq, incomplete, onNote }: {
  kind: "plan" | "result"; orch: Orchestration; runId: string; view: OrchestrationRunView; records: readonly OrchestrationHistoryRecord[];
  locale: LocaleId; task: { key: string; title: string } | null; take: OrchestrationTake | null; seq: number; incomplete: boolean; onNote?: (markdown: string, source: { runId: string; doc: "plan" | "result" }) => void;
}): React.JSX.Element {
  const planRecords = useMemo(() => records.filter((r) => r.type === "plan.recorded"), [records]);
  // an executor's or reviewer's report is the ref of a finished turn (as summaryModel reads it)
  // E4 (stage-e-decomposition.md §10): a decomposition run's answers on the Plan tab
  const splitRecords = useMemo(() => records.filter((r) => r.type === "decomposition.proposed" || r.type === "decomposition.rejected" || r.type === "decomposition.whole"), [records]);
  const shas = useMemo(() => [
    ...planRecords.map((r) => (r.data.plan as TextRef | undefined)?.sha256),
    ...splitRecords.map(splitRef),
    ...records.filter((r) => r.type === "turn.finished").map((r) => (r.data.report as { ref?: TextRef } | undefined)?.ref?.sha256)
  ].filter((x): x is string => typeof x === "string"), [planRecords, records, splitRecords]);
  useEffect(() => { for (const sha of shas) orch.loadText(runId, sha); }, [orch.loadText, shas, runId]);
  const textOf = (sha: string): Loaded<string> => { const s = orch.texts[sha]; return s?.status === "ready" ? s.text : s?.status === "error" ? "error" : "loading"; };
  const goalStored = useStored(orch, runId, (records.find((r) => r.type === "run.created")?.data.goal as TextRef | undefined)?.sha256);
  const goalText = goalStored.text;
  const textsKey = shas.map((sha) => `${sha}:${orch.texts[sha]?.status ?? ""}`).join(",");
  const created = useCreatedDocs(locale, runId, seq, kind !== "result" || !!view.newer);
  // biome-ignore lint/correctness/useExhaustiveDependencies: textsKey stands for orch.texts
  const doc = useMemo(() => {
    const model = summaryModel(view, records, {
      planTitles: (sha) => { const s = orch.texts[sha]; return s?.status === "ready" ? parsePlan(s.text).map((p) => p.title) : null; },
      complete: !incomplete
    });
    const plans: PlanEntry[] = planRecords.map((r, i) => {
      const sha = (r.data.plan as TextRef | undefined)?.sha256;
      const raw = sha ? textOf(sha) : "error";
      let text: Loaded<PlanJson> = raw === "loading" || raw === "error" ? raw : "error";
      if (raw !== "loading" && raw !== "error") {
        try { const p = JSON.parse(raw) as { question?: unknown }; text = { stages: parsePlan(raw), question: typeof p.question === "string" ? p.question : null }; } catch { text = "error"; }
      }
      return { version: i + 1, firstStage: typeof r.data.firstStage === "number" ? r.data.firstStage : 1, text };
    });
    const g = goalText === null ? (goalStored.status === "error" || goalStored.status === "none" ? null : "loading") : parseGoal(goalText);
    const input: DocInput = {
      view, model, task, plans, take,
      split: splitRecords.map((r) => ({ kind: r.type.slice(14) as "proposed" | "rejected" | "whole", text: textOf(splitRef(r) ?? "") })), asOf: new Date().toISOString(), report: textOf,
      goal: g === "loading" ? "loading" : g ? { text: typeof g.text === "string" ? g.text : null } : { text: goalText }
    };
    return kind === "plan" ? planDoc(input, locale) : resultDoc(input, created.docs, locale);
  }, [kind, view, records, planRecords, splitRecords, textsKey, goalText, goalStored.status, task, take, created.docs, incomplete, locale]);
  return <>
    <RunDocView doc={doc} kind={kind} locale={locale} onNote={onNote && ((md) => onNote(md, { runId, doc: kind }))} />
    {kind === "result" && (created.docs.state === "error" || (created.docs.state === "ready" && created.docs.files.some((f) => f.why === "unavailable"))) && <button type="button" data-run-doc-retry onClick={created.retry}>{t(locale, "orchRepeat")}</button>}
  </>;
}

// One block of the summary tab. lazy: the content is drawn only while open (the plan's and the result's texts are read
// from the journal's store, which opening the panel must not do). The caller owns `open`: a view can open it.
function Sect({ id, title, open, lazy, onToggle, elRef, children }: {
  id: PanelSection; title: string; open: boolean; lazy: boolean; onToggle(open: boolean): void;
  elRef(el: HTMLDetailsElement | null): void; children: React.ReactNode;
}): React.JSX.Element {
  return (
    <details ref={elRef} className="orch-sect" data-orch-section={id} open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>{title}</summary>
      {(open || !lazy) && <div className="orch-sect__body">{children}</div>}
    </details>
  );
}

// ---------- the panel ----------

// runId: the run shown (a link's latest, or one opened from a workspace's history). onNewGoal: only for a link's
// latest run whose link still exists.
type RunPanelProps = {
  orch: Orchestration; runId: string | null; locale: LocaleId; panel: PanelState;
  onClose(): void; onNewGoal: (() => void) | null; onProjectSettings?: () => void; onView(next: PanelView & { runId?: string }): void;
  liveRunIds?: readonly string[]; // the live runs of the panel's link (at most four): the switch in the header shows from two
  task?: { key: string; title: string } | null; // B2: the board task of the run — the summary starts with it
  onNoteFromText?: (markdown: string, source: { runId: string; doc: "plan" | "result" }) => void; // «To the canvas» of the Plan and Result tabs
};

// «Забрать результат»: a new branch in the project (the safe one), or the patch applied to the working folder when it fits
// the files as they are now, or the «Changes» tab. Done by the application; the outcome in words, never git's alone.
function TakeResult({ locale, runId, take, onTake, onChanges }: {
  locale: LocaleId; runId: string; take: OrchestrationTake; onTake(next: OrchestrationTake): void; onChanges(): void;
}): React.JSX.Element {
  const [name, setName] = useState(take.suggested);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ kind: OrchestrationTakeOutcome["result"] | "error"; text: string } | null>(null);
  const act = async (input: { action: "branch"; name: string } | { action: "apply" }): Promise<void> => {
    setBusy(true);
    const r = await api().takeResult(runId, input).catch((e: unknown) => ({ ok: false as const, code: "transport", message: String(e) }));
    setBusy(false);
    if (!r.ok) { setSaid({ kind: "error", text: r.code === "transport" ? t(locale, "orchTransportError") : `${tr(locale, `orchError_${r.code}`)} ${r.message}` }); return; }
    setSaid({ kind: r.value.result, text: takeOutcomeText(locale, r.value, input.action === "branch" ? input.name : name) });
    if (r.value.result === "branch_exists") setName(r.value.take.suggested);
    onTake(r.value.take);
  };
  const worktree = take.mode === "worktree";
  return (
    <div className="orch-take" data-orch-take={take.from}>
      <h4>{t(locale, "orchTakeOpen")}</h4>
      <p className="orch-take__from" data-orch-take-from={take.from}>{takeSourceText(locale, take)}</p>
      {worktree && <p className="orch-hint" data-orch-take-run-branch={take.runBranch ?? ""}>{t(locale, "orchTakeWorktree").replace("{branch}", take.runBranch ?? "?")}</p>}
      <label className="orch-field orch-take__name">
        <span>{t(locale, worktree ? "orchTakeNameWorktree" : "orchTakeName")}</span>
        <input type="text" spellCheck={false} value={name} data-orch-take-name onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="orch-take__actions">
        <button type="button" className="orch-primary" data-orch-primary="take_branch" data-orch-take-branch disabled={busy || !take.allowed || !name.trim() || (!worktree && !!take.branch) || (worktree && take.branch?.name === name.trim())}
          onClick={() => void act({ action: "branch", name: name.trim() })}>{t(locale, worktree ? "orchTakeBranchWorktree" : "orchTakeBranch")}</button>
        <button type="button" data-orch-take-apply disabled={busy || !take.allowed || !!take.applied} onClick={() => void act({ action: "apply" })}>{t(locale, "orchTakeApply")}</button>
        <button type="button" data-orch-take-changes onClick={onChanges}>{t(locale, "orchTakeChanges")}</button>
      </div>
      <small className="orch-hint">{t(locale, "orchTakeHint")}</small>
      {busy && <p className="orch-hint">{t(locale, "orchSending")}</p>}
      {said && <p className={["unavailable", "error"].includes(said.kind) ? "dialog-error" : ["conflict", "branch_exists", "invalid_name"].includes(said.kind) ? "orch-hint orch-hint--warn" : "orch-take__done"}
        role={said.kind === "conflict" ? "alert" : "status"} data-orch-take-outcome={said.kind}>{said.text}</p>}
    </div>
  );
}

export function RunPanel(props: RunPanelProps): React.JSX.Element {
  const newer = props.runId ? props.orch.runs[props.runId]?.view.newer : undefined;
  // a newer journal that declared minReaderVersion this build reads: the whole panel, read-only
  return newer && !newer.compatible
    ? <NewerRunPanel orch={props.orch} runId={props.runId!} locale={props.locale} onClose={props.onClose} newer={newer} />
    : <CurrentRunPanel {...props} />;
}

// "Release link" for a link held by a newer version's run (acceptance-review-spec.md §2.2.1):
// asked to confirm first, then one command whose commandId is kept, so a repeat after a lost answer is the same release.
export function ReleaseNewerLink({ orch, linkId, runId, locale }: { orch: Orchestration; linkId: string; runId: string; locale: LocaleId }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commandId = useRef<string | null>(null);
  const release = async (): Promise<void> => {
    commandId.current ??= crypto.randomUUID();
    setSending(true);
    setError(null);
    const r = await orch.releaseNewerLink({ commandId: commandId.current, linkId, runId });
    setSending(false);
    const text = outcomeText(locale, r.outcome);
    if (text) setError(text);
    else setConfirming(false);
  };
  return (
    <div className="orch-release" data-orch-release={linkId}>
      {!confirming
        ? <button type="button" data-orch-release-link onClick={() => setConfirming(true)}>{t(locale, "orchReleaseLink")}</button>
        : (
          <div className="orch-hint orch-hint--warn" role="alertdialog" aria-label={t(locale, "orchReleaseLink")} data-orch-release-confirm>
            <span>{t(locale, "orchReleaseConfirm")}</span>
            <span className="orch-form__actions">
              <button type="button" className="orch-danger" disabled={sending} data-orch-release-do onClick={() => void release()}>{t(locale, "orchReleaseDo")}</button>
              <button type="button" disabled={sending} onClick={() => { setConfirming(false); setError(null); }}>{t(locale, "orchCancel")}</button>
            </span>
          </div>
        )}
      {error && <p className="dialog-error" role="alert" data-orch-release-error>{error}</p>}
    </div>
  );
}
const linkOfRun = (orch: Orchestration, runId: string): string | null => orch.canvas.links.find((l) => l.runIds.includes(runId))?.linkId ?? null;

// A run a newer version of the application wrote (acceptance-review-spec.md §2.2): its goal and its records as they are
// (only the hash chain is checked, nothing is interpreted), and no action but closing.
function NewerRunPanel({ orch, runId, locale, onClose, newer }: {
  orch: Orchestration; runId: string; locale: LocaleId; onClose(): void; newer: NonNullable<OrchestrationRunView["newer"]>;
}): React.JSX.Element {
  const linkId = linkOfRun(orch, runId);
  const [journal, setJournal] = useState<RunJournalState>({ records: [], next: 0, status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger
  useEffect(() => {
    let live = true;
    let cur: RunJournalState = { records: [], next: 0, status: "loading" };
    void readJournal((from) => api().history(runId, from, 200), () => cur, (j) => { cur = j; if (live) setJournal(j); });
    return () => { live = false; };
  }, [runId, attempt]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const link = orch.canvas.links.find((l) => l.runIds.includes(runId));
  const cardOf = (id: string | undefined) => orch.canvas.agents.find((x) => x.agentId === id);
  const leadCard = cardOf(link?.fromAgentId), execCard = cardOf(link?.toAgentId);
  const project = leadCard?.project ? leadCard.project.split(/[\\/]/).filter(Boolean).at(-1) ?? null : null;
  const pair = leadCard && execCard ? `${providerName(leadCard.provider)} → ${providerName(execCard.provider)}` : null;
  // R6-A (mock-up 13): the header and the zone as the panel's own - "Read only", the words, "Release link" and "Copy id"
  const [copied, copy] = useCopy();
  return (
    <aside className="orch-panel" data-interactive="true" data-wheel-owner="local" data-canvas-wheel-priority="local"
      aria-label={t(locale, "orchRun")} data-orch-newer={newer.version}>
      <header className="orch-panel__header">
        <div className="orch-panel__title">
          <strong>{t(locale, "orchRun")}{project ? ` · ${project}` : ""}</strong>
          <code title={runId}>{runId.slice(0, 8)}{pair ? ` · ${pair}` : ""}</code>
        </div>
        <button className="orch-panel__close" type="button" onClick={onClose} aria-label={t(locale, "orchClose")}><UiIcon name="close" size={16} /></button>
      </header>
      <section className="orch-zone orch-zone--neutral" role="status" data-orch-summary data-headline="newer_version" data-orch-zone="newer_version">
        <div className="orch-zone__label"><span data-orch-label>{t(locale, "orchReadOnly")}</span></div>
        <div className="orch-zone__headline">
          <strong>{newer.fallback ? t(locale, "orchNewerFallbackTitle") : t(locale, "orchNewerTitle")}</strong>
          <p className="orch-zone__why">{newer.fallback
            ? t(locale, "orchNewerFallback").replace("{line}", String(newer.fallback.line)).replace("{code}", newer.fallback.code)
            : t(locale, "orchNewerHint")}</p>
        </div>
        {newer.chain !== "ok" && <p className="orch-proposal__lost" data-orch-newer-chain={newer.chain}>{t(locale, "orchNewerChain")}</p>}
        {newer.fallback && <span hidden data-orch-newer-fallback={newer.fallback.code}><b data-orch-newer-fallback-title>{t(locale, "orchNewerFallbackTitle")}</b></span>}
        <div className="orch-panel__actions orch-zone__actions" data-orch-actions>
          {linkId && <ReleaseNewerLink orch={orch} linkId={linkId} runId={runId} locale={locale} />}
          <button type="button" data-orch-zone-action="copy_id" onClick={() => copy(runId)}>{t(locale, copyKey(copied, "orchZone_copyId", "docCopied"))}</button>
        </div>
      </section>
      <div className="orch-panel__body">
        <section className="orch-panel__section" data-orch-newer-goal>
          <h4>{t(locale, "orchNewer_goal")}</h4>
          <p className="orch-panel__text">{newer.goal ?? t(locale, "orchNewerNoGoal")}</p>
        </section>
        <section className="orch-panel__section">
          <h4>{t(locale, "orchNewer_records")}{journal.records.length > 0 ? ` · ${journal.records.length}` : ""}</h4>
          <ol className="orch-history" data-orch-newer-history>
            {journal.records.map((r) => (
              <li key={r.seq} data-history-seq={r.seq}><time>{new Date(r.ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time> <code>{r.type}</code></li>
            ))}
          </ol>
          {journal.status === "error" && (
            <p className="dialog-error" role="alert">{t(locale, "orchSumLoadFailed")} <button type="button" onClick={() => setAttempt((n) => n + 1)}>{t(locale, "orchRepeat")}</button></p>
          )}
        </section>
      </div>
    </aside>
  );
}

// UX audit 2026-10-05, Н9: what the run spends — model calls and the tokens each CLI reported (never money)
function costText(locale: LocaleId, cost: Cost, reviewer: boolean): string {
  const roles: CostRole[] = reviewer ? ["lead", "executor", "reviewer"] : ["lead", "executor"];
  const calls = roles.reduce((n, r) => n + cost.calls[r], 0);
  const tok = roles.reduce((n, r) => n + (cost.tokens[r] ? cost.tokens[r]!.input + cost.tokens[r]!.output : 0), 0);
  return t(locale, "orchCostTotalValue").replace("{calls}", String(calls)).replace("{tokens}", `${cost.partial ? `${t(locale, "orchCostAtLeast")} ` : ""}${tokensText(locale, tok)}`);
}

// UX audit 2026-10-05, Н7: the limit pause — each limit's value and what is used of it (limitRows), the new value with
// its unit, and «Raise the limit and continue» as the main action. The limit the run stopped at is chosen first.
function RaiseLimit({ locale, cost, budget, rounds, sending, onRaise }: {
  locale: LocaleId; cost: Cost | null; rounds: number | null; budget: NonNullable<NonNullable<OrchestrationRunView["progress"]>["budget"]> | null; sending: boolean;
  onRaise(kind: OrchestrationLimitKind, value: number): void;
}): React.JSX.Element {
  const rows = cost && budget ? limitRows(cost, budget, rounds) : [];
  const nowOf = (k: OrchestrationLimitKind) => rows.find((r) => r.kind === k)?.now ?? null;
  const proposed = (k: OrchestrationLimitKind) => { const c = nowOf(k); return c !== null ? String(Math.ceil(c * 1.5)) : ""; }; // half as much again
  const [kind, setKind] = useState<OrchestrationLimitKind>(cost?.reached ?? "turns");
  const [value, setValue] = useState(() => proposed(cost?.reached ?? "turns"));
  const current = nowOf(kind);
  const unit = t(locale, kind === "runMs" ? "orchLimitUnit_min" : kind === "turns" ? "orchLimitUnit_turns" : "orchLimitUnit_times");
  const n = Number(value);
  // main refuses a time limit that is already over: the new total must exceed the time spent
  const spent = kind === "runMs" && cost?.elapsedMs != null ? Math.ceil(cost.elapsedMs / 60_000) : null;
  const tooSmall = kind === "runMs" && cost?.elapsedMs != null && Number.isInteger(n) && n * 60_000 <= cost.elapsedMs;
  const valid = Number.isInteger(n) && n > 0 && (current === null || n > current) && !tooSmall;
  const name = t(locale, `orchLimit_${kind}` as TranslationKey);
  return (
    <div className="orch-limit" data-orch-limit>
      {rows.length > 0 && (
        <dl className="orch-kv orch-limit__table">
          {[...rows.filter((r) => r.reached || r.kind === "turns" || r.kind === "runMs" || (r.used ?? 0) > 0)].sort((a, b) => ["turns", "roundsPerStage", "runMs", "replans"].indexOf(a.kind) - ["turns", "roundsPerStage", "runMs", "replans"].indexOf(b.kind)).map((r) => { // mock-up 07: turns, rounds, time
            const time = r.kind === "runMs"; // mock-up 07: the time as «1 ч 12 м / 4 ч»
            const fmt = (n: number) => (time ? spanText(locale, n * 60_000) : String(n));
            return (
              <Row key={r.kind} label={time ? t(locale, "orchSumTime") : t(locale, `orchLimit_${r.kind}` as TranslationKey)}
                attrs={{ "data-limit-kind": r.kind, "data-limit-reached": r.reached ? "" : undefined, className: `orch-kv__row${r.reached ? " orch-limit__reached" : ""}` }}>
                <span data-limit-used>{r.used === null ? "—" : fmt(r.used)}</span> / <span data-limit-now>{fmt(r.now)}</span>
              </Row>
            );
          })}
        </dl>
      )}
      {/* mock-up 07: the limit the run stopped at is the one to raise; the choice of another one only where none stopped it */}
      {!cost?.reached && (
        <label className="orch-field"><span>{t(locale, "orchLimitWhich")}</span>
          <select value={kind} onChange={(e) => { const k = e.target.value as OrchestrationLimitKind; setKind(k); setValue(proposed(k)); }}>
            {LIMIT_KINDS.map((k) => <option key={k} value={k}>{t(locale, `orchLimit_${k}` as TranslationKey)}</option>)}
          </select></label>
      )}
      <label className="orch-field"><span>{current !== null ? fill(t(locale, "orchLimitNewOf"), { name, n: current }) : `${name} · ${t(locale, "orchLimitNew").toLocaleLowerCase(locale)}`}</span>
        <input type="number" min={1} value={value} data-orch-limit-value aria-label={`${name}, ${unit}`} onChange={(e) => setValue(e.target.value)} /></label>
      {!valid && value !== "" && current !== null && <small className="orch-hint orch-hint--warn" data-orch-limit-invalid>{t(locale, tooSmall ? "orchZone_limitElapsed" : "orchLimitMore").replace("{now}", String(tooSmall ? spent : current))}</small>}
      <div className="orch-panel__actions orch-form__submit">
        <button type="button" className="orch-primary" data-orch-primary="raise_limit" data-orch-raise
          disabled={sending || !valid} onClick={() => onRaise(kind, kind === "runMs" ? n * 60_000 : n)}>{t(locale, "orchRaiseLimitContinue")}</button>
      </div>
    </div>
  );
}

function CurrentRunPanel({ orch, runId, locale, panel, onClose, onNewGoal, onProjectSettings, onView, task, onNoteFromText, liveRunIds }: RunPanelProps): React.JSX.Element {
  const state = runId ? orch.runs[runId] ?? null : null;
  const view: OrchestrationRunView | null = state?.view ?? null;
  const activity = (runId && orch.activity[runId]) || { entries: [], gaps: [], firstId: 0, status: "loading" as const, resyncs: 0 };
  // The journal as useOrchestration reads it for every watched run: one read, shared with the cards and the widget.
  const journal = runId ? orch.journals[runId] : undefined;
  const records = journal?.records ?? NO_RECORDS;
  const d: RunDigest = useMemo(() => digest(records), [records]);
  const planText = useText(orch, runId, d.plan?.sha256);
  const questionText = useText(orch, runId, d.question?.text.sha256);
  const goalText = useText(orch, runId, d.goal?.sha256);
  const reportText = useText(orch, runId, d.lastExecuteReport?.sha256);
  const plan = useMemo(() => (planText ? parsePlan(planText) : []), [planText]);
  // A replan numbers its stages from firstStage on (the accepted ones before it keep their numbers).
  const planFirst = useMemo(() => {
    const f = [...records].reverse().find((r) => r.type === "plan.recorded")?.data.firstStage;
    return typeof f === "number" ? f : 1;
  }, [records]);
  const planTotal = plan.length ? planFirst - 1 + plan.length : 0;
  const goal = useMemo(() => { try { return goalText ? JSON.parse(goalText) as { limits?: Record<string, number>; createdAt?: number } : null; } catch { return null; } }, [goalText]);
  const reportedDone = useMemo(() => { try { const r = reportText ? JSON.parse(reportText) as { done?: unknown } : null; return typeof r?.done === "boolean" ? r.done : null; } catch { return null; } }, [reportText]);
  // mock-up 07: the rounds the stage in hand has used (the journal counts them per turn)
  const stageRounds = useMemo(() => records.reduce((max, r) => (r.type === "orch.turn" && r.data.stage === view?.stage && typeof r.data.round === "number" ? Math.max(max, r.data.round) : max), 0) || null, [records, view?.stage]);
  const lines = useMemo(() => historyLines(records), [records]); // mock-up 20: in the order they happened
  const now = useNow();
  const [expanded, setExpanded] = useState(false);
  // The run ended while the person watched another tab: offer the summary, never switch or scroll by itself.
  const status = view?.status ?? null;
  const lastStatus = useRef({ runId, status });
  const [endedHere, setEndedHere] = useState(false);
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = { runId, status };
    if (was.runId === runId && was.status && status && !TERMINAL_STATUSES.includes(was.status) && TERMINAL_STATUSES.includes(status)) setEndedHere(true);
  }, [status, runId]);
  useEffect(() => { if (panel.tab === "summary") setEndedHere(false); }, [panel.tab]);
  // The summary's sections: the overview is open, the plan and the result are read only when opened (no text read, no
  // created files listed before). A section named by the view (a board button, «Open plan») is opened and brought into
  // view once per request.
  const [opened, setOpened] = useState<Record<PanelSection, boolean>>({ overview: true, plan: panel.section === "plan", result: panel.section === "result" });
  const sectionEls = useRef<Partial<Record<PanelSection, HTMLDetailsElement | null>>>({});
  const sectionEl = (id: PanelSection) => (el: HTMLDetailsElement | null) => { sectionEls.current[id] = el; };
  const toggleSection = (id: PanelSection, open: boolean): void => setOpened((o) => (o[id] === open ? o : { ...o, [id]: open }));
  const [jump, setJump] = useState<{ section: PanelSection; n: number } | null>(null);
  // The panel stays mounted when the shown run changes (the live-run switch, a chip pick): what belongs to the old run goes.
  const shownRun = useRef(runId);
  useEffect(() => {
    if (shownRun.current === runId) return;
    shownRun.current = runId;
    setEndedHere(false); setOpened({ overview: true, plan: false, result: false }); setJump(null);
    setAnswer(""); setClarify(""); setTake(null); setOffline(false); setProgressNote(null); setTakeOpen(null); setChangedFiles(null); setNotice(null);
    // a pick made in the panel keeps its focus on the chosen run's button (a remount would drop it to the page)
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest("[data-orch-runs]")) summary.current?.closest("aside")?.querySelector<HTMLElement>(`[data-orch-run-pick="${runId}"]`)?.focus({ preventScroll: true });
  }, [runId]);
  const reveal = useCallback((id: PanelSection): (() => void) => {
    setOpened((o) => (o[id] ? o : { ...o, [id]: true }));
    const raf = window.requestAnimationFrame(() => {
      const el = sectionEls.current[id];
      el?.scrollIntoView({ block: "start" });
      // the button that asked for it is gone: the focus goes to the opened section, not to the page body
      if (!document.activeElement || document.activeElement === document.body) el?.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: panel.focus is the trigger: every request reveals its section
  useEffect(() => (panel.tab === "summary" && panel.section ? reveal(panel.section) : undefined), [panel.tab, panel.section, panel.focus, reveal, !!view]);
  useEffect(() => (jump ? reveal(jump.section) : undefined), [jump, reveal]);
  const openSection = (section: PanelSection): void => { onView({ tab: "summary", section }); setJump((j) => ({ section, n: (j?.n ?? 0) + 1 })); };

  const [sending, setSending] = useState(false);
  // main's refusal in words (notice) and a lost connection (offline) are different things: the first is an answer, the second is not
  const [notice, setNotice] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [progressNote, setProgressNote] = useState<string | null>(null);
  const [copied, copy] = useCopy();
  const copiedWhich = useRef<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [clarify, setClarify] = useState("");
  const [changedFiles, setChangedFiles] = useState<number | null>(null);
  // «Забрать результат»: a separate copy or worktree, a run that is not working now
  const takeable = !!view && !view.newer && (view.workMode === "copy" || view.workMode === "worktree") && ["completed", "stopped", "paused"].includes(view.status);
  const [take, setTake] = useState<OrchestrationTake | null>(null);
  // the take panel of the run it was opened for; asked again on each revision (the run may have gone on)
  const [takeOpen, setTakeOpen] = useState<string | null>(null);
  const revision = view?.revision ?? 0;
  useEffect(() => {
    if (!takeable || !runId || revision < 0) { setTake(null); return; }
    let live = true;
    void api().take(runId).then((r) => { if (live) setTake(r.ok ? r.value : null); }, () => {});
    return () => { live = false; };
  }, [takeable, runId, revision]);
  const summary = useRef<HTMLElement>(null);
  const answerBox = useRef<HTMLTextAreaElement>(null);
  const answerId = useId();
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    // an open danger question takes the Esc first (its own capture listener cancels it); the panel stays
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape" && !document.querySelector("[data-orch-confirm]")) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Every "open" (also of the panel that is already open): the pinned summary gets focus and a short highlight, the
  // answer field first when a question waits. Nothing else is scrolled: the reader's place in a tab stays.
  // biome-ignore lint/correctness/useExhaustiveDependencies: panel.focus is the trigger: every open focuses the summary
  useEffect(() => {
    (answerBox.current ?? summary.current?.querySelector<HTMLElement>(`[data-orch-form] :is(${FIRST_CHOICE})`) ?? summary.current)?.focus({ preventScroll: true });
    summary.current?.scrollIntoView({ block: "nearest" });
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), 1200);
    return () => window.clearTimeout(id);
  }, [panel.focus]);
  // A waiting request (or the lead's question) is brought into the summary's view whenever the panel is opened or a new
  // one arrives: its top goes to the top of the summary when it would not fit below; its buttons stay pinned (CSS).
  const waitingId = state?.view.permission?.requestId ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: panel.focus and waitingId are triggers: bring a waiting request into view
  useEffect(() => {
    const box = summary.current;
    const block = box?.querySelector<HTMLElement>("[data-orch-permission], [data-orch-question]");
    if (!box || !block) return;
    const b = box.getBoundingClientRect(), r = block.getBoundingClientRect();
    if (r.bottom > b.bottom || r.top < b.top) box.scrollTop += r.top - b.top - 8;
    if (!answerBox.current) block.querySelector<HTMLElement>("input, select, textarea, button:not(:disabled)")?.focus({ preventScroll: true });
  }, [panel.focus, waitingId]);

  // The count of changed files for the result facts (the list itself is in the Changes tab).
  // biome-ignore lint/correctness/useExhaustiveDependencies: state.seq is the trigger: recount the changed files when the run moves
  useEffect(() => {
    if (!runId) return;
    let live = true;
    const id = window.setTimeout(() => {
      void api().changes(runId).then((r) => { if (live && r.ok) setChangedFiles(r.value.files.length); }).catch(() => {});
    }, 400);
    return () => { live = false; window.clearTimeout(id); };
  }, [runId, state?.seq]);

  // what goes on after a command that did not get an answer (a lost connection): Repeat keeps it, by the command id
  const afterOf = useRef(new Map<string, () => void | Promise<void>>());
  const deliver = async (req: PendingCommand, afterNew?: () => void | Promise<void>): Promise<boolean> => {
    const after = afterNew ?? afterOf.current.get(req.commandId);
    if (afterNew) afterOf.current.set(req.commandId, afterNew);
    setSending(true);
    setNotice(null);
    setOffline(false);
    setProgressNote(null);
    try {
      const { outcome } = await outcomeOf(() => api().command(req));
      if (outcome.kind === "transport") { setOffline(true); return false; }
      if (outcome.kind === "in_progress") { setProgressNote(t(locale, "orchInProgress")); return false; }
      afterOf.current.delete(req.commandId);
      orch.commands.settle(req);
      if (outcome.kind === "rejected" && outcome.code === "stale_revision") {
        await orch.refreshRun(req.runId);
        setNotice(t(locale, "orchStaleRefreshed"));
        return false;
      }
      const text = outcomeText(locale, outcome);
      if (text) { setNotice(text); return false; }
      await after?.(); // sending holds until the whole chain (raise the limit, then resume) is done
      return true;
    } finally {
      setSending(false);
    }
  };
  const send = (action: RunAction, input: Parameters<typeof commandOf>[1] = {}, after?: () => void | Promise<void>): Promise<boolean> =>
    view ? deliver(orch.commands.request(view.runId, view.revision, commandOf(action, input)), after) : Promise.resolve(false);
  // D-018 (mock-up 10): the person's choices go together; one command per item, each at the revision the run has by then
  const sendPeople = async (list: Omit<OrchestrationPersonDecide, "kind">[]): Promise<void> => {
    let accepted = 0;
    // main resumes the run after the first accepted decision: what was not taken waits for the next pause (D-027)
    const rest = () => { if (accepted > 0 && accepted < list.length) setNotice(fill(t(locale, "orchPersonPartial"), { n: accepted, m: list.length })); };
    for (const [i, person] of list.entries()) {
      const fresh = i === 0 ? view : await api().get(view!.runId).then((r) => (r.ok ? r.value.view : null)).catch(() => null);
      if (!fresh) return rest();
      // the decisions the person saw (their runKey), never a newer set the run moved to meanwhile: main refuses a stale
      // key, and the first refusal stops the rest
      if (fresh.decisions && fresh.decisions.runKey !== person.runKey) return rest();
      if (!(await deliver(orch.commands.request(fresh.runId, fresh.revision, commandOf("person_decide", { person }))))) return rest();
      accepted += 1;
    }
  };
  const unknown = runId ? orch.commands.pending(runId) : [];
  // a refusal, a lost connection or a command still in progress shows above the buttons: bring it into view when it appears
  // biome-ignore lint/correctness/useExhaustiveDependencies: the three notices are the triggers
  useEffect(() => {
    summary.current?.querySelector("[data-orch-refused], [data-orch-offline], [data-orch-in-progress]")?.scrollIntoView({ block: "nearest" });
  }, [notice, offline, progressNote, unknown.length]);
  // «Поднять лимит и продолжить» (UX audit Н7): main records the new limit and leaves the run paused; the run goes on with
  // a resume at the revision the raise made (two commands, as the person would send them)
  const continueAfterRaise = async (): Promise<void> => {
    if (!view) return;
    const r = await api().get(view.runId).catch(() => null);
    const v = r?.ok ? r.value.view : null;
    if (v && v.status === "paused" && v.reason === "user_request") await deliver(orch.commands.request(v.runId, v.revision, commandOf("resume", {})));
  };

  const actions = view ? availableActions(view) : [];
  const has = (a: RunAction) => actions.includes(a);
  // On a platform without orchestration: every action shown, only Stop active.
  const available = orchestrationAvailableHere();
  const off = (a: RunAction) => !actionEnabled(a, available) || proposalBlocks(view, a);
  const entry = orchestrationEntry(available);
  const busy = view !== null && ACTIVE_STATUSES.includes(view.status);
  const open = state?.open ?? true;
  const lead = participantState("lead", view, activity.entries, open);
  const executor = participantState("executor", view, activity.entries, open);
  const reviewer = participantState("reviewer", view, activity.entries, open);
  const facts = resultFacts(view, d, changedFiles, reportedDone);
  const head = view ? runHeadline(view) : null;
  const active = view?.active ?? null;
  const workingRole: PanelRole | null = !active ? null : activeRole(view) as PanelRole;
  const workingState = workingRole === "lead" ? lead : workingRole === "executor" ? executor : workingRole === "reviewer" ? reviewer : null;
  const stageText = view?.stage ? `${t(locale, "orchStage")} ${view.stage}${planTotal ? ` / ${planTotal}` : ""}` : null;
  const who = !active ? t(locale, "orchNobodyNow")
    : active.kind === "check" ? `${t(locale, "orchCheckRunning")} (${active.checkId})${stageText ? ` · ${stageText}` : ""}`
      : active.kind === "prepare" ? t(locale, "orchCanvasPrepare")
        : active.kind === "finish" ? `${t(locale, "orchCanvasFinish")}: ${tr(locale, `orchFinishStep_${active.step}`)}`
          : `${roleName(locale, workingRole!)} — ${tr(locale, `orchPurpose_${active.purpose}`)}${stageText ? ` · ${stageText}` : ""} · ${workingState ? phaseText(locale, workingState, now) : ""}`;
  const cost = view ? costOf(view, activity.entries, now, activity.firstId) : null;
  const depsText = dependenciesText(locale, activity.entries);
  // The action zone: the model says what is offered; the panel only drops what it cannot do here (no settings dialog, no new goal)
  // and puts «Take the result» first where there is one to take (one main button).
  // R5a: the headline says who works on which stage (a working run) and that the final review accepted the goal (a completed one)
  const finalVerdict = useMemo(() => (view?.status === "completed" && records.length ? summaryModel(view, records, { planTitles: () => null, goalCommands: null, complete: journal?.status === "ready" }).finalVerdict : null), [view, records, journal?.status]);
  const zone = useMemo(() => {
    if (!view) return null;
    const z = actionZone(locale, view, activity.entries);
    if (z.variant === "working" && active?.kind === "turn" && active.purpose === "execute" && view.stage) {
      const text = t(locale, planTotal ? "orchZone_workingTitle" : "orchZone_workingTitleN").replace("{who}", roleName(locale, "executor").split(" · ")[0]).replace("{n}", String(view.stage)).replace("{m}", String(planTotal));
      z.title = text;
    } else if (z.variant === "working" && active) z.title = active.kind === "turn" ? who.split(" · ").slice(0, 2).join(" · ") : who;
    if (view.status === "completed" && finalVerdict === "complete" && z.variant === "completed") z.title = t(locale, "orchZone_goalAccepted");
    const can = (b: ZoneButton) => !(b.action === "project_settings" && !onProjectSettings) && !(b.action === "new_goal" && (!onNewGoal || busy));
    const takeFirst = !!take?.allowed && view.status === "completed" && z.primary !== null && can(z.primary);
    const first = z.primary && can(z.primary) ? z.primary : null;
    // R6-A (mock-up 17): "Take the result" is the zone's main button, in the one row with "New goal"; only a finished run has it here
    const takeBtn: ZoneButton | null = takeFirst && takeOpen !== runId ? { action: "take", label: t(locale, "orchTakeOpen"), danger: false, commands: [] } : null;
    return { ...z, primary: takeFirst ? takeBtn : first, secondary: [...(takeFirst && first ? [first] : []), ...z.secondary.filter((b) => can(b) && b.action !== "release_newer")], dangerous: z.dangerous.filter(can), footer: z.footer.filter(can) };
  }, [view, locale, activity.entries, onProjectSettings, onNewGoal, busy, take?.allowed, takeOpen, runId, active, who, planTotal, finalVerdict]);
  const zoneWho = view && ["preparing", "running", "pausing", "stopping"].includes(view.status) ? who : null;
  const zoneDisabled = (b: ZoneButton): boolean => b.action === "stop" ? false : b.action === "new_goal" ? entry.disabled
    : ["resume", "step", "pause", "keep_running"].includes(b.action) ? off(b.action as RunAction) : b.action.startsWith("recover_") ? off("recover") : false;
  const zoneConfirm = (b: ZoneButton): string | null => (b.action === "recover_reset" ? t(locale, "orchRecoverConfirm") : null);
  const zoneLabel = (b: ZoneButton): string => (copiedWhich.current === b.action && copied !== "idle" ? t(locale, copyKey(copied, "orchZone_copyId", "docCopied")) : b.action === "copy_journal" && journal?.status !== "ready" ? t(locale, "orchZone_copyJournalPartial") : b.label);
  const onZone = (b: ZoneButton): void => {
    switch (b.action) {
      case "resume": case "step": case "stop": case "pause": case "keep_running": return void send(b.action);
      case "recover_accept": return void send("recover", { recover: "accept" });
      case "recover_retry": return void send("recover", { recover: "retry_turn" });
      case "recover_reset": return void send("recover", { recover: "reset_to_checkpoint", confirm: true });
      case "open_plan": return openSection("plan");
      case "open_changes": return onView({ tab: "changes" });
      case "open_feed": return onView({ tab: "work", mode: "feed" });
      case "open_journal": return onView({ tab: "work", mode: "journal" });
      case "project_settings": return onProjectSettings?.();
      case "new_goal": return onNewGoal?.();
      case "take": return void (runId && setTakeOpen(runId));
      case "copy_id": case "copy_journal":
        copiedWhich.current = b.action;
        return void copy(b.action === "copy_id" ? (runId ?? "") : records.map((r) => JSON.stringify(r)).join("\n"));
      default: return;
    }
  };
  const openFindings = view?.decisions?.findings ? (view.progress?.findings?.items ?? []).filter((x) => x.status === "open") : [];
  const accessMismatch = activity.entries.some((e) => e.kind === "error" && e.detail?.accessMismatch === true);
  const progress = view?.progress ?? null;
  const silenceFor = (p: ParticipantState): string | null => {
    if (p.phase !== "running") return null;
    const last = p.lastEventAt ? Date.parse(p.lastEventAt) : null;
    if (last !== null && now - last < SILENCE_MS) return null;
    return `${t(locale, "orchSilence")}${p.lastEventAt ? ` ${t(locale, "orchSilenceLast")} ${time(locale, p.lastEventAt)} (${duration(locale, now - Date.parse(p.lastEventAt))})` : ""}`;
  };

  // a newer version's run: its changes are not read here (main refuses them), so there is no tab for them
  const tabs: PanelTab[] = view?.newer ? ["summary", "work"] : ["summary", "work", "changes"];
  const curTab: PanelTab = tabs.includes(panel.tab) ? panel.tab : "summary"; // a readable newer run has no Changes tab
  const roleFilter = useCallback((e: OrchestrationActivityEntry) => (e.kind === "turn_finished" && e.text === "completed") ? false : panel.role === "all" ? FEED_KINDS.has(e.kind)
    : panel.role === "check"
    ? (e.role === "check" || e.role === "run") && FEED_KINDS.has(e.kind)
    : (e.role === panel.role && FEED_KINDS.has(e.kind)) || (e.role === "run" && e.kind === "status"), [panel.role]);
  const logFilter = useCallback((e: OrchestrationActivityEntry) => (panel.role === "all" || (panel.role === "check" ? e.role === "check" : e.role === panel.role))
    && (LOG_KINDS.has(e.kind) || (e.kind === "tool_finished" && typeof e.detail?.output === "string")), [panel.role]);
  // R5h-A (mock-ups 02, 03, 07, 18): a run that waits for the person, is paused or failed: the stages and where it stands over the feed
  const stagesAbove = (!!view?.permission || view?.status === "paused" || view?.status === "failed") && records.length > 0;
  const feedEmpty = !activity.entries.some(roleFilter);
  const selected = panel.role === "lead" ? lead : panel.role === "executor" ? executor : panel.role === "reviewer" ? reviewer : null;

  // R5b: the header names the project and the pair of agents (lead -> executor) of the link the run belongs to
  const runLink = runId ? orch.canvas.links.find((l) => l.runIds.includes(runId)) : undefined;
  const leadCard = runLink ? orch.canvas.agents.find((a) => a.agentId === runLink.fromAgentId) : undefined;
  const execCard = runLink ? orch.canvas.agents.find((a) => a.agentId === runLink.toAgentId) : undefined;
  const project = leadCard?.project ? leadCard.project.split(/[\\/]/).filter(Boolean).at(-1) ?? null : null;
  const pair = leadCard && execCard ? `${providerName(leadCard.provider)} → ${providerName(execCard.provider)}` : null;
  // D-018: the people and the time/limits/environment of the summary (mock-up 13), only from what the run has
  const roleList = byReviewer(view) ? ["lead", "executor", "reviewer"] as const : ["lead", "executor"] as const;
  const envReported = (["codex", "claude"] as const).map((p) => ({ p, e: [...activity.entries].reverse().find((x) => x.kind === "session" && x.provider === p && x.detail?.reported === true) ?? null })).filter((x) => x.e);
  const terminal = !!view && TERMINAL_STATUSES.includes(view.status); // the dependency row sits in the limits block of a finished run (mock-up 13), else among the alerts
  const middle = !view ? null : (
    <>
      <Section id="people" title={t(locale, "orchParticipants")} attrs={{ "data-orch-participants": "" }}>
        <dl className="orch-kv orch-people">
          {roleList.map((role) => {
            const info = orch.catalog.providers?.[role === "reviewer" ? "lead" : role];
            const p = role === "lead" ? lead : role === "executor" ? executor : reviewer;
            const mdl = roleModel(role, activity.entries, progress?.models);
            const roleWord = t(locale, role === "lead" ? "orchRoleLead" : role === "executor" ? "orchRoleExecutor" : "orchRoleReviewer").toLocaleLowerCase(locale);
            return (
              <div key={role} className="orch-kv__row" data-participant={role} data-phase={p.phase}>
                <dt>
                  <strong title={t(locale, `orchTerm_${role}`)}>{info ? `${providerName(info.provider)} · ${roleWord}` : roleName(locale, role)}</strong>
                  {info && <span className="orch-hint">{info.protocol}
                    {progress?.access && <> · <span data-participant-access={progress.access[info.provider]}>{tr(locale, `orchAccess_${progress.access[info.provider]}`)}</span></>}
                    {" · "}<span data-participant-model={mdl.model ?? "cli"} data-model-reported={mdl.reported ? "yes" : "no"}>{modelLabel(locale, mdl)}</span></span>}
                </dt>
                <dd><button type="button" className="orch-textual" onClick={() => onView({ tab: "work", mode: "feed", role })}>{t(locale, "orchObserve")}</button></dd>
              </div>
            );
          })}
        </dl>
      </Section>
      <Section id="limits" title={t(locale, "orchSumTimeEnv")} attrs={{ "data-orch-limits": "" }}>
        <dl className="orch-kv">
          {d.createdAt && <Row label={t(locale, "orchSumTime")}>{spanText(locale, (busy ? now : Date.parse(lines.at(-1)?.ts ?? d.createdAt)) - Date.parse(d.createdAt))}{goal?.limits?.runMs ? ` / ${spanText(locale, goal.limits.runMs)}` : ""}</Row>}
          <Row label={t(locale, "orchSumTurnsRounds")}>{view.turns}{goal?.limits?.turns ? ` / ${goal.limits.turns}` : ""}{goal?.limits?.roundsPerStage ? ` · ${goal.limits.roundsPerStage}` : ""}</Row>
          {envReported.map(({ p, e }) => (
            <Row key={p} label={`${t(locale, "orchSumEnv")} · ${p === "codex" ? "Codex" : "Claude"}`} attrs={{ "data-env-provider": p }}>
              {ENV_FIELDS.filter((k) => e!.detail?.[k] !== undefined && e!.detail?.[k] !== null && e!.detail?.[k] !== "").map((k, i) => (
                <span key={k} className="orch-env__item" data-env-item={k} title={t(locale, `orchEnvKey_${k}`)}>{i > 0 ? " · " : ""}{String(e!.detail![k])}</span>
              ))}
            </Row>
          ))}
          {depsText && <Row label={t(locale, "orchBoardDeps")} dd={{ "data-board": "deps" }}>{depsText.text}{depsText.failed && <> <button type="button" data-deps-step onClick={() => onView({ tab: "work", mode: "feed", role: "check" })}>{t(locale, "orchDepsStep")}</button></>}</Row>}
          {cost && <Row label={t(locale, "orchSumSpend")} dd={{ "data-board": "cost-total" }}>{costText(locale, cost, byReviewer(view) || cost.calls.reviewer > 0)}</Row>}
        </dl>
      </Section>
    </>
  );
  // what needs the person's eye in any state: a preparation that failed, a dependency check, an access that does not match
  const alerts = !view ? null : ((depsText && !terminal) || (progress?.prepare?.status === "failed" && runId) || accessMismatch) ? (
    <>
      {depsText && !terminal && <dl className="orch-kv"><Row label={t(locale, "orchBoardDeps")} dd={{ "data-board": "deps" }}>{depsText.text}{depsText.failed && <> <button type="button" data-deps-step onClick={() => onView({ tab: "work", mode: "feed", role: "check" })}>{t(locale, "orchDepsStep")}</button></>}</Row></dl>}
      {progress?.prepare?.status === "failed" && runId && <PrepareFailure orch={orch} runId={runId} locale={locale} prepare={progress.prepare} entries={activity.entries} />}
      {accessMismatch && <p className="dialog-error" data-orch-access-mismatch>{t(locale, "orchAccessMismatchWarn")}</p>}
    </>
  ) : null;
  const wide = curTab === "summary" && (opened.plan || opened.result); // only the documents are wide
  return (
    <aside className={`orch-panel${wide ? " orch-panel--wide" : ""}${expanded ? " orch-panel--full" : ""}`}
      data-interactive="true" data-wheel-owner="local" data-canvas-wheel-priority="local" aria-label={t(locale, "orchRun")} data-orch-panel-tab={curTab} data-orch-panel-mode={curTab === "work" ? panel.mode : undefined} data-orch-run-id={runId ?? undefined}>
      <header className="orch-panel__header">
        <div className="orch-panel__title">
          <strong>{t(locale, "orchRun")}{project ? ` · ${project}` : ""}</strong>
          {runId && <code title={runId}>{runId.slice(0, 8)}{pair ? ` · ${pair}` : ""}</code>}
        </div>
        <button className="orch-panel__expand" type="button" aria-pressed={expanded} data-orch-expand onClick={() => setExpanded((v) => !v)}
          title={t(locale, expanded ? "orchPanelCollapse" : "orchPanelExpand")} aria-label={t(locale, expanded ? "orchPanelCollapse" : "orchPanelExpand")}>
          <UiIcon name={expanded ? "restore" : "maximize"} size={14} />
        </button>
        <button className="orch-panel__close" type="button" onClick={onClose} aria-label={t(locale, "orchClose")}><UiIcon name="close" size={16} /></button>
      </header>
      {!view || !head ? (
        runId && orch.runErrors?.[runId]
          ? <p className="orch-panel__empty dialog-error" role="alert" data-run-load-error>{t(locale, "actRunError")}{" "}
            <button type="button" onClick={() => orch.retry()}>{t(locale, "actRetry")}</button></p>
          : <p className="orch-panel__empty">{runId ? t(locale, "orchLoading") : t(locale, "orchNoRun")}</p>
      ) : (
        <>
          {liveRunIds && liveRunIds.length >= 2 && (
            <nav className="orch-runs" aria-label={t(locale, "orchRunsSwitch")} data-orch-runs>
              {liveRunIds.slice(0, 4).map((id) => (
                <button key={id} type="button" aria-pressed={id === runId} data-orch-run-pick={id}
                  aria-label={`${t(locale, "orchRunPick").replace("{id}", id.slice(0, 8))}: ${orch.runs[id] ? t(locale, `orchStatus_${runStatusKey(orch.runs[id]!.view)}` as TranslationKey) : ""}`}
                  onClick={() => onView({ runId: id })}>
                  <i data-run-status={orch.runs[id]?.view.status} aria-hidden="true" />{id.slice(0, 8)}
                </button>
              ))}
              <span className="orch-runs__count" data-orch-runs-count>{t(locale, "orchRunsLive").replace("{n}", String(liveRunIds.length))}</span>
            </nav>
          )}
          <ActionZone locale={locale} zone={zone!} runKey={view.runId} clarifyOff={actionEnabled("clarify", available) ? null : entry.hint ? t(locale, entry.hint) : t(locale, "orchClarify")} headline={head.headline} status={view.status} task={task ?? null} zoneRef={summary} flash={flash}
            compact={(curTab !== "summary" || panel.section !== "overview") && zone!.tone !== "waiting" && zone!.variant !== "newer_version"} sending={sending} disabled={zoneDisabled} onButton={onZone} confirmText={zoneConfirm}
            resumeNext={head.next} who={zoneWho} stages={plan.map((x) => x.title)} words={(text) => text} clarify={{ value: clarify, onChange: setClarify, onSend: () => void send("clarify", { text: clarify.trim() }, () => setClarify("")) }}
            rowStart={view.newer && runId && linkOfRun(orch, runId) ? <ReleaseNewerLink orch={orch} linkId={linkOfRun(orch, runId)!} runId={runId} locale={locale} /> : undefined}
            notices={<>
              {entry.hint && actions.some(off) && <div className="orch-hint" data-orch-platform-hint>{t(locale, entry.hint)}</div>}
              {sending && <div className="orch-hint">{t(locale, "orchSending")}</div>}
              {!sending && (offline || unknown.length > 0) && (
                // the connection, not a refusal: neutral, with the way to repeat (the same commandId)
                <div className="orch-panel__unknown" role="status" data-orch-offline>
                  <span>{t(locale, offline ? "orchZone_offline" : "orchUnknownResult")}</span>
                  {unknown.map((pc) => (
                    <button key={pc.commandId} type="button" onClick={() => void deliver(pc)}>
                      {t(locale, "orchRepeat")}: {tr(locale, `orchCommand_${pc.command.kind}`)}
                    </button>
                  ))}
                </div>
              )}
              {progressNote && <div className="orch-hint" role="status" data-orch-in-progress>{progressNote}</div>}
              {notice && <div className="dialog-error" role="alert" data-orch-refused>{notice}</div>}
            </>}>
            {endedHere && curTab !== "summary" && (
              <div className="orch-ended" role="status" data-orch-ended>
                <span>{t(locale, "orchSummaryReady")}</span>
                <button type="button" className="orch-primary" onClick={() => onView({ tab: "summary", section: "result" })}>{t(locale, "orchSummaryOpen")}</button>
              </div>
            )}
            {(view.newer?.skipped ?? 0) > 0 && <p className="orch-hint" data-orch-newer-skipped={view.newer!.skipped}>{t(locale, "orchNewerSkipped").replace("{n}", String(view.newer!.skipped))}</p>}
            {view.permission && !view.newer && (
              <PermissionBlock key={view.permission.requestId} locale={locale} request={view.permission} more={(view.pendingPermissions ?? 1) - 1} sending={sending || off("permission")}
                onDecide={(decision, extra) => void send("permission", { requestId: view.permission!.requestId, decision, ...extra })} />
            )}
            {view.status === "paused" && view.reason === "finish_unconfirmed" && view.progress && <FinishSteps locale={locale} steps={view.progress.finish} />}
            {has("answer") && d.question && (
              <section className="orch-question orch-form-card" data-orch-question data-orch-form>
                <p className="orch-permission__ask" id={`${answerId}-t`}>{questionText ?? t(locale, "orchLoading")}</p>
                <textarea ref={answerBox} rows={3} value={answer} placeholder={t(locale, "orchAnswerPlaceholder")} aria-labelledby={`${answerId}-t`} onChange={(e) => setAnswer(e.target.value)} />
                <div className="orch-panel__actions orch-form__foot" data-orch-form-foot>
                  <button type="button" className="orch-primary" data-orch-primary="answer" disabled={sending || !answer.trim() || off("answer")}
                    onClick={() => void send("answer", { questionId: d.question!.questionId, text: answer.trim() }, () => setAnswer(""))}>{t(locale, "orchPause_awaiting_answer_button")}</button>
                </div>
              </section>
            )}
            {has("checks_decide") && view.proposal && (
              <ChecksDecision key={view.revision} locale={locale} proposal={view.proposal} sending={sending || off("checks_decide")}
                onDecide={(checks) => void send("checks_decide", checks ? { checks } : {})} />
            )}
            {has("check_amend") && view.refused && (
              <CheckRefused key={view.revision} locale={locale} refused={view.refused} sending={sending || off("check_amend")}
                onAmend={(line) => void send("check_amend", { checkId: view.refused!.checkId, line })} />
            )}
            {has("finish_confirm") && view.confirm && (
              <FinishConfirm key={view.revision} locale={locale} confirm={view.confirm} sending={sending || off("finish_confirm")}
                onConfirm={(push, qa) => void send("finish_confirm", { tree: view.confirm!.tree ?? "", commit: view.confirm!.commit, push, qa })} />
            )}
            {has("person_decide") && view.decisions && (view.decisions.disputed.length > 0 || view.decisions.conditions.length > 0 || openFindings.length > 0) && (
              <PersonDecide key={view.revision} locale={locale} d={view.decisions} findings={openFindings} sending={sending || off("person_decide")}
                onSubmit={(list) => void sendPeople(list)} />
            )}
            {has("plan_decide") && view.decisions?.proposal && (
              <PlanProposal key={view.revision} locale={locale} d={view.decisions} sending={sending || off("plan_decide")}
                onDecide={(plan) => void send("plan_decide", { plan })} />
            )}
            {zone!.primary?.action === "raise_limit" && (
              <RaiseLimit key={`${view.revision}:${cost?.reached ?? ""}`} locale={locale} cost={cost} rounds={stageRounds} budget={view.progress?.budget ?? null}
                sending={sending || off("raise_limit")} onRaise={(kind, value) => void send("raise_limit", { limit: kind, value }, continueAfterRaise)} />
            )}
            {takenLines(locale, take).map((line) => <p key={line} className="orch-take__taken" data-orch-taken>{line}</p>)}
            {view.status === "completed" && take?.allowed && runId && takeOpen === runId && <TakeResult locale={locale} runId={runId} take={take} onTake={setTake} onChanges={() => onView({ tab: "changes" })} />}
          </ActionZone>

          <div className="orch-tabs orch-seg" role="tablist" aria-label={t(locale, "orchRun")}
            onKeyDown={(e) => {
              const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (!step && e.key !== "Home" && e.key !== "End") return;
              e.preventDefault();
              const next = e.key === "Home" ? tabs[0] : e.key === "End" ? tabs[tabs.length - 1] : tabs[(tabs.indexOf(curTab) + step + tabs.length) % tabs.length];
              onView({ tab: next });
              e.currentTarget.querySelector<HTMLElement>(`[data-orch-tab="${next}"]`)?.focus();
            }}>
            {tabs.map((tab) => (
              <button key={tab} type="button" role="tab" id={`orch-tab-${tab}`} aria-controls="orch-tabpanel" tabIndex={curTab === tab ? 0 : -1} aria-selected={curTab === tab} data-orch-tab={tab}
                className={curTab === tab ? "orch-tabs__on" : undefined} onClick={() => onView({ tab })}>
                {tr(locale, `orchTab_${tab}`)}{tab === "changes" && changedFiles !== null && <span data-orch-changes-count> · {changedFiles}</span>}
              </button>
            ))}
          </div>
          {curTab === "work" && (
            // biome-ignore lint/a11y/useSemanticElements: a button segment, not a form group
            <div className="orch-seg orch-modes" role="group" aria-label={t(locale, "orchModeGroup")}>
              {(["feed", "journal", "records"] as const satisfies readonly PanelMode[]).map((mode) => (
                <button key={mode} type="button" aria-pressed={panel.mode === mode} data-orch-mode={mode}
                  className={panel.mode === mode ? "orch-tabs__on" : undefined} onClick={() => onView({ mode })}>{tr(locale, `orchMode_${mode}`)}</button>
              ))}
            </div>
          )}
          {curTab === "work" && (
            <div className="orch-roles orch-seg" role="radiogroup" aria-label={t(locale, "orchObserveWho")}>
              {(["all", "lead", "executor", "check"] as const).map((role) => (
                <button key={role} type="button" role="radio" aria-checked={panel.role === role} data-orch-role={role}
                  className={panel.role === role ? "orch-roles__on orch-tabs__on" : undefined} onClick={() => onView({ role })}>{role === "all" ? t(locale, "orchRoleAll") : role === "check" ? roleName(locale, role) : t(locale, role === "lead" ? "orchRoleLead" : "orchRoleExecutor")}</button>
              ))}
            </div>
          )}

          <div className="orch-panel__body" id="orch-tabpanel" role="tabpanel" aria-labelledby={`orch-tab-${curTab}`} data-orch-body={curTab} data-orch-mode={curTab === "work" ? panel.mode : undefined}>
            {curTab === "summary" && runId && <>
              {/* A failed read keeps what was read, says it is incomplete and offers to read the rest (from where it stopped). */}
              {journal?.status === "error" && (
                <p className="dialog-error" role="alert" data-sum-journal-error>
                  {t(locale, "orchSumLoadFailed")}: {t(locale, records.length ? "orchSumIncomplete" : "orchSumJournal")}{" "}
                  <button type="button" onClick={() => void orch.syncJournal(runId)}>{t(locale, "orchRepeat")}</button>
                </p>
              )}
              {journal?.status === "loading" && records.length > 0 && <p className="orch-hint" data-sum-journal-loading>{t(locale, "orchSumIncomplete")}</p>}
              {!zoneWho && active && <p className="orch-summary__who" data-orch-working>{who}</p>}
              {!records.length
                ? journal?.status !== "error" && <p className="orch-hint">{t(locale, "orchLoading")}</p>
                : <RunSummary orch={orch} runId={runId} view={view} records={records} locale={locale} facts={facts} middle={middle} alerts={alerts} onOpen={openSection}
                  incomplete={journal?.status !== "ready"} />}
              {opened.plan && (
                <Sect id="plan" title={tr(locale, "orchTab_plan")} open lazy onToggle={(o) => toggleSection("plan", o)} elRef={sectionEl("plan")}>
                  {records.length
                    ? <RunDocs kind="plan" orch={orch} runId={runId} view={view} records={records} locale={locale} task={task ?? null} take={take}
                      seq={state?.seq ?? 0} incomplete={journal?.status !== "ready"} onNote={onNoteFromText} />
                    : <p className="orch-hint">{t(locale, "orchLoading")}</p>}
                </Sect>
              )}
              {opened.result && (
                <Sect id="result" title={tr(locale, "orchTab_result")} open lazy onToggle={(o) => toggleSection("result", o)} elRef={sectionEl("result")}>
                  {records.length
                    ? <RunDocs kind="result" orch={orch} runId={runId} view={view} records={records} locale={locale} task={task ?? null} take={take}
                      seq={state?.seq ?? 0} incomplete={journal?.status !== "ready"} onNote={onNoteFromText} />
                    : <p className="orch-hint">{t(locale, "orchLoading")}</p>}
                </Sect>
              )}
            </>}
            {curTab === "work" && panel.mode === "feed" && runId && stagesAbove && (
              <RunSummary list orch={orch} runId={runId} view={view} records={records} locale={locale} facts={facts} onOpen={openSection} incomplete={journal?.status !== "ready"} />
            )}
            {curTab === "work" && panel.mode === "feed" && runId && !(stagesAbove && feedEmpty) && (
              <ActivityList key={`a:${panel.role}`} locale={locale} entries={activity.entries} gaps={activity.gaps} filter={roleFilter}
                emptyText={activity.status === "loading" ? t(locale, "orchLoading") : t(locale, "orchFeedEmpty")}
                silence={selected ? silenceFor(selected) : [lead, executor, reviewer].map((x) => (x ? silenceFor(x) : null)).find(Boolean) ?? null} />
            )}
            {curTab === "work" && panel.mode === "journal" && runId && (
              <ActivityList key={`l:${panel.role}`} locale={locale} entries={activity.entries} gaps={activity.gaps} filter={logFilter}
                emptyText={t(locale, "orchLogEmpty")} silence={null} />
            )}
            {curTab === "changes" && view.reason === "lead_modified_tree" && <p className="orch-hint" data-orch-lead-modified-why>{t(locale, "orchLeadModifiedWhy")}</p>}
            {curTab === "changes" && runId && !view.newer && <ChangesTab locale={locale} runId={runId} seq={state?.seq ?? 0} inPlace={view.workMode === "project"} />}
            {curTab === "work" && panel.mode === "records" && (
              <section className="orch-panel__section">
                <ol className="orch-history">
                  {lines.filter((l) => panel.role === "all" || lineRole(l) === "run" || lineRole(l) === panel.role).map((l) => (
                    <li key={l.seq} data-history-kind={l.kind} data-history-role={lineRole(l)}>
                      <time>{new Date(l.ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time> <code className="orch-history__kind">{l.kind}</code> {lineText(locale, l, activity.entries)}
                      {l.text && runId && <LineDetails runId={runId} text={l.text} dropped={Number(l.parts.outputDropped ?? 0)} locale={locale} />}
                    </li>
                  ))}
                </ol>
                {journal?.status === "error" && (
                  <p className="dialog-error" role="alert">{t(locale, "orchSumLoadFailed")} <button type="button" onClick={() => void orch.syncJournal(runId!)}>{t(locale, "orchRepeat")}</button></p>
                )}
              </section>
            )}
          </div>
          <PanelFoot buttons={zone!.footer} sending={sending} disabled={zoneDisabled} onButton={onZone} labelOf={zoneLabel} />
        </>
      )}
    </aside>
  );
}
// R4.1: the shell of a decision form — a titled group (the question the person answers, then its context, then the
// choices), the first choice takes focus when the form appears, and the form ends in one pinned row (FormFoot).
type FormAttrs = Record<string, string | boolean>;
function Form({ title, hint, attrs, children }: { title: string; hint?: string; attrs: FormAttrs; children: React.ReactNode }): React.JSX.Element {
  const id = useId(), hintId = `${id}-hint`;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // take the focus only from nowhere or from the panel itself, never from the person's work elsewhere (a terminal, a tab,
    // another field) and never from a field they are typing in
    const at = document.activeElement as HTMLElement | null;
    const editing = !!at && (/^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName) || at.isContentEditable);
    if (at && at !== document.body && (!box.current?.closest("aside")?.contains(at) || editing)) return;
    box.current?.querySelector<HTMLElement>(FIRST_CHOICE)?.focus({ preventScroll: true });
  }, []);
  return (
    <section ref={box} className="orch-question orch-form-card" aria-labelledby={id} aria-describedby={hint ? hintId : undefined} data-orch-form {...attrs}>
      <h4 id={id}>{title}</h4>
      {hint && <p className="orch-hint" id={hintId}>{hint}</p>}
      {children}
    </section>
  );
}
const FormFoot = ({ children }: { children: React.ReactNode }): React.JSX.Element => <div className="orch-panel__actions orch-form__foot" data-orch-form-foot>{children}</div>;

// Journal v2 (journal-v2-format.md §2.4): the lead's proposed check commands — «Принять» as they are, or «Изменить»
// to the person's own lines. Nothing runs before the decision; it is made once.
function ChecksDecision({ locale, proposal, sending, onDecide }: {
  locale: LocaleId; proposal: NonNullable<OrchestrationRunView["proposal"]>; sending: boolean; onDecide(checks: string[] | null): void;
}): React.JSX.Element {
  const none = proposal.checks.length === 0;
  const [editing, setEditing] = useState(none);
  const [text, setText] = useState(proposal.checks.map((c) => c.command).join("\n"));
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const editId = useId();
  return (
    <Form title={t(locale, "orchChecksProposalTitle")} attrs={{ "data-orch-checks-proposal": true }}>
      {/* D-018 (mock-up 06): nothing proposed — the zone says it; here only the field for the person's own commands */}
      {!none && <ol className="orch-items" data-orch-checks-list>{proposal.checks.map((c) => (
        <li key={c.id} className="orch-item"><code>{c.command}</code><span className="orch-hint">{c.why}{c.source.length > 0 && <small> ({t(locale, "orchChecksSource")}: {c.source.join(", ")})</small>}</span></li>
      ))}</ol>}
      {none && <span hidden data-orch-checks-none>{proposal.none}</span>}
      {editing && (
        <label className="orch-field">
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} data-orch-checks-edit aria-describedby={editId} />
          <small className="orch-hint" id={editId}>{t(locale, "orchChecksEditHint")}</small>
        </label>
      )}
      <FormFoot>
        {/* none proposed: «Save commands» is the main button (off while the list is empty); going on without checks is dangerous and asks first */}
        {!editing && <button type="button" className="orch-primary" disabled={sending} data-orch-primary="checks_accept" data-orch-checks-accept onClick={() => onDecide(null)}>{t(locale, "orchZone_acceptChecks")}</button>}
        {!editing && <button type="button" disabled={sending} data-orch-checks-edit-open onClick={() => setEditing(true)}>{t(locale, "orchChecksEdit")}</button>}
        {editing && <button type="button" className="orch-primary" disabled={sending || lines.length === 0 || lines.length > 16} data-orch-primary="checks_edit" data-orch-checks-save onClick={() => onDecide(lines)}>{t(locale, "orchChecksSave")}</button>}
        {none && <DangerConfirm locale={locale} label={t(locale, "orchChecksNoChecks")} text={t(locale, "orchZone_confirmNoChecks")} disabled={sending} textual
          attr={{ "data-orch-checks-accept": true }} onConfirm={() => onDecide(null)} />}
      </FormFoot>
    </Form>
  );
}

// A1.1 (§2.6): a lead's check the sandbox refused — run it without the sandbox, or change it (the person's command
// runs without the sandbox too). Never the autopilot's: only these two buttons and Stop.
function CheckRefused({ locale, refused, sending, onAmend }: {
  locale: LocaleId; refused: NonNullable<OrchestrationRunView["refused"]>; sending: boolean; onAmend(line: string): void;
}): React.JSX.Element {
  const [text, setText] = useState(refused.command);
  const editId = useId();
  const multi = refused.command.includes("\n");
  return (
    <Form title={t(locale, "orchCheckRefusedTitle")} attrs={{ "data-orch-check-refused": refused.checkId }}>
      {/* the whole command, never shortened, in the field at once; saving it unchanged is the person's decision too (S1-4); mock-up 14: one line */}
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the control is the textarea or the input, whichever the command's lines call for */}
      <label className="orch-field">
        <span id={editId} className="orch-field__lead">{t(locale, "orchCheckRefusedEditHint")}</span>
        {multi && <textarea rows={Math.min(8, refused.command.split("\n").length + 2)} value={text} onChange={(e) => setText(e.target.value)} data-orch-check-refused-line aria-describedby={editId} />}
        {!multi && <input type="text" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} data-orch-check-refused-line aria-describedby={editId} />}
      </label>
      <FormFoot>
        <button type="button" className="orch-primary" disabled={sending || text.trim() === ""} data-orch-primary="check_amend" data-orch-check-edit-save onClick={() => onAmend(text.trim())}>{t(locale, "orchZone_saveOwn")}</button>
      </FormFoot>
    </Form>
  );
}

// Journal v2 (§2.1): push and QA of a run without checks — every step the goal asked for decided at once, for the tree
// and commit shown; each is decided on its own (owner's decision 5i §7 p. 3). D-018 (mock-up 12): each step a row with the
// segment «Выполнить | Пропустить», one button at the end; no cards, no warnings the mock-up does not draw.
function FinishConfirm({ locale, confirm, sending, onConfirm }: {
  locale: LocaleId; confirm: NonNullable<OrchestrationRunView["confirm"]>; sending: boolean;
  onConfirm(push: "confirm" | "decline" | null, qa: "confirm" | "decline" | null): void;
}): React.JSX.Element {
  const [push, setPush] = useState<"confirm" | "decline" | null>(null);
  const [qa, setQa] = useState<"confirm" | "decline" | null>(null);
  const ready = !!confirm.tree && (!confirm.push || push !== null) && (!confirm.qa || qa !== null);
  const choice = (step: "push" | "qa", value: "confirm" | "decline" | null, set: (v: "confirm" | "decline") => void) => (
    <fieldset className="orch-field orch-finish-group" data-orch-finish-step={step}>
      <legend>{step === "push" ? `Push${confirm.commit ? ` · ${confirm.commit.slice(0, 7)}` : ""}` : t(locale, "orchFinishLegend_qa")}</legend>
      <div className="orch-seg orch-seg--field">
        {(["confirm", "decline"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={value === v} className={value === v ? "orch-tabs__on" : undefined} disabled={sending} data-orch-finish-choice={`${step}:${v}`} onClick={() => set(v)}>
            {t(locale, v === "confirm" ? "orchFinishDo" : "orchFinishSkip")}
          </button>
        ))}
      </div>
      {value && <small className="orch-hint" data-orch-finish-effect>{t(locale, `orchFinishEffect_${step}_${value}` as TranslationKey)}</small>}
    </fieldset>
  );
  return (
    <Form title={t(locale, "orchFinishConfirmTitle")} attrs={{ "data-orch-finish-confirm": true }}>
      <div className="orch-plate">
        {confirm.push && choice("push", push, setPush)}
        {confirm.qa && choice("qa", qa, setQa)}
        {qa === "confirm" && push === "decline" && <p className="dialog-error" data-orch-qa-unpushed>{t(locale, "orchFinishConfirmQaUnpushed")}</p>}
      </div>
      <FormFoot>
        <button type="button" className="orch-primary" disabled={sending || !ready} data-orch-primary="finish_confirm" data-orch-finish-submit
          onClick={() => onConfirm(confirm.push ? push : null, confirm.qa ? qa : null)}>{t(locale, "orchFinishConfirmSubmit")}</button>
      </FormFoot>
    </Form>
  );
}

// A4 (5h §3.5, §4; journal-v2-format.md §2.9): the person's decision on awaiting_person_decision — a disputed item (a new
// defect or a repeat of a closed candidate), a person condition (met / not met) and an open finding (close / to a wish). Each
// about the state shown (runKey). D-018 (mock-up 10): one plate, every item a row with its segment, one «Отправить решения»
// at the end that sends one command per item (as before: the choices are equal, there is no default to press).
type PersonItem = { key: string; kind: string; text: string; attrs: Record<string, string>; context?: React.ReactNode;
  options: { value: string; label: string; attrs: Record<string, string>; person: Omit<OrchestrationPersonDecide, "kind"> }[] };
function PersonDecide({ locale, d, findings, sending, onSubmit }: {
  locale: LocaleId; d: OrchestrationDecisions; findings: readonly OrchestrationFindings["items"][number][]; sending: boolean;
  onSubmit(list: Omit<OrchestrationPersonDecide, "kind">[]): void;
}): React.JSX.Element {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const items: PersonItem[] = [
    ...d.disputed.map((x): PersonItem => {
      const target = { reviewTurnId: x.reviewTurnId, index: x.index };
      return {
        key: `d:${x.reviewTurnId}:${x.index}`, kind: t(locale, "orchPersonKind_disputed"), text: x.problem, attrs: { "data-orch-disputed": `${x.reviewTurnId}:${x.index}` },
        context: <>
          {x.paths.length > 0 && <small className="orch-hint">{x.paths.join(", ")}</small>}
          {x.candidates.map((c) => {
            const shared = c.paths.filter((f) => x.paths.includes(f));
            return <small key={c.id} className="orch-hint" data-orch-disputed-candidate={c.id}>{fill(t(locale, "orchDisputedCandidate"), { n: idNumber(c.id) })}: {c.problem}
              {shared.length > 0 && <span data-orch-disputed-shared> · {fill(t(locale, "orchDisputedShared"), { files: shared.join(", ") })}</span>}</small>;
          })}
          {(x.evidence || x.candidates.some((c) => c.paths.length > 0)) && (
            <details data-orch-disputed-more>
              <summary>{t(locale, "orchDisputedMore")}</summary>
              {x.evidence && <p className="orch-hint">{x.evidence}</p>}
              {x.candidates.filter((c) => c.paths.length > 0).map((c) => <p key={c.id} className="orch-hint"><b>{fill(t(locale, "orchDisputedCandidate"), { n: idNumber(c.id) })}</b>: {c.paths.join(", ")}</p>)}
            </details>
          )}
        </>,
        options: [
          { value: "new", label: t(locale, "orchDisputedNew"), attrs: { "data-orch-disputed-new": "" }, person: { subject: "disputed", target, decision: "new", finding: null, runKey: d.runKey } },
          ...x.candidates.map((c) => ({ value: `repeat:${c.id}`, label: x.candidates.length > 1 ? fill(t(locale, "orchDisputedRepeat"), { n: idNumber(c.id) }) : t(locale, "orchDisputedRepeatShort"),
            attrs: { "data-orch-disputed-repeat": c.id }, person: { subject: "disputed" as const, target, decision: "repeat" as const, finding: c.id, runKey: d.runKey } }))
        ]
      };
    }),
    ...d.conditions.map((c): PersonItem => ({
      key: `k:${c.id}`, kind: t(locale, "orchPersonKind_condition"), text: `«${c.text}»`, attrs: { "data-orch-person-condition": c.id },
      options: [
        { value: "met", label: t(locale, "orchPersonMet"), attrs: { "data-orch-person-met": "" }, person: { subject: "condition", target: c.id, decision: "met", finding: null, runKey: d.runKey } },
        { value: "not_met", label: t(locale, "orchPersonNotMet"), attrs: { "data-orch-person-not-met": "" }, person: { subject: "condition", target: c.id, decision: "not_met", finding: null, runKey: d.runKey } }
      ]
    })),
    ...(d.findings ? findings.map((f): PersonItem => ({
      key: `f:${f.id}`, kind: t(locale, "orchPersonKind_finding"), text: f.problem, attrs: { "data-orch-person-finding": f.id },
      options: [
        { value: "close", label: t(locale, "orchSumDecideClose"), attrs: { "data-finding-close": f.id }, person: { subject: "finding", target: f.id, decision: "close", finding: null, runKey: d.runKey } },
        ...(f.severity === "blocking" ? [{ value: "to_wish", label: t(locale, "orchSumDecideWish"), attrs: { "data-finding-to-wish": f.id }, person: { subject: "finding" as const, target: f.id, decision: "to_wish" as const, finding: null, runKey: d.runKey } }] : [])
      ]
    })) : [])
  ];
  // D-027: a finding's decision is optional (leaving it open is the safe choice); the required ones go first, a finding
  // after them — main resumes the run after the first accepted decision
  const required = items.filter((it) => !it.key.startsWith("f:"));
  const ready = required.every((it) => picked[it.key]) && items.some((it) => picked[it.key]);
  return (
    <Form title={t(locale, "orchPersonTitle")} attrs={{ "data-orch-person-decide": true }}>
      <div className="orch-plate">
        {items.map((it) => (
          <section key={it.key} className="orch-decide" {...it.attrs} {...(it.key.startsWith("f:") ? { title: t(locale, "orchFindingSafeHint"), "data-finding-safe": "" } : {})}>
            <p className="orch-decide__ask"><span>{it.kind} · </span>{it.text}</p>
            {it.context}
            {/* biome-ignore lint/a11y/useSemanticElements: a button segment, not a form group */}
            <div className="orch-seg orch-seg--field" role="group" aria-label={`${it.kind}: ${it.text}`}>
              {it.options.map((o) => (
                <button key={o.value} type="button" aria-pressed={picked[it.key] === o.value} className={picked[it.key] === o.value ? "orch-tabs__on" : undefined} disabled={sending} {...o.attrs}
                  onClick={() => setPicked((cur) => ({ ...cur, [it.key]: o.value }))}>{o.label}</button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <FormFoot>
        <button type="button" className="orch-primary" disabled={sending || !ready} data-orch-primary="person_decide" data-orch-person-submit
          onClick={() => onSubmit(items.filter((it) => picked[it.key]).map((it) => it.options.find((o) => o.value === picked[it.key])!.person))}>{t(locale, "orchZone_sendDecisions")}</button>
      </FormFoot>
    </Form>
  );
}

// A4 (5h §3.6 p. 5): a plan proposal that drops conditions or requirements — what goes and why, and a choice for every open
// blocking finding of a dropped condition (asked after «Принять снятие…», mock-up 11). «Вернуть лиду» keeps the plan in
// force and sends the note.
function PlanProposal({ locale, d, sending, onDecide }: {
  locale: LocaleId; d: OrchestrationDecisions; sending: boolean; onDecide(plan: Omit<OrchestrationPlanDecide, "kind">): void;
}): React.JSX.Element {
  const p = d.proposal!;
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [noting, setNoting] = useState(false);
  const [picking, setPicking] = useState(false);
  const ready = p.findings.every((f) => choices[f.id]);
  const waitId = useId();
  const choiceOf = (id: string): OrchestrationPlanChoice => {
    const v = choices[id];
    return v === "close" || v === "to_wish" ? { id, choice: v, stage: null, condition: null } : { id, choice: "move", stage: Number(v.slice(6)), condition: null };
  };
  const accept = () => onDecide({ proposalTurnId: p.proposalTurnId, decision: "accept", choices: p.findings.map((f) => choiceOf(f.id)), note: null, runKey: d.runKey });
  return (
    <Form title={t(locale, "orchProposalTitle")} attrs={{ "data-orch-plan-proposal": p.proposalTurnId }}>
      {/* UX audit PR 2: what the decision is about stays in view while its choices scroll */}
      <div className="orch-plate orch-proposal__head" data-orch-proposal-head>
        {p.dropped.map((x) => (
          <section key={x.id} className="orch-decide" data-orch-proposal-drop={x.id}>
            <p className="orch-decide__ask" title={x.id}>{fill(t(locale, "orchProposalCondition"), { n: idNumber(x.id) })} «{x.text}»</p>
            <small className="orch-hint">{fill(t(locale, "orchProposalWhy"), { why: x.why })}</small>
          </section>
        ))}
        {p.dropRequirements.map((x) => (
          <section key={x.id} className="orch-decide" data-orch-proposal-drop={x.id}>
            <p className="orch-decide__ask" title={x.id}>{fill(t(locale, "orchProposalRequirement"), { n: idNumber(x.id) })} «{x.text}»</p>
            <small className="orch-hint">{fill(t(locale, "orchProposalWhy"), { why: x.why })}</small>
          </section>
        ))}
        {p.findings.map((f) => (
          <section key={f.id} className="orch-decide" data-orch-proposal-finding={f.id}>
            <p className="orch-decide__ask">{t(locale, "orchPersonKind_finding")} «{f.problem}»</p>
            {picking
              ? <select value={choices[f.id] ?? ""} aria-label={f.problem} onChange={(e) => setChoices((c) => ({ ...c, [f.id]: e.target.value }))}>
                <option value="" disabled>{t(locale, "orchProposalChoose")}</option>
                {p.stages.map((s) => <option key={s.stage} value={`stage:${s.stage}`}>{fill(t(locale, "orchProposalMove"), { n: s.stage })}</option>)}
                <option value="close">{t(locale, "orchProposalClose")}</option>
                <option value="to_wish">{t(locale, "orchProposalToWish")}</option>
              </select>
              : <small className="orch-hint">{t(locale, "orchProposalIfAccepted")}</small>}
          </section>
        ))}
        {/* D-027: what the plan leaves without criteria and the new stages stay in view */}
        {p.uncovered.length > 0 && <p className="orch-proposal__lost" data-orch-proposal-uncovered>{fill(t(locale, "orchProposalUncovered"), { list: p.uncovered.map((id) => idLabel(locale, id)).join(", ") })}</p>}
        <p className="orch-hint" data-orch-proposal-stages>{fill(t(locale, "orchProposalStages"), { stages: p.stages.map((s) => `${s.stage}. ${s.title}`).join("; ") })}</p>
      </div>
      {noting && <textarea rows={2} value={note} placeholder={t(locale, "orchProposalNote")} aria-label={t(locale, "orchProposalNote")} onChange={(e) => setNote(e.target.value)} data-orch-proposal-note />}
      <FormFoot>
        <button type="button" className="orch-primary" disabled={sending} data-orch-primary="plan_return" data-orch-proposal-return
          onClick={() => onDecide({ proposalTurnId: p.proposalTurnId, decision: "return", choices: [], note: note.trim() || null, runKey: d.runKey })}>
          {t(locale, "orchProposalReturn")}</button>
        {!noting && <button type="button" className="orch-textual" data-orch-proposal-note-open onClick={() => setNoting(true)}>{t(locale, "orchProposalNoteOpen")}</button>}
      </FormFoot>
      {/* mock-up 11: the dangerous way out is a row of its own: «Принять снятие…» and what it asks */}
      <div className="orch-zone__danger" data-orch-danger-row>
        {p.findings.length > 0 && !picking
          ? <span className="orch-zone__danger-row"><button type="button" className="orch-stop" disabled={sending} data-orch-proposal-accept-open onClick={() => setPicking(true)}>{t(locale, "orchProposalAcceptOpen")}</button><small>{t(locale, "orchProposalPerItem")}</small></span>
          : <span className="orch-zone__danger-row">
            <DangerConfirm locale={locale} label={t(locale, "orchProposalAcceptDrop")} text={t(locale, "orchProposalAcceptWarn")} disabled={sending || !ready}
              attr={{ "data-orch-proposal-accept": true, ...(ready ? {} : { "aria-describedby": waitId }) }} onConfirm={accept} />
            {!ready && <small id={waitId} data-orch-proposal-pick>{t(locale, "orchProposalPickFirst")}</small>}
          </span>}
      </div>
    </Form>
  );
}
