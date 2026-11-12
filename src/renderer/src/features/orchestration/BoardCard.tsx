// B2: the task board on the canvas (stage-b-board.md §6). One card per workspace, moved and resized as an agent card
// is. Its columns and every line of a task card come from the shared status (boardStatuses) and the same display rules
// as the agent cards (runStatus); the board only sends what the person asked for — main checks every rule.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LocaleId, SessionBounds } from "../../../../shared/contracts";
import type { OrchestrationAgentLink } from "../../../../shared/orchestration";
import { AUTOPILOT_BUDGET, type AutopilotLimit, type AutopilotStopCode, conflictsOf, placeKey, externalInForce, isCopy, startBase, taskText, mergeMark, parallelOf, type AutopilotBudget, type AutopilotState, type BoardHead, type BoardMerge, type BoardTask, type ImportReport, type InboxRow, type InboxTask, type RunTaskFacts, type TaskColumn, type TaskStatus } from "../../../../shared/taskBoard";
import { pluralForm, t, type TranslationKey } from "../../lib/i18n";
import { Dialog } from "../../components/Dialog";
import { UiIcon } from "../../components/UiIcon";
import { ACTIVE_STATUSES, costOf, providerName, resetTime, tokensText } from "./runModel";
import { ASKS_HINT_OVER, askCount, splitActions, stopText, subtaskInfo, taskLine, tr, unsplit } from "./boardModel";
import { conditionsLine, short } from "./runStatus";
import type { AgentCanvasUi } from "./useAgentCanvasUi";
import type { Board } from "./useBoard";
import { RESIZE_DIRECTIONS, useCardFrame } from "./useCardFrame";
import type { Orchestration } from "./useOrchestration";

export const BOARD_SIZE = { width: 1040, height: 560 };
const LIMITS = { min: { width: 560, height: 320 }, max: { width: 4000, height: 3000 } };
const COLUMNS: TaskColumn[] = ["queue", "work", "review", "done"];

export interface BoardCardProps {
  board: Board;
  orch: Orchestration; // this workspace's agents and links (the scene's)
  ui: AgentCanvasUi;
  locale: LocaleId;
  workspaceId: string;
  bounds: SessionBounds;
  zoom: number;
  stackIndex: number;
  selected: boolean;
  snapEnabled: boolean;
  snapTargets: readonly SessionBounds[];
  defaultProject: string | null;
  onBoundsChange(bounds: SessionBounds): void;
  onHide(): void;
  onRaise?(): void; // the card goes to the top of the canvas stack (the import report sits outside its box)
}

export function BoardCard(props: BoardCardProps): React.JSX.Element {
  const { board, orch, ui, locale, workspaceId } = props;
  const frame = useCardFrame({ bounds: props.bounds, zoom: props.zoom, snapEnabled: props.snapEnabled, snapTargets: props.snapTargets, limits: LIMITS,
    onMoved: props.onBoundsChange, onResized: props.onBoundsChange });
  const { position, size } = frame.bounds;
  const [showArchive, setShowArchive] = useState(false);
  const [form, setForm] = useState<{ task: BoardTask | null } | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null); // F2: «Выполнено» asked for this external task (its note)
  const [note, setNote] = useState("");
  const [anyway, setAnyway] = useState<string | null>(null); // «Start anyway» asked for this task
  const [message, setMessage] = useState<{ taskId: string | null; text: string } | null>(null);
  // F1 (T-2): «Import tasks» under way, and the report window (the button's result, or an inbox/ file's after «Import»)
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  // R4: the report plate: raises the card, goes to the left when the right has no room, takes focus and gives it back to «Import»
  const asideRef = useRef<HTMLDivElement>(null);
  const [apAsking, setApAsking] = useState<string | null>(null); // R5f: the link whose autopilot form is open (a plate beside the card)
  const [menuOpen, setMenuOpen] = useState(false);
  // §11.6: a task's «Details» stays open or shut for as long as the board is open
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleMore = (id: string): void => setExpanded((cur) => { const n = new Set(cur); if (!n.delete(id)) n.add(id); return n; });
  const importRef = useRef<HTMLButtonElement>(null);
  const [asideLeft, setAsideLeft] = useState(false);
  const closeReport = (): void => { setReport(null); importRef.current?.focus(); };
  useEffect(() => {
    if (!menuOpen) return;
    const off = (e: PointerEvent): void => { if (!(e.target as Element | null)?.closest(".board-menu")) setMenuOpen(false); };
    const esc = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.stopPropagation(); setMenuOpen(false); } };
    document.addEventListener("pointerdown", off, true);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", off, true); document.removeEventListener("keydown", esc, true); };
  }, [menuOpen]);
  const asideOpen = !!report || !!apAsking;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the plate opens or closes, not on every render
  useLayoutEffect(() => {
    setAsideLeft(false);
    const el = asideRef.current;
    if (!el) return;
    props.onRaise?.();
    if (el.getBoundingClientRect().right > window.innerWidth) setAsideLeft(true);
    el.querySelector<HTMLElement>("[data-board-import-close], [data-board-budget-runs]")?.focus();
  }, [asideOpen]);
  const newInputs = window.canvasTTY.orchestration.newInputs;
  const view = board.view;
  const readOnly = !!view?.readOnly;
  const tasks = (view?.board.tasks ?? []).filter((x) => x.workspaceId === workspaceId);
  const keyOf = (id: string) => tasks.find((x) => x.id === id)?.key ?? "?";
  const keysOf = (ids: string[]) => ids.map(keyOf).join(", ");
  const shown = tasks.filter((x) => (showArchive ? x.archivedAt : !x.archivedAt));
  const leadOf = (l: OrchestrationAgentLink) => orch.canvas.agents.find((a) => a.agentId === l.fromAgentId);
  // C1: a link whose runs go on in separate copies is free for another task (main checks the slot and the mode)
  const busy = (l: OrchestrationAgentLink) => l.runIds.slice(-4).some((id) => {
    const v = orch.runs[id]?.view;
    return !!v && ((ACTIVE_STATUSES.includes(v.status) && !isCopy(v.workMode)) || !!v.newer);
  });
  const say = (taskId: string | null, text: string) => {
    setMessage({ taskId, text });
    window.setTimeout(() => setMessage((m) => (m?.text === text ? null : m)), 8000);
  };
  const failure = (r: { ok: boolean; code?: string; message?: string }) => (r.ok ? null : tr(locale, `orchError_${r.code}`) || r.message || String(r.code));
  // «Start»: the goal dialog of a free link of the task's folder, with the task's text, requirements and goal.task
  const start = (task: BoardTask, startAnyway = false) => {
    const links = orch.canvas.links.filter((l) => leadOf(l)?.project === task.project);
    const link = links.find((l) => !busy(l));
    if (!link) { say(task.id, tr(locale, "boardNoLink", { project: task.project })); return; }
    // C2: a place with the board's merged head starts from it (its dependencies are there, decision 9); else B's base
    const base = view ? startBase(task, view.board, board.statuses, view.facts, view.heads ?? []) : null;
    ui.openGoal(link.linkId, { id: task.id, key: task.key, title: task.title, text: taskText(task, view?.board.tasks ?? [], locale === "ru" ? "ru" : "en"), criteria: task.criteria, ...(startAnyway ? { anyway: true } : {}), ...(base ? { base } : {}) });
  };
  const boardProjects = [...new Set(orch.canvas.agents.map((a) => a.project))];
  const projects = [...new Set([...orch.canvas.agents.map((a) => a.project), ...(props.defaultProject ? [props.defaultProject] : [])])];
  const language = locale === "ru" ? "ru" : "en";
  // C1: the board's merged head of each project of this workspace
  const heads = (view?.heads ?? []).filter((h) => h.workspaceId === workspaceId);
  const headOf = (task: BoardTask) => heads.find((h) => h.project === task.project);
  const [merging, setMerging] = useState<string | null>(null); // «Объединить» of a task not started from the head, asked
  const [over, setOver] = useState<string | null>(null); // C2: «Запустить сейчас сверх лимита» asked for this task
  const queueAct = async (action: "run" | "cancel", task: BoardTask) => { setOver(null); const f = failure(await board.queue(action, task.id)); if (f) say(task.id, f); };
  const mergeTask = async (task: BoardTask) => { setMerging(null); const f = failure(await board.merge(task.id, language)); if (f) say(task.id, f); };
  // E4 (stage-e-decomposition.md §10): «Split» / «Split again» start the decomposition run; «Do it whole» takes the mark off
  // F2 (T-3): «Выполнено» (with the note) and «Снять отметку» of an external task
  const markAct = async (task: BoardTask, done: boolean) => {
    setMarking(null);
    const f = failure(await board.external(task.id, done, done && note.trim() ? note : undefined));
    if (f) say(task.id, f);
  };
  const splitAct = async (task: BoardTask, action: "decompose" | "whole") => {
    const f = failure(await (action === "decompose" ? board.decompose(task.id, language) : board.update(task.id, { decompose: false })));
    if (f) say(task.id, f);
  };
  // a subtask's key links to its card (a parent's to the parent's)
  const goTo = (key: string) => {
    const el = document.querySelector<HTMLElement>(`[data-board="${workspaceId}"] [data-board-task="${key}"]`);
    el?.scrollIntoView({ block: "nearest" });
    el?.querySelector<HTMLElement>(".board-task__title")?.focus();
  };

  // R7b (mock 08): the header's amber chip — the person's turn on the board; the autopilot's own chip says it already when it waits for the person
  const inReview = tasks.filter((x) => !x.archivedAt && board.statuses.get(x.id)?.column === "review").length;
  const askedPerm = tasks.some((x) => !x.archivedAt && board.statuses.get(x.id)?.reason === "waits_permission");
  const youWait = inReview > 0 ? "review" : askedPerm ? "permission" : null;
  const apSaysSo = !!view?.autopilot && Object.values(view.autopilot).some((a) => a?.on && ["person", "permission", "accept", "merge"].includes(a.waits ?? ""));
  return (
    <article className={`board-card ${props.selected ? "board-card--selected" : ""}`} data-interactive="true" data-board={workspaceId}
      data-canvas-layer-id={`board:${workspaceId}`} aria-label={t(locale, "boardTitle")}
      style={{ zIndex: props.stackIndex, width: size.width, height: size.height, transform: `translate(${position.x}px, ${position.y}px)` }}>
      <header className="board-card__header" {...frame.header}>
        <UiIcon name="kanban" size="1.25em" />
        <strong>{t(locale, "boardTitle")}{boardProjects.length === 1 ? ` · ${boardProjects[0]!.split("/").filter(Boolean).at(-1)}` : ""}</strong>
        {readOnly && <span className="board-card__readonly" role="status">{t(locale, "boardReadOnly")}</span>}
        <span className="board-card__header-actions">
          {view && !readOnly && orch.canvas.links.map((l) => (
            <ApSegment key={l.linkId} locale={locale} state={view.autopilot?.[l.linkId] ?? null} project={leadOf(l)?.project ?? ""} many={orch.canvas.links.length > 1} asking={apAsking === l.linkId}
              onAsk={() => setApAsking(l.linkId)} onOff={async () => { const f = failure(await board.autopilot(l.linkId, false, language)); if (f) say(null, f); }} />
          ))}
          {youWait && !apSaysSo && !readOnly && <span className="board-ap"><span className="board-chip board-chip--waiting" data-board-waits-you={youWait}>{t(locale, youWait === "review" ? "boardWaitsYouReview" : "boardWaitsYouPermission")}</span></span>}
          <button type="button" className="board-card__import" ref={importRef} data-board-import disabled={readOnly || !newInputs || importing} aria-busy={importing}
            title={newInputs ? undefined : t(locale, "boardImportCode_unsupported_platform")} onClick={async () => {
              setImporting(true);
              const r = await board.importFile();
              setImporting(false);
              if (!r.ok) say(null, importText(locale, r.code, r.message));
              else if (r.value) setReport(r.value);
            }}><UiIcon name="inbox" size="1.15em" />{importing ? `${t(locale, "boardImport")}…` : t(locale, "boardImport")}</button>
          <span className="board-menu">
            <button type="button" className="board-card__icon" data-board-menu aria-expanded={menuOpen} title={t(locale, "boardMenu")} aria-label={t(locale, "boardMenu")}
              onClick={() => setMenuOpen((v) => !v)}><UiIcon name="sliders-horizontal" size="1.2em" /></button>
            {menuOpen && (
              <div className="board-menu__list">
                <button type="button" data-board-archive-toggle aria-pressed={showArchive} onClick={() => { setShowArchive((v) => !v); setMenuOpen(false); }}>
                  {t(locale, showArchive ? "boardHideArchive" : "boardShowArchive")}</button>
                <button type="button" data-board-hide onClick={props.onHide}>{t(locale, "boardHide")}</button>
              </div>
            )}
          </span>
        </span>
      </header>
      {view && !readOnly && heads.filter((h) => headHasNews(h) || notMergedOf(h, tasks, board.statuses, view.facts).length > 0).map((h) => (
        <HeadRow key={h.ref} locale={locale} head={h} tasks={tasks} statuses={board.statuses} facts={view.facts} board={board} workspaceId={workspaceId} say={(text) => say(null, text)} failure={failure} openRun={(id) => ui.openRunById(id)} />
      ))}
      {!!view?.inbox?.some((r) => (r.workspaceId ?? workspaceId) === workspaceId) && <div className="board-card__inbox-list" data-wheel-owner="local">
      {(view?.inbox ?? []).filter((r) => (r.workspaceId ?? workspaceId) === workspaceId).map((r) => (
        <InboxLine key={r.file} locale={locale} row={r} readOnly={readOnly}
          onImport={async () => {
            const x = await board.inboxImport(r.file, r.sha256);
            if (!x.ok) say(null, importText(locale, x.code, x.message));
            else setReport(x.value); // imported — the result; checked — the board moved on: the new report, a second «Import»
          }}
          onReject={async () => { const x = await board.inboxReject(r.file); if (!x.ok) say(null, importText(locale, x.code, x.message)); }} />
      ))}</div>}
      {board.failed && !view && <p className="board-card__message" role="alert">{t(locale, "boardLoadFailed")} ({board.failed})</p>}
      {message && !message.taskId && <p className="board-card__message" role="alert">{message.text}</p>}
      {view && tasks.length === 0 && <p className="board-card__empty" data-board-empty>{t(locale, "boardEmpty")}</p>}
      {/* §11.6: «Details» opens inside the card and its column grows */}
      <div className="board-card__columns" data-wheel-owner="local"
        style={{ gridTemplateColumns: COLUMNS.map((column) => (shown.some((x) => expanded.has(x.id) && board.statuses.get(x.id)?.column === column && !showArchive) ? "minmax(0, 1.7fr)" : "minmax(0, 1fr)")).join(" ") }}>
        {COLUMNS.map((column) => {
          const items = shown.filter((x) => (showArchive ? column === "queue" : board.statuses.get(x.id)?.column === column))
            .sort((a, b) => a.order - b.order);
          return (
            <section key={column} className={`board-card__column board-card__column--${column}`} data-board-column={column} aria-label={t(locale, `boardCol_${column}`)}>
              <h3><span className="board-card__col-name">{showArchive && column === "queue" ? t(locale, "boardArchived") : t(locale, `boardCol_${column}`)}</span> <span data-board-count>{items.length}</span>
                {column === "queue" && !showArchive && <button type="button" className="board-card__icon board-card__add" data-board-new disabled={readOnly} title={t(locale, "boardNewTask")} aria-label={t(locale, "boardNewTask")}
                  onClick={() => setForm({ task: null })}><UiIcon name="plus" size="1.2em" /></button>}</h3>
              <ul className="board-card__list">
                {items.length === 0 && <li className="board-card__column-empty"><strong>{t(locale, "boardColumnEmpty")}</strong>{column === "done" && !showArchive && <span>{t(locale, "boardColumnEmptyDone")}</span>}</li>}
                {items.map((task) => {
                  const st = board.statuses.get(task.id)!;
                  const runId = st.current;
                  const run = runId ? orch.runs[runId] : undefined;
                  // E4: a parent has no run of its own — its line, answer and «Open the split» follow its decomposition run
                  const lineId = runId ?? st.split?.runId ?? null;
                  const entries = runId ? orch.activity[runId]?.entries ?? [] : [];
                  const fact = lineId ? view?.facts.find((f) => f.runId === lineId) : undefined;
                  const base = taskLine(locale, st, run ? { view: run.view, entries, open: run.open } : null, fact?.limit ?? null, fact?.providerLimit ?? null);
                  // what is asked, in the request's own words and the CLI's reason (answered in the run panel: one home for answers)
                  // F2: an external task in force — the person's mark is what it waits for, never a run
                  const external = externalInForce(task, st);
                  // F3 (T-13c): a place at a remote base — its tasks are started by the autopilot, no split there
                  const remote = !!view?.remoteBase?.includes(placeKey(task));
                  const splitOff = remote && unsplit(task, st) && st.column === "queue" && !st.reason;
                  const depsOpen = task.dependsOn.some((d) => tasks.some((x) => x.id === d) && !board.statuses.get(d)?.done);
                  const permission = st.reason === "waits_permission" ? (lineId ? orch.runs[lineId] : undefined)?.view.permission : null;
                  const line = external && !st.done && !st.reason ? t(locale, "boardExternalWaits") : splitOff ? t(locale, "orchError_remote_base_mode")
                    // §11.6: «Работает · ход 3»; who and which stage is the next line
                    : !st.done && !st.reason && st.column === "work" && run?.view.status === "running" && run.view.turns > 0 ? tr(locale, "boardWorking", { n: run.view.turns }) : base;
                  // shown once the run's feed is here: «0» before it loads would be a guess
                  const asks = runId && orch.activity[runId]?.status === "ready" ? askCount(entries) : 0;
                  const conditions = run?.view.progress?.conditions ?? null;
                  const blocking = (run?.view.progress?.findings?.items ?? []).filter((x) => x.severity === "blocking" && x.status === "open");
                  // §11.6: one line of substance — the executor and its stage while it works, the checks' count while it is reviewed
                  const stageTotal = lineId ? Object.keys(orch.stageTitles(lineId) ?? {}).length : 0;
                  const stage = run?.view.stage != null && stageTotal >= run.view.stage ? tr(locale, "orchAgentStageOf", { n: run.view.stage, m: stageTotal }) : null;
                  const executor = providerName(orch.catalog.providers?.executor.provider ?? "claude");
                  const essence = !run ? null : st.column === "work" ? [stage ? `${executor} · ${stage}` : executor, run.view.stage != null ? orch.stageTitles(lineId!)?.[run.view.stage] : null].filter(Boolean).join(" — ")
                    : st.column === "review" && conditions && conditions.total > 0 ? conditionsLine(locale, run.view) : null;
                  const docs = runId ? <>
                    <button type="button" data-board-open-plan onClick={() => ui.openRunById(runId, { tab: "summary", section: "plan" })}>{t(locale, "orchTab_plan")}</button>
                    <button type="button" data-board-open-result onClick={() => ui.openRunById(runId, { tab: "summary", section: "result" })}>{t(locale, "orchTab_result")}</button>
                  </> : null;
                  const cost = run ? costOf(run.view, entries, Date.now()) : null;
                  const sum = (f: (r: "lead" | "executor" | "reviewer") => number): number => (["lead", "executor", "reviewer"] as const).reduce((n, r) => n + f(r), 0);
                  const calls = cost ? sum((r) => cost.calls[r]) : 0;
                  const tokensIn = cost ? sum((r) => cost.tokens[r]?.input ?? 0) : 0;
                  const tokensOut = cost ? sum((r) => cost.tokens[r]?.output ?? 0) : 0;
                  // the tasks that go on once this one is accepted
                  const next = tasks.filter((x) => !x.archivedAt && x.dependsOn.includes(task.id)).map((x) => x.key);
                  // «after T-2» while T-2 is not done and the line does not say so already
                  const open = task.dependsOn.filter((d) => !board.statuses.get(d)?.done);
                  const after = open.length && st.reason !== "waits_task" && st.reason !== "waits_external" ? tr(locale, "boardAfter", { keys: keysOf(open) }) : null;
                  const archived = !!task.archivedAt;
                  // C1 (§4.4): «Done · in the board's result / merging / not merged: why», from the merge journals
                  const head = headOf(task);
                  const mark = st.done ? mergeMark(task.id, head, st.current) : null;
                  // decision 15: «already in the result» when nothing was merged; «without checks» only when there were none
                  const markText = mark && (mark.kind === "in_board" ? t(locale, mark.already ? "boardMark_in_board_already" : mark.checks ? "boardMark_in_board" : "boardMark_in_board_nochecks")
                    : mark.kind === "merging" ? t(locale, mark.agent ? "boardMark_merging_agent" : "boardMark_merging") : tr(locale, "boardMark_not_merged", { reason: tr(locale, `boardMergeReason_${mark.reason}`) || mark.reason }));
                  const canMerge = !!st.done && isCopy(fact?.workMode) && (!mark || (mark.kind === "not_merged" && !mark.waits));
                  // C2: a start waiting for a place (decision 12), and the files it shares with others (§4.7)
                  const queued = view?.queued?.find((q) => q.taskId === task.id);
                  const overlaps = board.overlaps.get(task.id) ?? [];
                  // E4 (§10): a parent's row of §2.1, its subtasks; a subtask's parent
                  // F3: at a remote base no split is started — «Do it whole» takes the mark off
                  const acts = remote ? [...new Set(splitActions(task, st, true).map((a) => (a === "run" || a === "again" ? "whole" : a)))] : splitActions(task, st);
                  const subs = view ? subtaskInfo(task, tasks, board.statuses, view.facts, view.heads ?? []) : null;
                  const parent = task.parentId ? tasks.find((x) => x.id === task.parentId) : undefined;
                  // R5f: the card's tone — the person's turn (or a run on pause, R6-C) amber, a run going green, a failure red; the glyph says it too
                  const tone = st.reason === "push_option_field" ? "danger" : st.column === "review" || st.reason === "waits_permission" || (st.column === "work" && run?.view.status === "paused") ? "waiting" : st.column === "work" ? "working" : null;
                  return (
                    <li key={task.id} className={`board-task board-task--${st.column}${st.done ? ` board-task--done-${st.done}` : ""}`}
                      data-board-task={task.key} data-board-task-column={st.column} data-board-done={st.done ?? undefined} data-board-reason={st.reason ?? undefined}>
                      <button type="button" className="board-task__title" aria-label={`${task.key} ${task.title}. ${line}`}
                        onClick={() => (runId ? ui.openRunById(runId) : setForm({ task }))} title={task.title}>
                        {task.title}
                      </button>
                      {st.reason === "push_option_field" ? <>
                        <div className="board-task__mono" data-board-push-option>{`push-option: {${st.field ?? "issue"}}`}</div>
                        <div className="board-task__risk board-task__risk--push" data-board-line title={line}><UiIcon name="error" size="1.15em" /><span data-board-line-text>{line}</span></div>
                      </> : <div className="board-task__line" data-board-line title={line}>
                        {st.done === "confirmed" ? <span className="board-task__badge board-task__badge--confirmed board-task__glyph board-task__glyph--done" aria-hidden="true"><UiIcon name="status-done" size="1.15em" /></span>
                          : st.done ? <span className={`board-task__badge board-task__badge--${st.done}`} aria-hidden="true">✋</span>
                          : tone && <span className={`board-task__glyph board-task__glyph--${tone}`} aria-hidden="true"><UiIcon name={tone === "waiting" ? "bell" : tone === "danger" ? "error" : "working"} size="1.15em" /></span>}
                        <span data-board-line-text>{line}</span>
                      </div>}
                      {essence && <div className="board-task__essence" data-board-essence title={essence}>{essence}</div>}
                      {/* §11.6: the risk is in view always — a permission request (amber) and the blocking findings (red) */}
                      {permission && <div className="board-task__risk board-task__risk--ask" data-board-risk="permission">
                        <UiIcon name="status-failed" size="1.15em" />
                        <span><code>{tr(locale, "boardRiskPermission", { what: permission.summary })}</code>
                          {(permission.why?.text || permission.why?.type) && <small>{`${t(locale, "orchCliWhy")}: ${permission.why?.text || permission.why?.type}`}</small>}</span>
                      </div>}
                      {blocking.length > 0 && <div className="board-task__risk board-task__risk--block" data-board-risk="blocking" title={blocking.map((x) => x.problem).join("\n")}>
                        <UiIcon name="error" size="1.15em" />
                        <span>{tr(locale, "boardRiskBlocking", { n: blocking.length, what: blocking.map((x) => short(x.problem, 48)).join(", ") })}</span>
                      </div>}
                      {task.external && <div className="board-task__line board-task__hint board-task__chip" data-board-external={external ? (st.done ? "done" : "waits") : "runs"}
                        title={task.externalDone?.note ?? undefined}>{external ? t(locale, "boardExternal") : t(locale, "boardReason_external_has_runs")}{external && task.externalDone?.note ? ` · ${task.externalDone.note}` : ""}</div>}
                      {st.depsNote && <div className="board-task__line board-task__hint" data-board-deps-note={st.depsNote}>{t(locale, `boardDepsNote_${st.depsNote}`)}</div>}
                      {parent && <div className="board-task__line" data-board-part-of={parent.key}>
                        <button type="button" className="board-task__link" onClick={() => goTo(parent.key)}>{tr(locale, "boardPartOf", { key: parent.key })}</button>
                        {parent.archivedAt && <span data-board-parent-archived>{` · ${t(locale, "boardParentArchived")}`}</span>}</div>}
                      {parent && task.covers?.length ? <div className="board-task__line board-task__hint" data-board-covers>{tr(locale, "boardCovers", { ids: task.covers.join(", "), key: parent.key })}</div> : null}
                      {subs && <div className="board-task__line" data-board-subtasks={`${subs.done}/${subs.live.length}`}>{tr(locale, "boardSubtasks", { done: subs.done, n: subs.live.length })}
                        {subs.live.map((x) => <button key={x.id} type="button" className="board-task__link" data-board-subtask-link={x.key} onClick={() => goTo(x.key)}>{` ${x.key}`}</button>)}</div>}
                      {subs?.archived.map((x) => <div key={x.id} className="board-task__line board-task__hint" data-board-subtask-archived={x.key}>{tr(locale, "boardSubtaskArchived", { key: x.key })}</div>)}
                      {subs?.criteriaChanged && <div className="board-task__line board-task__hint" data-board-criteria-changed>{t(locale, "boardCriteriaChanged")}</div>}
                      {after && <div className="board-task__line" data-board-after title={after}>{after}</div>}
                      {markText && <div className="board-task__line" data-board-merge-mark={mark!.kind === "in_board" && mark!.already ? "already" : mark!.kind} title={markText}>{markText}</div>}
                      {queued && !queued.failed && <div className="board-task__line" data-board-queued title={tr(locale, "boardQueued", { busy: queued.busy, limit: queued.limit })}>
                        {tr(locale, "boardQueued", { busy: queued.busy, limit: queued.limit })}</div>}
                      {queued?.failed && <div className="board-task__line board-task__hint" data-board-queued-failed={queued.failed}>
                        {tr(locale, "boardQueuedFailed", { reason: tr(locale, `orchError_${queued.failed}`) || queued.failed })}</div>}
                      {over === task.id && queued && (
                        <div className="board-task__confirm" role="alertdialog" aria-label={t(locale, "boardQueuedOver")} data-board-over-confirm>
                          <p>{tr(locale, "boardQueuedOverWhy", { busy: queued.busy, limit: queued.limit, key: task.key })}</p>
                          <button type="button" className="orch-primary" data-board-over-yes onClick={() => void queueAct("run", task)}>{t(locale, "boardQueuedOver")}</button>
                          <button type="button" onClick={() => setOver(null)}>{t(locale, "orchCancel")}</button>
                        </div>
                      )}
                      {merging === task.id && (
                        <div className="board-task__confirm" role="alertdialog" aria-label={t(locale, "boardMerge")} data-board-merge-confirm>
                          <p>{tr(locale, "boardMergeNotFromHead", { key: task.key })}</p>
                          <button type="button" className="orch-primary" data-board-merge-yes onClick={() => void mergeTask(task)}>{t(locale, "boardMerge")}</button>
                          <button type="button" onClick={() => setMerging(null)}>{t(locale, "orchCancel")}</button>
                        </div>
                      )}
                      {expanded.has(task.id) && (conditions || blocking.length > 0 || overlaps.length > 0 || run) && <dl className="board-task__kv" data-board-kv>
                        {conditions && conditions.total > 0 && <>
                          <dt>{tr(locale, "boardKv_criteria", { met: conditions.met, total: conditions.total })}</dt>
                          <dd><ul className="board-task__criteria" data-board-kv-criteria>{conditions.requirements.map((r) => <li key={r.id} data-status={r.status}>{r.text}</li>)}</ul></dd>
                        </>}
                        {run?.view.progress?.findings && <><dt>{t(locale, "boardKv_blocking")}</dt><dd className={blocking.length > 0 ? "board-task__kv-warn" : undefined}>{blocking.length}</dd></>}
                        {overlaps.length > 0 && <><dt>{t(locale, "boardKv_overlaps")}</dt>
                          <dd>{overlaps.map((o) => <div key={`${o.kind}:${o.key}`} data-board-overlap={o.kind} data-board-overlap-with={o.key} title={o.files.join(", ")}>
                            {tr(locale, o.kind === "now" ? "boardOverlapNow" : "boardOverlapMaybe", { key: o.key, files: o.files.slice(0, 5).join(", ") + (o.files.length > 5 ? " …" : "") })}</div>)}</dd></>}
                        {calls > 0 && <><dt>{t(locale, "boardKv_calls")}</dt><dd data-board-kv-calls>{calls}</dd></>}
                        {tokensIn + tokensOut > 0 && <><dt>{t(locale, "boardKv_tokens")}</dt><dd data-board-kv-tokens>{tr(locale, "boardKv_tokensValue", { input: tokensText(locale, tokensIn), output: tokensText(locale, tokensOut) })}</dd></>}
                        {st.attempts > 1 && <><dt>{t(locale, "boardKv_attempts")}</dt><dd>{st.attempts}</dd></>}
                        {asks > 0 && <><dt>{t(locale, "boardKv_asks")}</dt><dd data-board-kv="asks">{asks}{asks > ASKS_HINT_OVER && <small className="board-task__kv-hint" data-board-asks-hint>{t(locale, "boardAsksHint")}</small>}</dd></>}
                      </dl>}
                      {message?.taskId === task.id && <div className="board-task__message" role="alert">{message.text}</div>}
                      {accepting === task.id && (
                        <div className="board-task__confirm" role="alertdialog" aria-label={t(locale, "boardAccept")} data-board-accept-confirm>
                          <p>{t(locale, "boardAcceptWhy")}{next.length ? ` ${tr(locale, "boardAcceptNext", { keys: next.join(", ") })}` : ""}</p>
                          {st.depsWait && <p className="orch-hint orch-hint--warn" data-board-accept-deps>{tr(locale, "boardAcceptDepsWarn", { keys: st.depsWait.waitsFor.join(", ") })}</p>}
                          <button type="button" className="orch-primary" data-board-accept-yes onClick={async () => {
                            setAccepting(null);
                            const r = await board.accept(task.id);
                            const f = failure(r);
                            if (f) say(task.id, f);
                          }}>{t(locale, "boardAcceptConfirm")}</button>
                          <button type="button" onClick={() => setAccepting(null)}>{t(locale, "orchCancel")}</button>
                        </div>
                      )}
                      {marking === task.id && (
                        <div className="board-task__confirm" role="alertdialog" aria-label={t(locale, "boardExternalDone")} data-board-external-confirm>
                          <label className="orch-field">{t(locale, "boardExternalNote")}
                            <input type="text" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} data-board-external-note /></label>
                          <button type="button" className="orch-primary" data-board-external-yes onClick={() => void markAct(task, true)}>{t(locale, "boardExternalDone")}</button>
                          <button type="button" onClick={() => setMarking(null)}>{t(locale, "orchCancel")}</button>
                        </div>
                      )}
                      {anyway === task.id && (
                        <div className="board-task__confirm" role="alertdialog" aria-label={t(locale, "boardStartAnyway")} data-board-anyway-confirm>
                          <p>{tr(locale, `boardStartAnywayWhy_${st.depsWait?.reason ?? "waits_task"}`, { keys: st.depsWait?.waitsFor.join(", ") ?? "" })}</p>
                          <button type="button" className="orch-primary" data-board-anyway-yes onClick={() => { setAnyway(null); start(task, true); }}>{t(locale, "boardStartAnyway")}</button>
                          <button type="button" onClick={() => setAnyway(null)}>{t(locale, "orchCancel")}</button>
                        </div>
                      )}
                      <div className="board-task__foot">
                      {!readOnly && accepting !== task.id && anyway !== task.id && marking !== task.id && (
                        <div className="board-task__actions">
                          {archived ? (
                            <button type="button" data-board-unarchive onClick={() => void board.archive(task.id, false)}>{t(locale, "boardUnarchive")}</button>
                          ) : (
                            <>
                              {/* §4.2: by its dependencies, whatever its own column — ready: «Start»; not: «Start anyway», confirmed first */}
                              {queued && !queued.failed && over !== task.id && <>
                                <button type="button" data-board-over onClick={() => setOver(task.id)}>{t(locale, "boardQueuedOver")}</button>
                                <button type="button" data-board-queue-cancel onClick={() => void queueAct("cancel", task)}>{t(locale, "boardQueuedCancel")}</button>
                              </>}
                              {/* F2 (§10): the external task's mark — the only «Done» it has; «Снять отметку» while no dependent began (main checks) */}
                              {external && !st.done && <button type="button" className="orch-primary" data-board-external-done disabled={depsOpen}
                                title={depsOpen ? t(locale, "orchError_deps_not_done") : undefined} onClick={() => { setNote(""); setMarking(task.id); }}>{t(locale, "boardExternalDone")}</button>}
                              {external && st.done && <button type="button" data-board-external-undo onClick={() => void markAct(task, false)}>{t(locale, "boardExternalUndo")}</button>}
                              {!external && (st.column === "queue" || st.reason === "no_checks") && st.reason !== "run_newer" && !(queued && !queued.failed) && !unsplit(task, st) && (st.depsWait
                                ? <button type="button" data-board-start-anyway disabled={remote} title={remote ? t(locale, "orchError_remote_base_dialog") : undefined} onClick={() => setAnyway(task.id)}>{t(locale, "boardStartAnyway")}</button>
                                : <button type="button" data-board-start disabled={remote} title={remote ? t(locale, "orchError_remote_base_dialog") : undefined} onClick={() => start(task)}>{t(locale, st.attempts ? "boardStartAgain" : "boardStart")}</button>)}
                              {/* E4: the actions of a parent's row (§2.1); «Stop» is the split run's panel's */}
                              {acts.includes("run") && <button type="button" className="orch-primary" data-board-decompose onClick={() => void splitAct(task, "decompose")}>{t(locale, "boardDecomposeRun")}</button>}
                              {acts.includes("again") && <button type="button" className="orch-primary" data-board-decompose-again onClick={() => void splitAct(task, "decompose")}>{t(locale, "boardDecomposeAgain")}</button>}
                              {acts.includes("whole") && <button type="button" data-board-decompose-whole onClick={() => void splitAct(task, "whole")}>{t(locale, "boardDecomposeWhole")}</button>}
                              {acts.includes("answer") && st.split && <button type="button" className="orch-primary" data-board-split-answer onClick={() => ui.openRunById(st.split!.runId)}>{t(locale, "boardAnswer")}</button>}
                              {acts.includes("open") && st.split && <button type="button" data-board-split-open onClick={() => ui.openRunById(st.split!.runId)}>{t(locale, "boardDecomposeOpen")}</button>}
                              {runId && st.reason === "waits_permission" && <button type="button" className="orch-primary" data-board-open data-board-answer onClick={() => ui.openRunById(runId)}>{t(locale, "boardAnswer")}</button>}
                              {runId && <button type="button" data-board-open={st.reason === "waits_permission" ? "run" : ""} onClick={() => ui.openRunById(runId)}>{t(locale, "orchOpenRun")}</button>}
                              {runId && (st.column === "done" || archived) && docs}
                              {st.reason === "no_checks" && <button type="button" className="orch-primary" data-board-accept onClick={() => setAccepting(task.id)}>{t(locale, "boardAccept")}</button>}
                              {canMerge && merging !== task.id && <button type="button" data-board-merge
                                onClick={() => (head && fact?.board === head.ref ? void mergeTask(task) : setMerging(task.id))}>{t(locale, "boardMerge")}</button>}
                              {mark?.kind === "not_merged" && !mark.waits && mark.reason !== "skipped" && <button type="button" data-board-merge-skip-failed
                                onClick={async () => { const f = failure(await board.skip(mark.runId)); if (f) say(task.id, f); }}>{t(locale, "boardMergeSkip")}</button>}
                              {st.reason === "push_option_field" && <button type="button" data-board-open-task onClick={() => setForm({ task })}>{t(locale, "boardOpenTask")}</button>}
                              {(st.column === "queue" || st.column === "done") && <button type="button" data-board-edit onClick={() => setForm({ task })}>{t(locale, "boardEdit")}</button>}
                              {(st.column === "queue" || st.column === "done") && <button type="button" data-board-archive onClick={() => void board.archive(task.id, true)}>{t(locale, "boardArchive")}</button>}
                            </>
                          )}
                        </div>
                      )}
                      {(conditions || blocking.length > 0 || overlaps.length > 0 || run) && <button type="button" className="board-task__toggle" data-board-more aria-expanded={expanded.has(task.id)} onClick={() => toggleMore(task.id)}>
                        {t(locale, "boardMore")}<UiIcon name="chevron" size="1em" /></button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      {view && !readOnly && orch.canvas.links.length > 0 && (
        <footer className="board-ribbon" data-board-ribbon>
          <span className="board-ribbon__label">{t(locale, "boardApLabel")}</span>
          {orch.canvas.links.map((l) => (
            <ApRibbon key={l.linkId} locale={locale} state={view.autopilot?.[l.linkId] ?? null} project={leadOf(l)?.project ?? ""} many={orch.canvas.links.length > 1} />
          ))}
        </footer>
      )}
      {RESIZE_DIRECTIONS.map((direction) => (
        <div key={direction} className={`terminal-card__resize-handle terminal-card__resize-handle--${direction}`} aria-hidden="true" data-board-resize={direction}
          {...frame.handle(direction)} />
      ))}
      {/* R4c: the import's report is a side plate, not a modal: the columns stay in reach */}
      {(report || apAsking) && (
        <div ref={asideRef} className={`board-asides ${asideLeft ? "board-asides--left" : ""}`}>
          {report && (
            <aside className="board-aside" aria-label={t(locale, "boardImport")} data-board-aside
              onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeReport(); } }}>
              <div className="board-aside__head">
                <strong>{t(locale, "boardImportAside")}</strong>
              </div>
              <ImportReportView locale={locale} report={report} tasks={view?.inbox?.find((r) => r.file === report.file)?.tasks ?? []} board={tasks} />
              <div className="board-aside__foot"><button type="button" data-board-import-close onClick={closeReport}>{t(locale, "orchClose")}</button></div>
            </aside>
          )}
          {apAsking && view && orch.canvas.links.some((l) => l.linkId === apAsking) && (
            <ApForm locale={locale} state={view.autopilot?.[apAsking] ?? null}
              onCancel={() => { setApAsking(null); document.querySelector<HTMLElement>(`[data-board="${workspaceId}"] [data-board-autopilot-start]`)?.focus(); }}
              onBudget={async (b) => { const f = failure(await board.budget(apAsking, b)); if (f) say(null, f); }}
              onStart={async () => { setApAsking(null); const f = failure(await board.autopilot(apAsking, true, language)); if (f) say(null, f); }} />
          )}
        </div>
      )}
      {form && (
        <TaskForm locale={locale} task={form.task} remoteBase={(project) => !!view?.remoteBase?.includes(placeKey({ workspaceId: form.task?.workspaceId ?? workspaceId, project }))} splitLocked={!!form.task && ((board.statuses.get(form.task.id)?.attempts ?? 0) > 0 || tasks.some((x) => x.parentId === form.task!.id && !x.archivedAt))} tasks={tasks.filter((x) => !x.archivedAt)} projects={projects}
          dependents={form.task ? tasks.filter((x) => x.dependsOn.includes(form.task!.id)) : []}
          onClose={() => setForm(null)}
          onSave={async (input) => {
            const { decompose, ...rest } = input;
            const r = form.task ? await board.update(form.task.id, { title: input.title, text: input.text, criteria: input.criteria, dependsOn: input.dependsOn, ...(decompose !== !!form.task.decompose ? { decompose } : {}) })
              : await board.create({ workspaceId, ...rest, ...(decompose ? { decompose } : {}) });
            const f = failure(r);
            if (!f) setForm(null);
            return f;
          }}
          onDelete={form.task && !(board.statuses.get(form.task.id)?.attempts) ? async (dependents) => {
            const f = failure(await board.remove(form.task!.id, dependents));
            if (!f) setForm(null);
            return f;
          } : undefined} />
      )}
    </article>
  );
}

// «New task» / «Edit task»: the goal's fields without a start (§6). main checks the rest (lengths, cycles, the folder).
// remoteBase (F3, T-13c): the project's place takes its base from a remote branch — no «Split» there (remote_base_mode)
function TaskForm({ locale, task, remoteBase, splitLocked, tasks, projects, dependents, onClose, onSave, onDelete }: {
  locale: LocaleId; task: BoardTask | null; remoteBase(project: string): boolean; splitLocked: boolean; tasks: BoardTask[]; projects: string[]; dependents: BoardTask[]; onClose(): void;
  onSave(input: { project: string; title: string; text: string; criteria: string[]; dependsOn: string[]; decompose: boolean }): Promise<string | null>;
  // dependents: the tasks shown as losing this dependency (§4.2: removed openly, never on the quiet)
  onDelete?: (dependents: string[]) => Promise<string | null>;
}): React.JSX.Element {
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState(task?.title ?? "");
  const [text, setText] = useState(task?.text ?? "");
  const [criteria, setCriteria] = useState(task?.criteria.join("\n") ?? "");
  const [project, setProject] = useState(task?.project ?? projects[0] ?? "");
  const [depends, setDepends] = useState<string[]>(task?.dependsOn ?? []);
  const [decompose, setDecompose] = useState(!!task?.decompose); // E4 (§10)
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lines = criteria.split("\n").map((c) => c.trim()).filter(Boolean);
  const complete = title.trim() && text.trim() && lines.length > 0 && project.trim();
  const others = tasks.filter((x) => x.id !== task?.id);
  return (
    <Dialog label={t(locale, task ? "boardEditTask" : "boardNewTask")} onClose={onClose} locale={locale}>
      <form className="orch-form" data-board-form onSubmit={async (event) => {
        event.preventDefault();
        if (!complete) return;
        setBusy(true);
        setError(await onSave({ project: project.trim(), title: title.trim(), text: text.trim(), criteria: lines, dependsOn: depends, decompose }));
        setBusy(false);
      }}>
        {task && <div className="orch-field orch-field--static"><span>{t(locale, "boardTask")}</span><strong>{task.key}</strong></div>}
        <label className="orch-field"><span>{t(locale, "boardFieldTitle")}</span>
          <input data-board-field="title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} autoFocus /></label>
        <label className="orch-field"><span>{t(locale, "boardFieldText")}</span>
          <textarea data-board-field="text" value={text} maxLength={8000} rows={4} onChange={(e) => setText(e.target.value)} /></label>
        <label className="orch-field"><span>{t(locale, "boardFieldCriteria")}</span>
          <textarea data-board-field="criteria" value={criteria} rows={3} onChange={(e) => setCriteria(e.target.value)} /></label>
        <label className="orch-field"><span>{t(locale, "boardFieldProject")}</span>
          <input data-board-field="project" value={project} list="board-projects" disabled={!!task} onChange={(e) => setProject(e.target.value)} />
          <datalist id="board-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist></label>
        {/* E4 (§10): not for a subtask; not while the task has its own run or live subtasks */}
        {!task?.parentId && <label className="orch-field orch-field--check" title={remoteBase(project.trim()) && !task?.decompose ? t(locale, "orchError_remote_base_mode") : undefined}>
          <input type="checkbox" data-board-field="decompose" checked={decompose} disabled={splitLocked || (remoteBase(project.trim()) && !task?.decompose)}
          onChange={(e) => setDecompose(e.target.checked)} /> {t(locale, "boardDecompose")}</label>}
        {(
          <fieldset className="orch-field board-form__depends"><legend>{t(locale, "boardFieldDepends")}</legend>
            {others.length === 0 && <small className="orch-hint">{t(locale, "boardNoOtherTasks")}</small>}
            {others.map((x) => (
              <label key={x.id}><input type="checkbox" data-board-depends={x.key} checked={depends.includes(x.id)}
                onChange={(e) => setDepends((d) => (e.target.checked ? [...d, x.id] : d.filter((y) => y !== x.id)))} /> {x.key} · {x.title}</label>
            ))}
          </fieldset>
        )}
        {error && <p className="orch-error" role="alert">{error}</p>}
        {deleting && <p className="orch-hint orch-hint--warn" role="alert" data-board-delete-dependents>
          {tr(locale, "boardDeleteDependents", { keys: dependents.map((x) => x.key).join(", ") })}</p>}
        {!complete && <p className="orch-hint" data-board-form-incomplete>{t(locale, "boardFormIncomplete")}</p>}
        <div className="orch-actions">
          {onDelete && <button type="button" className="orch-danger" data-board-delete
            onClick={async () => (dependents.length && !deleting ? setDeleting(true) : setError(await onDelete(dependents.map((x) => x.id))))}>
            {t(locale, deleting ? "boardDeleteConfirm" : "boardDelete")}</button>}
          <button type="button" className="orch-cancel" onClick={onClose}>{t(locale, "orchCancel")}</button>
          <button type="submit" className="orch-primary" data-board-save disabled={!complete || busy}>{t(locale, "boardSave")}</button>
        </div>
      </form>
    </Dialog>
  );
}

// B4: «Run the board» on a link (stage-b-board.md §5), R5f (mock-up 08): the header's «Автопилот [Вкл|Выкл]» segment and the chip of what
// it waits for; the form (the budget, how many at once, who resolves a conflict) is a plate beside the card (ApForm); the strip at the
// bottom says the state in words (ApRibbon). Turning it on goes through the form's confirmation, as it always did.
function ApSegment({ locale, state, project, many, asking, onAsk, onOff }: {
  locale: LocaleId; state: AutopilotState | null; project: string; many: boolean; asking: boolean; onAsk(): void; onOff(): Promise<void>;
}): React.JSX.Element {
  const name = project.split("/").filter(Boolean).at(-1) ?? project;
  const on = !!state?.on;
  return (
    <span className="board-ap" data-board-autopilot={on ? "on" : "off"}>
      <span className="board-ap__label">{many ? `${t(locale, "boardApLabel")} · ${name}` : t(locale, "boardApLabel")}</span>
      <fieldset className="board-seg" aria-label={many ? tr(locale, "boardApLink", { project: name }) : t(locale, "boardApLabel")}>
        {on
          ? <button type="button" className="board-seg__on" aria-pressed="true" data-board-autopilot-on disabled>{t(locale, "boardApSegOn")}</button>
          : <button type="button" aria-pressed={asking} data-board-autopilot-start onClick={onAsk}>{t(locale, "boardApSegOn")}</button>}
        <button type="button" className={on || asking ? undefined : "board-seg__on"} aria-pressed={!on && !asking} data-board-autopilot-off disabled={!on} onClick={() => void onOff()}>{t(locale, "boardApSegOff")}</button>
      </fieldset>
      {on && state?.waits && <span className={`board-chip board-chip--${WAIT_TONE[state.waits] ?? "neutral"}`} title={state.waits === "provider_limit" && state.limit ? limitText(locale, state.limit) : undefined}
        data-board-autopilot-waits={state.waits}>{state.waits === "provider_limit" && state.limit ? limitText(locale, state.limit) : tr(locale, `boardApWaits_${state.waits}`, { key: state.waitsKey ?? "" })}</span>}
    </span>
  );
}

function ApRibbon({ locale, state, project, many }: { locale: LocaleId; state: AutopilotState | null; project: string; many: boolean }): React.JSX.Element {
  const budget = state?.budget ?? AUTOPILOT_BUDGET;
  const name = project.split("/").filter(Boolean).at(-1) ?? project;
  return (
    <span className="board-ribbon__item">
      {many && <span className="board-ribbon__link">{tr(locale, "boardApLink", { project: name })}</span>}
      {state?.on ? (
        <>
          <span className="board-ribbon__on"><UiIcon name="working" size="1em" />{t(locale, "boardApRibbonOn")}</span>
          {state.resumed && state.waits !== "provider_limit" && <span data-board-autopilot-resumed={state.resumed.key}>{tr(locale, "boardApResumed", { key: state.resumed.key, time: resetTime(locale, Date.parse(state.resumed.at)) })}</span>}
          {state.splitting && <span data-board-autopilot-splitting={state.splitting}>{tr(locale, "boardApDecomposing", { key: state.splitting })}</span>}
          <span data-board-autopilot-parallel>{tr(locale, "boardApOnParallel", { n: parallelOf(budget) })}</span>
          <span data-board-autopilot-conflicts={conflictsOf(budget)}>{`${t(locale, "boardApConflicts")}: ${t(locale, `boardApConflicts_${conflictsOf(budget)}`)}`}</span>
          <span data-board-autopilot-used>{tr(locale, "boardApUsed", { runs: state.used.runs, maxRuns: budget.runs, minutes: state.used.minutes, maxMinutes: budget.minutes })}</span>
        </>
      ) : state?.stop ? (
        <span className={`board-ribbon__stop${STOP_FAILED.has(state.stop.code) ? " board-ribbon__stop--danger" : ""}`} role="status" data-board-autopilot-stop={state.stop.code}>{tr(locale, "boardApLast", { reason: stopText(locale, state.stop) })}</span>
      ) : (
        <span data-board-autopilot-hint>{t(locale, "boardApRibbonOff")} · {t(locale, "boardApRestartHint")}</span>
      )}
    </span>
  );
}

function ApForm({ locale, state, onCancel, onBudget, onStart }: {
  locale: LocaleId; state: AutopilotState | null; onCancel(): void; onBudget(b: AutopilotBudget): Promise<void>; onStart(): Promise<void>;
}): React.JSX.Element {
  const budget = state?.budget ?? AUTOPILOT_BUDGET;
  const [runs, setRuns] = useState(String(budget.runs));
  const [minutes, setMinutes] = useState(String(budget.minutes));
  const [parallel, setParallel] = useState(parallelOf(budget));
  const [conflicts, setConflicts] = useState(conflictsOf(budget));
  const valid = /^\d+$/.test(runs) && +runs >= 1 && +runs <= 100 && /^\d+$/.test(minutes) && +minutes >= 1 && +minutes <= 1440;
  const changed = valid && (+runs !== budget.runs || +minutes !== budget.minutes || parallel !== parallelOf(budget) || conflicts !== conflictsOf(budget));
  return (
    <aside className="board-aside board-ap-form" data-board-autopilot-confirm aria-label={t(locale, "boardApLabel")}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}>
      <div className="board-aside__head"><strong>{t(locale, "boardApLabel")}</strong></div>
      <div className="board-import">
        <p className="board-ap-form__hint">{t(locale, "boardApRestartHint")}.</p>
        <div className="board-ap-form__field"><span>{t(locale, "boardApBudget")}</span>
          <span className="board-ap-form__pair">
            <label><input type="number" min={1} max={100} value={runs} onChange={(e) => setRuns(e.target.value)} data-board-budget-runs /><small>{t(locale, "boardApBudgetRuns")}</small></label>
            <label><input type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} data-board-budget-minutes /><small>{t(locale, "boardApBudgetMinutes")}</small></label>
          </span></div>
        <div className="board-ap-form__field" title={t(locale, "boardApParallelHint")}><span>{t(locale, "boardApParallelTitle")}</span>
          <fieldset className="board-seg board-seg--wide" aria-label={t(locale, "boardApParallelHint")} data-board-budget-parallel={parallel}>
            {[1, 2, 3, 4].map((n) => <button key={n} type="button" aria-pressed={parallel === n} className={parallel === n ? "board-seg__on" : undefined} data-board-budget-parallel-n={n} onClick={() => setParallel(n)}>{n}</button>)}
          </fieldset></div>
        {/* C3 (stage-c3-conflicts.md §8): who resolves a merge conflict */}
        <div className="board-ap-form__field" title={t(locale, "boardApConflictsHint")}><span>{t(locale, "boardApConflictsTitle")}</span>
          <fieldset className="board-seg board-seg--wide" aria-label={t(locale, "boardApConflictsHint")} data-board-budget-conflicts={conflicts}>
            {(["agent", "person"] as const).map((c) => <button key={c} type="button" aria-pressed={conflicts === c} className={conflicts === c ? "board-seg__on" : undefined} data-board-budget-conflicts-to={c} onClick={() => setConflicts(c)}>{t(locale, c === "agent" ? "boardApConflictsAgent" : "boardApConflictsPerson")}</button>)}
          </fieldset></div>
        <div className="board-ap-form__actions">
          <button type="button" className="orch-primary" data-board-autopilot-yes disabled={!valid} onClick={async () => { if (changed) await onBudget({ runs: +runs, minutes: +minutes, parallel, conflicts }); await onStart(); }}>{t(locale, "boardApToggle")}</button>
          <button type="button" onClick={onCancel}>{t(locale, "cancel")}</button>
        </div>
      </div>
    </aside>
  );
}

// R4c: the tone of a chip — the person and a provider's limit wait (amber), a run works (green), a failure of a run or a start is red
const WAIT_TONE: Record<string, "waiting" | "working" | "neutral"> = { person: "waiting", provider_limit: "waiting", run: "working", permission: "waiting", accept: "waiting", merge: "waiting", external: "neutral" };
const STOP_FAILED: ReadonlySet<AutopilotStopCode> = new Set(["run_failed", "run_unreadable", "take_failed", "start_failed", "merge_failed", "resume_failed", "decomposition_failed", "base_fetch_failed", "base_remote_mismatch"]);

// C4 (stage-c4-limits.md §5): what the autopilot waits for at a provider's limit
function limitText(locale: LocaleId, l: AutopilotLimit): string {
  const others = l.others ? tr(locale, "boardApLimitOthers", { n: l.others }) : "";
  const vars = { provider: providerName(l.provider), key: l.key, others };
  if (l.repeated) return tr(locale, "boardApWaits_provider_limit_repeated", vars);
  return l.resetsAt === null ? tr(locale, "boardApWaits_provider_limit_unknown", vars) : tr(locale, "boardApWaits_provider_limit", { ...vars, time: resetTime(locale, l.resetsAt) });
}
// C4 (§3): the resolution run under way waits — at a provider's limit or for the person
function agentWaitsText(locale: LocaleId, key: string, w: NonNullable<NonNullable<BoardMerge["agent"]>["waits"]>): string {
  if (w.kind === "person") return tr(locale, "boardHeadAgentPerson", { key });
  return w.resetsAt === null ? tr(locale, "boardHeadAgentLimitUnknown", { key, provider: providerName(w.provider) })
    : tr(locale, "boardHeadAgentLimit", { key, provider: providerName(w.provider), time: resetTime(locale, w.resetsAt) });
}
// C3/C4: the detail of «the agent did not resolve it»; paused:<reason> names the pause as a run's reason reads
function agentWhyDetail(locale: LocaleId, detail: string | null): string {
  if (!detail?.startsWith("paused:")) return detail ?? "";
  const reason = detail.slice(7);
  return t(locale, `orchReason_${reason}` as TranslationKey) || reason;
}

// C3: what a paused merge may be handed to an agent from (the application still refuses a lock file, a task not from the head)
const TO_AGENT = new Set(["merge_conflict", "merge_checks_failed", "merge_agent_failed", "merge_waits_slot", "merge_budget"]);

// C1 (stage-c-parallel.md §4.1, §4.3, §6.1): the board's merged head of a project — what is in it and whether its checks
// passed; the tasks «Done» from it and not in it; a merge that waits for the person, with its copy and its choices; and
// the person's own actions on it. Nothing here is automatic.
// R7b (mock 08 has no board-result row): the row shows once the board's result has something to say or to do
const headHasNews = (h: BoardHead): boolean => h.merges.length > 0 || (h.behind ?? 0) > 0 || !!h.otherLine;
// the tasks «Done» from this head's copy and not merged into it (the «Merge all» row)
function notMergedOf(head: BoardHead, tasks: BoardTask[], statuses: ReadonlyMap<string, TaskStatus>, facts: readonly RunTaskFacts[]): BoardTask[] {
  const done = head.merges.filter((m) => m.status === "completed");
  return tasks.filter((x) => {
    const st = statuses.get(x.id);
    const f = facts.find((y) => y.runId === st?.current);
    return x.project === head.project && st?.done && isCopy(f?.workMode) && f!.board === head.ref && !done.some((m) => m.task.id === x.id);
  });
}
function HeadRow({ locale, head, tasks, statuses, facts, board, workspaceId, say, failure, openRun }: {
  locale: LocaleId; head: BoardHead; tasks: BoardTask[]; statuses: ReadonlyMap<string, TaskStatus>; facts: readonly RunTaskFacts[]; board: Board;
  workspaceId: string; say(text: string): void; failure(r: { ok: boolean; code?: string; message?: string }): string | null; openRun(runId: string): void;
}): React.JSX.Element {
  const [asking, setAsking] = useState<null | "branch" | "apply" | "new" | "update">(null);
  const [answer, setAnswer] = useState<{ runId: string; kind: "unresolved" | "confirm"; files: string[] } | null>(null);
  const language = locale === "ru" ? "ru" : "en";
  const done = head.merges.filter((m) => m.status === "completed");
  const keys = [...new Set([...done].reverse().filter((m) => m.source !== "head").map((m) => m.task.key))];
  // C2: an update from HEAD is named as such, not as a task
  const nameOf = (m: BoardMerge) => (m.source === "head" ? t(locale, "boardHeadFromHead") : m.task.key);
  // C2 (decision 13): the person's commits the head does not have; its update only by the person
  const behind = head.behind ?? 0;
  const many = pluralForm(locale, behind);
  // decision 15: a merge that found nothing new checked nothing — it says nothing of the checks
  const merged = done.filter((m) => m.reason !== "already");
  const checks = merged.length ? (merged.some((m) => m.completion === "no_checks") ? t(locale, "boardHeadNoChecks") : t(locale, "boardHeadChecked")) : null;
  const notMerged = notMergedOf(head, tasks, statuses, facts);
  const going = head.merges.find((m) => m.status === "preparing" || m.status === "running");
  const waits = head.merges.find((m) => m.status === "paused");
  const act = async (action: "branch" | "apply" | "new" | "update") => {
    setAsking(null);
    const r = await board.head(action, workspaceId, head.project, language);
    const f = failure(r);
    if (f || !r.ok) return say(f ?? "");
    const v = r.value as { name?: string; applied?: boolean; files?: string[]; n?: number };
    say(action === "branch" ? tr(locale, "boardHeadBranchDone", { name: v.name ?? "" }) : action === "new" ? tr(locale, "boardHeadNewDone", { n: v.n ?? 0 })
      : action === "update" ? t(locale, "boardHeadUpdateStarted")
      : v.applied ? t(locale, "boardHeadApplied") : tr(locale, "boardHeadApplyConflict", { files: (v.files ?? []).join(", ") }));
  };
  const check = async (runId: string, confirm: boolean) => {
    const r = await board.resolve(runId, confirm);
    const f = failure(r);
    if (f || !r.ok) { setAnswer(null); return say(f ?? ""); }
    setAnswer(r.value.result === "checking" ? null : { runId, kind: r.value.result, files: r.value.files });
  };
  return (
    <div className="board-card__head" data-board-head={head.ref}>
      <div className="board-card__head-line">
        {head.merges.length > 0 && <strong data-board-head-tasks>{keys.length ? tr(locale, "boardHeadTasks", { keys: keys.join(", ") }) : t(locale, "boardHeadEmpty")}</strong>}
        {checks && <span data-board-head-checks={merged.some((m) => m.completion === "no_checks") ? "none" : "passed"}>{` · ${checks}`}</span>}
        {going?.agent?.pending && going.agent.waits && <span data-board-head-agent-waits={going.agent.waits.kind}>{` · ${agentWaitsText(locale, nameOf(going), going.agent.waits)}`}</span>}
        {going && !going.agent?.pending && <span data-board-head-merging>{` · ${tr(locale, "boardHeadMerging", { key: nameOf(going) })}`}</span>}
        {/* C3: an agent resolves the conflict — its resolution run opens from here (it is on no link) */}
        {going?.agent?.pending && <span data-board-head-agent={going.agent.resolutionRunId}>{going.agent.waits ? " " : ` · ${tr(locale, "boardHeadAgent", { key: nameOf(going) })} `}
          <button type="button" data-board-head-agent-open onClick={() => openRun(going.agent!.resolutionRunId)}>{t(locale, "orchOpenRun")}</button></span>}
        <span className="board-card__header-actions">
          {keys.length > 0 && <button type="button" data-board-head-branch onClick={() => setAsking("branch")}>{t(locale, "boardHeadBranch")}</button>}
          {keys.length > 0 && <button type="button" data-board-head-apply onClick={() => setAsking("apply")}>{t(locale, "boardHeadApply")}</button>}
          <button type="button" data-board-head-new onClick={() => setAsking("new")}>{t(locale, "boardHeadNew")}</button>
        </span>
      </div>
      {asking && (
        <div className="board-task__confirm" role="alertdialog" data-board-head-confirm={asking}>
          <p>{asking === "update" ? tr(locale, "boardHeadUpdateWhy", { branch: head.branch ?? "HEAD" })
            : t(locale, asking === "branch" ? "boardHeadBranchWhy" : asking === "apply" ? "boardHeadApplyWhy" : "boardHeadNewWhy")}</p>
          <button type="button" className="orch-primary" data-board-head-yes onClick={() => void act(asking)}>
            {t(locale, asking === "branch" ? "boardHeadBranch" : asking === "apply" ? "boardHeadApply" : asking === "update" ? "boardHeadUpdate" : "boardHeadNew")}</button>
          <button type="button" onClick={() => setAsking(null)}>{t(locale, "orchCancel")}</button>
        </div>
      )}
      {behind > 0 && (
        <div className="board-card__head-line" data-board-head-behind={behind}>
          <span className="orch-hint orch-hint--warn">{tr(locale, `boardHeadBehind_${many}`, { n: behind })}</span>
          {!going && !waits && asking !== "update" && <button type="button" data-board-head-update onClick={() => setAsking("update")}>{t(locale, "boardHeadUpdate")}</button>}
        </div>
      )}
      {head.otherLine && <div className="board-card__head-line orch-hint orch-hint--warn" data-board-head-other-line>
        {tr(locale, "boardHeadOtherLine", { branch: head.branch ?? "HEAD" })}</div>}
      {notMerged.length > 0 && !going && !waits && (
        <div className="board-card__head-line" data-board-not-merged>
          <span>{tr(locale, "boardNotMerged", { keys: notMerged.map((x) => x.key).join(", ") })}</span>
          <button type="button" data-board-merge-all onClick={async () => { const f = failure(await board.mergeAll(workspaceId, head.project, language)); if (f) say(f); }}>{t(locale, "boardMergeAll")}</button>
        </div>
      )}
      {waits && (
        <div className="board-card__merge" role="alert" data-board-merge-waits={waits.reason ?? ""}>
          <strong>{tr(locale, "boardMergeWaits", { key: nameOf(waits), why: tr(locale, `boardMergeReason_${waits.reason}`) || String(waits.reason) })}</strong>
          {waits.conflicts.length > 0 && <p data-board-merge-conflicts>{tr(locale, "boardMergeConflictFiles", { files: waits.conflicts.join(", ") })}</p>}
          {waits.reason === "merge_checks_failed" && <p>{t(locale, "boardMergeChecksFailed")}</p>}
          {waits.reason === "merge_agent_failed" && <p data-board-merge-agent-why={waits.detail ?? ""}>{tr(locale, `boardMergeAgentWhy_${(waits.detail ?? "failed").split(":")[0]}`, { detail: agentWhyDetail(locale, waits.detail) }) || waits.detail}</p>}
          {waits.agent && <p>
            <button type="button" data-board-merge-agent-open onClick={() => openRun(waits.agent!.resolutionRunId)}>{t(locale, "boardMergeAgentOpen")}</button></p>}
          <p className="orch-hint">{t(locale, "boardMergeHow")}</p>
          {answer?.runId === waits.runId && <p className="orch-hint orch-hint--warn" data-board-merge-answer={answer.kind}>
            {tr(locale, answer.kind === "unresolved" ? "boardMergeUnresolved" : "boardMergeOutside", { files: answer.files.join(", ") })}</p>}
          <div className="board-task__actions">
            <button type="button" data-board-merge-open onClick={async () => { const f = failure(await board.openMerge(waits.runId)); if (f) say(f); }}>{t(locale, "boardMergeOpen")}</button>
            {answer?.runId === waits.runId && answer.kind === "confirm"
              ? <button type="button" className="orch-primary" data-board-merge-outside-yes onClick={() => void check(waits.runId, true)}>{t(locale, "boardMergeOutsideYes")}</button>
              : <button type="button" className="orch-primary" data-board-merge-check onClick={() => void check(waits.runId, false)}>{t(locale, "boardMergeCheck")}</button>}
            {!waits.source && TO_AGENT.has(waits.reason ?? "") && <button type="button" data-board-merge-agent
              onClick={async () => { setAnswer(null); const r = await board.toAgent(waits.runId, language); const f = failure(r); say(f ?? t(locale, "boardMergeAgentStarted")); }}>
              {t(locale, waits.agent ? "boardMergeAgentAgain" : "boardMergeAgent")}</button>}
            <button type="button" data-board-merge-skip onClick={async () => { setAnswer(null); const f = failure(await board.skip(waits.runId)); if (f) say(f); }}>{t(locale, "boardMergeSkip")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// F1 (stage-f-external-projects.md §10): the codes of the import window — one family, boardImportCode_<code>; the
// placeholders from the refused row (its ref, detail) and the file's own rows (the project of a ref). A dependency's
// refusal names the dependency: its ref is in the detail (boardStore: «dependsOn: no task X …», «dependsOn: X is refused»)
function importText(locale: LocaleId, code: string, detail = "", rowRef: string | null = null, tasks: InboxTask[] = []): string {
  const key = `boardImportCode_${code}`;
  const ref = code === "unknown_dependency" || code === "dependency_refused" ? /dependsOn: (?:no task )?([A-Za-z0-9][A-Za-z0-9-]*)/.exec(detail)?.[1] ?? "" : rowRef;
  if (!t(locale, key as TranslationKey)) return tr(locale, `orchError_${code}`) || detail || code;
  return tr(locale, key, { ref: ref ?? "", detail, field: /(\S+) is taken from stage/.exec(detail)?.[1] ?? "", name: /are named (.*)$/.exec(detail)?.[1] ?? "",
    path: tasks.find((x) => x.ref === ref)?.project ?? "" });
}
// «Import tasks» and «Import»: what was created, updated, left unchanged and refused (a code and its words)
function ImportReportView({ locale, report, tasks, board }: { locale: LocaleId; report: ImportReport; tasks: InboxTask[]; board: BoardTask[] }): React.JSX.Element {
  // a name beside the key: the board task by its key, else the file's row by its ref
  const name = (ref: string, key?: string): string => { const n = (key && board.find((x) => x.key === key)?.title) || tasks.find((x) => x.ref === ref)?.title; return n ? ` ${n}` : ""; };
  // §11.6: a line per task — the sign (+ created, = unchanged, ~ updated, ! refused), the ref, the result; a refusal of the whole file is one line
  const fileWide = report.refused.find((x) => !x.ref);
  const row = (sign: string, ref: string, key: string, body: React.ReactNode, attrs: Record<string, string | undefined>, warn = false, title?: string): React.JSX.Element => (
    <li key={key} className={warn ? "board-import__warn" : undefined} title={title} {...attrs}><span className="board-import__sign">{sign}</span><span className="board-import__ref">{ref}</span><span className="board-import__what">{body}</span></li>);
  return (
    <div className="board-import" data-board-import-report={report.status} data-wheel-owner="local">
      <p className="board-import__source">{tr(locale, "boardImportSource", { file: report.file })}</p>
      <ul className="board-import__list">
        {fileWide ? <li className="board-import__warn board-import__file" data-board-import-refused={fileWide.code} title={fileWide.detail}>{importText(locale, fileWide.code, fileWide.detail, null, tasks)}</li> : <>
          {report.created.map((x) => row("+", x.ref, `c${x.ref}`, <>→ {x.key}{name(x.ref, x.key)}<small>{t(locale, "boardImportInQueue")}</small></>, { "data-board-import-created": x.ref }))}
          {report.unchanged.map((ref) => row("=", ref, `n${ref}`, <>{name(ref).trim()}{" · "}{t(locale, "boardImportRowUnchanged")}</>, { "data-board-import-unchanged": ref }))}
          {report.updated.map((x) => row("~", x.ref, `u${x.ref}`, <>→ {x.key}{name(x.ref, x.key)}{" · "}{t(locale, "boardImportRowUpdated")}</>, { "data-board-import-updated": x.ref }))}
          {report.refused.map((x) => row("!", x.ref ?? "", `r${x.ref}|${x.code}|${x.detail}`, importText(locale, x.code, x.detail, x.ref, tasks), { "data-board-import-refused": x.code }, true, x.detail))}
        </>}
      </ul>
      <p className="board-import__total" data-board-import-line role="status" aria-live="polite">{tr(locale, "boardImportReport", { file: report.file, c: report.created.length, u: report.updated.length, n: report.unchanged.length, r: report.refused.length })}</p>
    </div>
  );
}

// F1 (§5.4, §10): a file of inbox/ — checked: its rows and «Import / Reject» (every row refused: «Reject» only);
// invalid_file, refused: its code, no decision (it is in done/ already)
function InboxLine({ locale, row, readOnly, onImport, onReject }: { locale: LocaleId; row: InboxRow; readOnly: boolean; onImport(): Promise<void>; onReject(): Promise<void> }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const r = row.report;
  const checked = r.status === "checked";
  const refused = new Map(r.refused.filter((x) => x.ref).map((x) => [x.ref, x]));
  const importable = r.created.length + r.updated.length + r.unchanged.length > 0;
  const act = (fn: () => Promise<void>) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  return (
    <div className="board-card__inbox" data-board-inbox={row.file} data-board-inbox-status={r.status}>
      <strong>{tr(locale, "boardInboxRow", { file: row.file, n: row.tasks.length, k: r.refused.length })}</strong>
      {!checked && r.code && <span data-board-inbox-code={r.code} title={r.refused[0]?.detail}>{` · ${importText(locale, r.code, r.refused[0]?.detail ?? "", null, row.tasks)}`}</span>}
      {checked && (
        <ul className="board-card__inbox-tasks">
          {row.tasks.map((x) => {
            const no = refused.get(x.ref);
            return (
              <li key={`${x.ref}|${x.title}|${x.project}`} data-board-inbox-task={x.ref} data-board-inbox-refused={no?.code} title={x.project}>
                <b>{x.ref}</b> {x.title} · {x.project}{x.external ? ` · ${t(locale, "boardExternal")}` : ""}{x.dependsOn.length ? ` · ${tr(locale, "boardAfter", { keys: x.dependsOn.join(", ") })}` : ""}
                {no && <span className="board-card__inbox-refused">{` · ${importText(locale, no.code, no.detail, no.ref, row.tasks)}`}</span>}
              </li>
            );
          })}
          {r.refused.filter((x) => !x.ref).map((x) => <li key={`f${x.code}|${x.detail}`} className="board-card__inbox-refused" data-board-inbox-refused={x.code}>{importText(locale, x.code, x.detail, null, row.tasks)}</li>)}
        </ul>
      )}
      {checked && !readOnly && (
        <span className="board-card__inbox-actions">
          <button type="button" className="orch-primary" data-board-inbox-import disabled={busy || !importable} onClick={act(onImport)}>{t(locale, "boardInboxImport")}</button>
          <button type="button" data-board-inbox-reject disabled={busy} onClick={act(onReject)}>{t(locale, "boardInboxReject")}</button>
        </span>
      )}
    </div>
  );
}
