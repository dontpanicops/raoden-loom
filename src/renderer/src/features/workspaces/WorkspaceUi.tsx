// Project workspaces: the switcher and its dialogs (docs/agent-orchestration/implementation/workspaces-spec.md §5).
// Every rule is main's; these views only ask, show main's answer and never move or stop anything without a click.
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, LocaleId, SessionSnapshot, TerminalStopResult, WorkspaceLabel, WorkspaceRecord, WorkspacesState } from "../../../../shared/contracts";
import { pluralForm, t, type TranslationKey } from "../../lib/i18n";
import { UiIcon } from "../../components/UiIcon";
import { Dialog } from "../../components/Dialog";
import { outcomeOf, runStatusKey, TERMINAL_STATUSES } from "../orchestration/runModel";
import { outcomeText, type Orchestration } from "../orchestration/useOrchestration";
import {
  arrangeGroups, closeCountsRun, closeRunStatus, folderName, isCommon, knownWorkspaces, linkedGroup, NO_COUNTS, roomFor, runOwners, UNFINISHED, workspaceOf,
  type Box, type WorkspaceCounts
} from "./workspaceModel";

// Where cards stand: those of a workspace (HOME included), and those of one movable item.
export interface WorkspaceLayout {
  occupiedIn(workspaceId: string): Box[];
  boxesOf(item: MovableKind | "agents", ids: string[]): Box[];
}

// One card or one linked group to another workspace, placed where it covers nothing there.
async function moveOne(controls: WorkspaceControls, orch: Orchestration, locale: LocaleId, layout: WorkspaceLayout,
  item: MovableKind | "agents", ids: string[], target: string): Promise<string | null> {
  const boxes = layout.boxesOf(item, ids);
  const dx = roomFor(boxes, layout.occupiedIn(target));
  if (item !== "agents") return controls.moveItem(item, ids[0], target, dx);
  const { outcome } = await orch.moveAgentGroup(ids, target);
  const text = outcomeText(locale, outcome);
  if (text || !dx) return text;
  for (const id of ids) {
    const card = orch.canvas.agents.find((a) => a.agentId === id);
    if (card) orch.moveAgent(id, { position: { x: card.bounds.position.x + dx, y: card.bounds.position.y }, size: card.bounds.size });
  }
  return null;
}

const tr = (locale: LocaleId, key: string, vars: Record<string, string> = {}): string =>
  Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), t(locale, key as TranslationKey) ?? key);
// SPEC 11.7: the label is an 8px square (circle = status glyph); none for the common canvas and for an unlabeled space.
// slot: a list that lines the names up (mock 25 «Move card»): an unlabeled row keeps the place; the common canvas shows a hollow square.
export function WsLabel({ w, slot }: { w: WorkspaceRecord | undefined | null; slot?: boolean }): React.JSX.Element | null {
  if (w?.label) return <span className={`ws-label ws-label--${w.label}`} data-ws-label={w.label} aria-hidden="true" />;
  return slot ? <span className={`ws-label ${w && isCommon(w.id) ? "ws-label--hollow" : "ws-label--blank"}`} aria-hidden="true" /> : null;
}
const LABELS: WorkspaceLabel[] = [1, 2, 3, 4, 5];
const tk = (locale: LocaleId, key: string): string => tr(locale, key);
// «5 карточек»: the cards of a workspace, HOME (always in occupiedIn, the first box) not counted
const cards = (locale: LocaleId, n: number): string => tr(locale, `wsMoveCards_${pluralForm(locale, n)}`, { n: String(n) });

export type MovableKind = "terminal" | "region" | "note" | "plugin" | "browser";

// What App gives the canvas: the workspaces as main holds them and the actions on them. Each action answers null
// or the sentence to show.
export interface WorkspaceControls {
  state: WorkspacesState;
  activeId: string;
  allSessions: SessionSnapshot[];
  allSettings: AppSettings;
  switchTo(id: string): void;
  focusBounds(bounds: { position: { x: number; y: number }; size: { width: number; height: number } }): void;
  create(title: string, root: string | null, activate?: boolean, label?: WorkspaceLabel | null): Promise<string | null>;
  update(id: string, patch: { title?: string; root?: string | null; label?: WorkspaceLabel | null }): Promise<string | null>;
  close(id: string): Promise<string | null>;
  remove(id: string): Promise<string | null>;
  moveItem(kind: MovableKind, id: string, target: string, dx?: number): Promise<string | null>;
  browserElsewhere: string | null;
  closeBrowserNotice(): void;
  goToBrowser(): void;
  bringBrowserHere(): Promise<void>;
  disposeSession(id: string): Promise<void>;
  // "Stop and hide": resolves with main's answer — a confirmed exit, a failed signal or no exit within the limit.
  stopSession(id: string): Promise<TerminalStopResult>;
  // Palette: moves the terminal's card into a new workspace named after it and shows it there.
  openInNewWorkspace(id: string): Promise<string | null>;
  // Shows the terminal's card (its workspace, focused); false when the window has no card for it.
  openSession(id: string): boolean;
  notify(text: string): void;
}

export type WorkspaceDialog =
  | { kind: "create" }
  | { kind: "settings"; id: string }
  | { kind: "move"; item: MovableKind | "agents"; id: string; label: string }
  | { kind: "close"; id: string }
  | { kind: "remove"; id: string }
  | { kind: "history"; id: string }
  | { kind: "arrange"; id: string }
  | { kind: "hidden" };

export function workspaceTitle(locale: LocaleId, w: WorkspaceRecord | undefined | null): string {
  if (!w) return tk(locale, "wsCommon");
  return w.title || (isCommon(w.id) ? tk(locale, "wsCommon") : w.id);
}

// The title in the case the Russian sentence needs: «Скрыть «Альфу»?», «в «Бете»». Only a one-word name in -а/-я and the common canvas are declined; any other stays as typed.
function ruCase(locale: LocaleId, name: string, to: "acc" | "prep"): string {
  if (locale !== "ru") return name;
  if (name === tk(locale, "wsCommon")) return to === "prep" ? "Общем холсте" : name;
  const m = /^([А-ЯЁа-яё]+)([ая])$/.exec(name);
  if (!m || name.length < 3) return name;
  return m[1] + (to === "prep" ? "е" : m[2] === "а" ? "у" : "ю");
}

const countsHint = (locale: LocaleId, c: WorkspaceCounts): string => tr(locale, "wsCountsHint", {
  runs: String(c.runs), cli: String(c.cli), attention: String(c.attention), shells: String(c.shells)
});

export function WorkspaceBar({ controls, counts, locale, onDialog, board }: {
  controls: WorkspaceControls; counts: Record<string, WorkspaceCounts>; locale: LocaleId; onDialog(d: WorkspaceDialog): void;
  board?: { shown: boolean; toggle(): void }; // B2: «Board» shows the task board on this canvas, or brings it forward
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const open = controls.state.workspaces.filter((w) => !w.closed);
  const hidden = controls.state.workspaces.filter((w) => w.closed);
  const active = controls.state.workspaces.find((w) => w.id === controls.activeId);
  const say = (text: string | null) => {
    setMessage(text);
    if (text) window.setTimeout(() => setMessage((m) => (m === text ? null : m)), 8000);
  };
  // the menu closes with the click: the dialog's focus returns to the ⋯ button, not to the vanished menu row
  const menuButton = useRef<HTMLButtonElement>(null);
  const act = (d: WorkspaceDialog) => { menuButton.current?.focus(); setMenuOpen(false); onDialog(d); };
  return (
    <nav className="workspace-bar surface-3" data-interactive="true" data-workspace-bar aria-label={tk(locale, "wsBar")}>
      <div className="workspace-bar__tabs" role="tablist">
        {open.map((w, i) => {
          const c = counts[w.id] ?? NO_COUNTS;
          return (
            <button key={w.id} type="button" role="tab" className="workspace-bar__tab" aria-selected={w.id === controls.activeId}
              data-workspace-tab={w.id} title={`${workspaceTitle(locale, w)}${w.root ? ` — ${w.root}` : ""}\n${countsHint(locale, c)}${window.canvasTTY.window.isMacOS && i < 9 ? `\n⌘${i + 1}` : ""}`}
              onClick={() => controls.switchTo(w.id)}>
              <WsLabel w={w} />
              <span className="workspace-bar__name">{workspaceTitle(locale, w)}</span>
              {c.runs > 0 && <span className="workspace-bar__count workspace-bar__count--runs" data-ws-runs={c.runs} aria-label={tr(locale, "wsCountRuns", { n: String(c.runs) })}><UiIcon name="working" size={12} />{c.runs}</span>}
              {c.cli > 0 && <span className="workspace-bar__count workspace-bar__count--cli" data-ws-cli={c.cli} aria-label={tr(locale, "wsCountCli", { n: String(c.cli) })}><UiIcon name="working" size={12} />{c.cli}</span>}
              {c.attention > 0 && <span className="workspace-bar__count workspace-bar__count--attention" data-ws-attention={c.attention} aria-label={tr(locale, "wsCountAttention", { n: String(c.attention) })}><UiIcon name="bell" size={12} />{c.attention}</span>}
            </button>
          );
        })}
      </div>
      {board && (
        <button type="button" className="workspace-bar__board" data-board-button aria-pressed={board.shown} onClick={board.toggle}>{t(locale, "boardButton")}</button>
      )}
      <button type="button" className="workspace-bar__icon" data-workspace-new title={tk(locale, "wsNew")} aria-label={tk(locale, "wsNew")}
        disabled={!controls.state.available} onClick={() => act({ kind: "create" })}><UiIcon name="plus" size={15} /></button>
      <div className="workspace-bar__menu-anchor">
        <button ref={menuButton} type="button" className="workspace-bar__icon" data-workspace-menu aria-haspopup="menu" aria-expanded={menuOpen}
          title={tk(locale, "wsMenu")} aria-label={tk(locale, "wsMenu")} onClick={() => setMenuOpen((v) => !v)}>⋯</button>
        {menuOpen && active && (
          <div className="workspace-bar__menu canvas-menu" role="menu">
            <button type="button" role="menuitem" className="canvas-menu__row" data-ws-action="settings" onClick={() => act({ kind: "settings", id: active.id })}>{tk(locale, "wsSettings")}</button>
            <button type="button" role="menuitem" className="canvas-menu__row" data-ws-action="history" onClick={() => act({ kind: "history", id: active.id })}>{tk(locale, "wsHistory")}</button>
            <button type="button" role="menuitem" className="canvas-menu__row" data-ws-action="arrange" disabled={!controls.state.available} onClick={() => act({ kind: "arrange", id: active.id })}>{tk(locale, "wsArrange")}</button>
            <button type="button" role="menuitem" className="canvas-menu__row" data-ws-action="hidden" disabled={hidden.length === 0} onClick={() => act({ kind: "hidden" })}>{tr(locale, "wsHiddenList", { n: String(hidden.length) })}</button>
            <button type="button" role="menuitem" className="canvas-menu__row" data-ws-action="close" disabled={!controls.state.available || open.length < 2} onClick={() => act({ kind: "close", id: active.id })}>{tk(locale, "wsClose")}</button>
            <button type="button" role="menuitem" className="canvas-menu__row canvas-menu__row--danger" data-ws-action="remove" disabled={!controls.state.available || isCommon(active.id)} onClick={() => {
              act({ kind: "remove", id: active.id });
            }}>{tk(locale, "wsRemove")}</button>
          </div>
        )}
      </div>
      {!controls.state.available && <span className="workspace-bar__note" role="status" data-ws-unavailable>{tk(locale, "wsUnavailable")}</span>}
      {message && <span className="workspace-bar__note" role="alert" data-ws-message>{message}</span>}
    </nav>
  );
}

// Create, or change the name and main folder of one workspace.
// Creates a workspace and answers its id (main answers the whole state; the new one is the id that was not there).
async function createWorkspace(controls: WorkspaceControls, title: string, root: string | null, label: WorkspaceLabel | null, activate: boolean): Promise<{ text: string | null; id: string | null }> {
  const before = new Set(controls.state.workspaces.map((w) => w.id));
  const text = await controls.create(title, root, activate, label);
  if (text) return { text, id: null };
  const created = (await window.canvasTTY.workspaces.get()).workspaces.find((w) => !before.has(w.id));
  return { text: null, id: created?.id ?? null };
}

// onCreated: the dialog was opened from «Move card»; the new workspace is not shown, the card goes there.
function WorkspaceForm({ controls, locale, id, onClose, onCreated }: { controls: WorkspaceControls; locale: LocaleId; id: string | null; onClose(): void; onCreated?(id: string): Promise<string | null> }): React.JSX.Element {
  const current = id ? controls.state.workspaces.find((w) => w.id === id) ?? null : null;
  const [title, setTitle] = useState(current ? workspaceTitle(locale, current) : "");
  const [root, setRoot] = useState(current?.root ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState<WorkspaceLabel | null>(current?.label ?? null);
  const [confirmedTwin, setConfirmedTwin] = useState(false);
  const folder = root.trim();
  const twin = folder ? controls.state.workspaces.find((w) => w.root === folder && w.id !== id) ?? null : null;
  const wanted = title.trim();
  const taken = wanted ? controls.state.workspaces.find((w) => w.id !== id && !w.closed && workspaceTitle(locale, w).toLowerCase() === wanted.toLowerCase()) ?? null : null;
  const submit = async (): Promise<void> => {
    if ((twin && !confirmedTwin && !id) || taken) return;
    setBusy(true);
    const name = title.trim() || folderName(folder);
    let text: string | null;
    if (id) text = await controls.update(id, { title: name, root: folder || null, label: isCommon(id) ? undefined : label });
    else {
      const made = await createWorkspace(controls, name, folder || null, label, !onCreated);
      text = made.text ?? (onCreated ? (made.id ? await onCreated(made.id) : tk(locale, "wsActionFailed")) : null);
    }
    setBusy(false);
    if (text) setError(text);
    else onClose();
  };
  return (
    <Dialog label={current ? tr(locale, "wsRenameTitle", { name: workspaceTitle(locale, current) }) : tk(locale, "wsNew")} onClose={onClose} locale={locale} className="ws-dialog">
      <form className="orch-form" data-ws-form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label className="orch-field"><span>{tk(locale, "wsName")}</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={folderName(folder) || tk(locale, "wsName")} data-ws-title
            className={taken ? "orch-input--error" : undefined} aria-invalid={taken ? true : undefined} />
          {taken && <span className="orch-field__error" role="alert" data-ws-name-taken>{tr(locale, "wsNameTaken", { name: workspaceTitle(locale, taken) })}</span>}
        </label>
        {/* mock 25: one 12px line under the name — «Папка: путь · Изменить…» / «Папка не выбрана · Выбрать…»; the path is mono, its end is cut, the whole one is the tooltip */}
        <div className="ws-folder-line" data-ws-folder>
          <UiIcon name="folder" size={16} />
          {folder ? <><span>{tk(locale, "wsFolderShort")}</span><code title={folder} data-ws-root>{folder}</code></> : <span data-ws-root>{tk(locale, "wsNoFolder")}</span>}
          <span aria-hidden="true">·</span>
          <button type="button" data-ws-pick onClick={() => void window.canvasTTY.dialog.pickDirectory(folder || undefined).then((picked) => {
            if (!picked) return;
            setRoot(picked);
            setConfirmedTwin(false);
            if (!title.trim()) setTitle(folderName(picked));
          })}>{tk(locale, folder ? "wsChangeFolder" : "wsPickFolder")}</button>
        </div>
        {!(id && isCommon(id)) && (
          <div className="orch-field ws-label-field" data-ws-label-field><span>{tk(locale, "wsLabel")}</span>
            <div className="ws-label-pick" role="radiogroup" aria-label={tk(locale, "wsLabel")}>
              <button type="button" role="radio" aria-checked={label === null} className="ws-label-pick__none" data-ws-label-pick="0"
                title={tk(locale, "wsLabel_0")} aria-label={tk(locale, "wsLabel_0")} onClick={() => setLabel(null)}><UiIcon name="close" size={12} /></button>
              {LABELS.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={label === n} className={`ws-label-pick__swatch ws-label--${n}`} data-ws-label-pick={n}
                  title={tk(locale, `wsLabel_${n}`)} aria-label={tk(locale, `wsLabel_${n}`)} onClick={() => setLabel(n)} />
              ))}
            </div>
          </div>
        )}
        {twin && !id && (
          <div className="orch-hint orch-hint--warn" role="status" data-ws-twin>
            {tr(locale, "wsTwin", { name: workspaceTitle(locale, twin) })}
            <span className="orch-form__actions">
              <button type="button" data-ws-open-twin onClick={() => { controls.switchTo(twin.id); onClose(); }}>{tr(locale, "wsOpenNamed", { name: workspaceTitle(locale, twin) })}</button>
              <button type="button" data-ws-create-twin onClick={() => setConfirmedTwin(true)} disabled={confirmedTwin}>{tk(locale, "wsCreateAnother")}</button>
            </span>
          </div>
        )}
        <div className="orch-form__actions">
          <button type="button" className="orch-cancel" onClick={onClose}>{t(locale, "orchCancel")}</button>
          <button type="submit" className="orch-primary" data-ws-submit disabled={busy || !!taken || (!title.trim() && !folder) || (!!twin && !confirmedTwin && !id)}>
            {tk(locale, id ? "wsSave" : "wsCreate")}
          </button>
        </div>
        {error && <div className="dialog-error" role="alert">{error}</div>}
      </form>
    </Dialog>
  );
}

// Deleting a workspace asks first (mock 17): it cannot be undone; main still refuses one that has cards or history.
function RemoveDialog({ controls, locale, id, onClose }: { controls: WorkspaceControls; locale: LocaleId; id: string; onClose(): void }): React.JSX.Element {
  const w = controls.state.workspaces.find((x) => x.id === id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    const text = await controls.remove(id);
    setBusy(false);
    if (text) setError(text);
    else onClose();
  };
  return (
    <Dialog label={tr(locale, "wsDeleteTitle", { name: ruCase(locale, workspaceTitle(locale, w), "acc") })} onClose={onClose} locale={locale} className="ws-dialog">
      <div className="orch-form" data-ws-delete>
        <p>{tk(locale, "wsDeleteText")}</p>
        <p className="orch-hint">{tk(locale, "wsDeleteHint")}</p>
        {error && <div className="dialog-error" role="alert">{error}</div>}
        <div className="orch-form__actions">
          <button type="button" className="orch-cancel" onClick={onClose}>{t(locale, "orchCancel")}</button>
          <button type="button" className="orch-danger" data-ws-delete-go disabled={busy} onClick={() => void submit()}>{tk(locale, "wsDelete")}</button>
        </div>
      </div>
    </Dialog>
  );
}

// Move one card, or a whole linked group of agents, to another workspace. The group is shown before the move; a group
// with an unfinished run is refused here and in main.
function MoveDialog({ controls, orch, locale, layout, item, id, label, onClose }: {
  controls: WorkspaceControls; orch: Orchestration; locale: LocaleId; layout: WorkspaceLayout; item: MovableKind | "agents"; id: string; label: string; onClose(): void;
}): React.JSX.Element {
  const targets = controls.state.workspaces.filter((w) => !w.closed && w.id !== controls.activeId);
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const group = item === "agents" ? linkedGroup(orch.canvas, id) : [];
  const groupLinks = orch.canvas.links.filter((l) => group.includes(l.fromAgentId));
  const blocked = groupLinks.some((l) => l.runIds.some((r) => UNFINISHED.includes(orch.runs[r]?.view.status ?? "")));
  const submit = async (): Promise<void> => {
    setBusy(true);
    const text = await moveOne(controls, orch, locale, layout, item, item === "agents" ? group : [id], target);
    setBusy(false);
    if (text) setError(text);
    else onClose();
  };
  // «+ New workspace…»: the usual create dialog, then the card goes into the new workspace (which stays in the background)
  if (creating) {
    return <WorkspaceForm controls={controls} locale={locale} id={null} onClose={() => setCreating(false)}
      onCreated={async (newId) => {
        const text = await moveOne(controls, orch, locale, layout, item, item === "agents" ? group : [id], newId);
        if (!text) onClose();
        return text;
      }} />;
  }
  return (
    <Dialog label={tk(locale, "wsMoveTitle")} onClose={onClose} locale={locale} className="ws-dialog">
      <form className="orch-form" data-ws-move onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {item === "agents" ? (
          <div className="orch-field"><span>{tk(locale, "wsMoveGroup")}</span>
            <ul className="ws-list" data-ws-move-group>
              {group.map((agentId) => {
                const a = orch.canvas.agents.find((x) => x.agentId === agentId)!;
                return <li key={agentId} data-ws-move-card={agentId}>{a.provider === "codex" ? "Codex" : "Claude"} · {t(locale, a.role === "lead" ? "orchRoleLead" : "orchRoleExecutor")} · {folderName(a.project)}</li>;
              })}
            </ul>
            <p className="orch-hint">{tk(locale, "wsMoveHistoryStays")}</p>
          </div>
        ) : <p className="orch-hint" data-ws-move-item>{item === "terminal" ? tr(locale, "wsMoveTerminal", { name: locale === "ru" ? `«${label}»` : `“${label}”` }) : label}</p>}
        {blocked && <div className="orch-hint orch-hint--warn" role="status" data-ws-move-blocked>{t(locale, "orchError_group_active_run")}</div>}
        {targets.length === 0
          ? <p className="orch-hint" data-ws-move-none>{tk(locale, "wsMoveNoTarget")}</p>
          : (
            <ul className="ws-pick">
              <li className="ws-pick__row ws-pick__row--here"><span className="ws-pick__name"><WsLabel slot w={controls.state.workspaces.find((w) => w.id === controls.activeId)} />{workspaceTitle(locale, controls.state.workspaces.find((w) => w.id === controls.activeId))}</span><span>{tk(locale, "wsMoveHere")}</span></li>
              {targets.map((w) => (
                <li key={w.id}>
                  <button type="button" aria-pressed={w.id === target} className="ws-pick__row" data-ws-move-target={w.id} onClick={() => setTarget(w.id)}>
                    <span className="ws-pick__name"><WsLabel slot w={w} />{workspaceTitle(locale, w)}</span><span>{cards(locale, layout.occupiedIn(w.id).length - 1)}</span>
                  </button>
                </li>
              ))}
              {controls.state.available && (
                <li><button type="button" className="ws-pick__row ws-pick__row--new" data-ws-move-new onClick={() => setCreating(true)}>
                  <span className="ws-pick__name"><UiIcon name="plus" size={14} />{tk(locale, "wsMoveNew")}</span>
                </button></li>
              )}
            </ul>
          )}
        <div className="orch-form__actions">
          <button type="button" className="orch-cancel" onClick={onClose}>{t(locale, "orchCancel")}</button>
          <button type="submit" className="orch-primary" data-ws-move-submit disabled={busy || blocked || !target}>{target ? tr(locale, "wsMoveConfirmTo", { name: ruCase(locale, workspaceTitle(locale, controls.state.workspaces.find((w) => w.id === target)), "acc") }) : tk(locale, "wsMoveConfirm")}</button>
        </div>
        {error && <div className="dialog-error" role="alert" data-ws-move-error>{error}</div>}
      </form>
    </Dialog>
  );
}

// Closing a workspace with work in it (§5): hiding stops nothing; stopping is a separate explicit choice whose result
// is shown for every run and terminal, and the workspace hides only when everything stopped.
type StopState = { state: "stopping" | "stopped" | "error" | "timeout" | "unconfirmed" | "unknown"; error?: string };
export function CloseDialog({ controls, orch, locale, id, onClose, onOpenRun }: {
  controls: WorkspaceControls; orch: Orchestration; locale: LocaleId; id: string; onClose(): void; onOpenRun(runId: string): void;
}): React.JSX.Element {
  const known = knownWorkspaces(controls.state);
  const owner = runOwners(orch.canvas, known);
  // A run whose snapshot is missing is listed too: its state is loading or could not be read, never "no work".
  const runsNow = (): string[] => [...new Set(orch.canvas.links.map((l) => l.runIds.at(-1)).filter((r): r is string => !!r))]
    .filter((r) => owner(r) === id && closeCountsRun(closeRunStatus(orch.runs[r]?.view)));
  const termsNow = () => controls.allSessions.filter((s) => workspaceOf(s, known) === id && s.exitCode === null).map((s) => ({ id: s.id, title: s.title, closeUnconfirmed: !!s.closeUnconfirmed }));
  const unknownOf = (r: string): "loading" | "unreadable" | null => (orch.runs[r] ? null : orch.runErrors[r] ? "unreadable" : "loading");
  // The list is the one the person saw; work started after it is checked again before hiding.
  const [runs] = useState(runsNow);
  const [terms] = useState(termsNow);
  const [stops, setStops] = useState<Record<string, StopState> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const put = (key: string, v: StopState) => setStops((cur) => ({ ...(cur ?? {}), [key]: v }));
  // A run is stopped when main says so; a terminal only when main confirmed its exit (the stop's answer), never
  // because its card disappeared.
  const liveStops = useMemo(() => {
    if (!stops) return null;
    const out: Record<string, StopState> = { ...stops };
    for (const r of runs) {
      const st = out[`run:${r}`]?.state;
      if ((st === "stopping" || st === "unknown") && TERMINAL_STATUSES.includes(orch.runs[r]?.view.status ?? "")) out[`run:${r}`] = { state: "stopped" };
    }
    return out;
  }, [orch.runs, runs, stops]);
  const all = liveStops ? Object.values(liveStops) : [];
  const allStopped = liveStops !== null && all.length === runs.length + terms.length && all.every((s) => s.state === "stopped");
  const failed = all.some((s) => s.state === "error" || s.state === "timeout" || s.state === "unconfirmed");
  const unknownNow = liveStops ? all.some((s) => s.state === "unknown") : runs.some((r) => unknownOf(r) !== null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires once when everything is stopped; the lists are the ones the person saw
  useEffect(() => {
    if (!allStopped) return;
    if (runsNow().some((r) => !runs.includes(r)) || termsNow().some((s) => !terms.some((x) => x.id === s.id))) {
      setError(tk(locale, "wsCloseNewWork"));
      return;
    }
    void controls.close(id).then((text) => (text ? setError(text) : onClose()));
  }, [allStopped]);

  const hide = async (): Promise<void> => {
    const text = await controls.close(id);
    if (text) setError(text);
    else onClose();
  };
  const stopRun = async (r: string): Promise<void> => {
    const view = orch.runs[r]?.view;
    if (!view) return put(`run:${r}`, { state: "unknown" }); // stopped once its state is read, below
    put(`run:${r}`, { state: "stopping" });
    const req = orch.commands.request(r, view.revision, { kind: "stop" });
    const { outcome } = await outcomeOf(() => window.canvasTTY.orchestration.command(req));
    if (outcome.kind !== "transport") orch.commands.settle(req);
    if (outcome.kind !== "accepted" && outcome.kind !== "in_progress") put(`run:${r}`, { state: "error", error: outcomeText(locale, outcome) ?? undefined });
  };
  const stopTerminal = async (sid: string): Promise<void> => {
    put(`term:${sid}`, { state: "stopping" });
    const result = await controls.stopSession(sid).catch((e: unknown): TerminalStopResult => ({ outcome: "kill_failed", error: e instanceof Error ? e.message : String(e) }));
    // Only a confirmed exit is "stopped". "absent" means main has no record of the terminal: its end is not confirmed.
    if (result.outcome === "exited") put(`term:${sid}`, { state: "stopped" });
    else if (result.outcome === "absent") put(`term:${sid}`, { state: "unconfirmed" });
    else if (result.outcome === "timeout") put(`term:${sid}`, { state: "timeout" });
    else put(`term:${sid}`, { state: "error", error: result.error });
  };
  const stopAll = async (): Promise<void> => {
    setStops({});
    await Promise.all([...runs.map(stopRun), ...terms.map((s) => stopTerminal(s.id))]);
  };
  // A run whose state was unknown when the person asked to stop is stopped as soon as its state is read (retry).
  // biome-ignore lint/correctness/useExhaustiveDependencies: orch.runs is the trigger: retry a stop once its run state is read
  useEffect(() => {
    if (!stops) return;
    for (const r of runs) {
      const view = orch.runs[r]?.view;
      if (stops[`run:${r}`]?.state === "unknown" && view && !TERMINAL_STATUSES.includes(view.status)) void stopRun(r);
    }
  }, [orch.runs]);
  // Every participant not confirmed stopped keeps its way to it ("Open"); a run whose state is unknown also offers to
  // read it again.
  const GLYPH = { stopped: "status-done", stopping: "working", unknown: "working", error: "status-failed", timeout: "status-failed", unconfirmed: "status-failed" } as const;
  const row = (key: string, label: string, open: () => void, unknown: "loading" | "unreadable" | null = null, idle = tk(locale, "wsStop_running")) => {
    const st = liveStops?.[key];
    const stateText = st && st.state !== "unknown"
      ? tk(locale, `wsStop_${st.state}`) + (st.error ? `: ${st.error}` : "")
      : unknown ? tk(locale, unknown === "loading" ? "wsRunLoading" : "wsRunUnreadable")
      : st ? tk(locale, "wsStop_unknown") : idle;
    const glyph = st ? GLYPH[st.state] : unknown ? "working" : "status-idle";
    const stuck = st ? st.state !== "stopped" && st.state !== "stopping" : true; // «Open» only where the stop is not on its way or done
    return (
      <li key={key} data-ws-close-item={key} data-ws-close-state={st?.state ?? (unknown ?? "running")}>
        <span className={`ws-list__glyph ws-list__glyph--${st?.state ?? "idle"}`}><UiIcon name={glyph} size={16} /></span>
        <span>{label}</span>
        <span className="ws-list__state">{stateText}</span>
        {unknown && <button type="button" data-ws-close-retry onClick={() => orch.retry()}>{t(locale, "orchRepeat")}</button>}
        {stuck && <button type="button" data-ws-close-open onClick={open}>{tk(locale, "wsOpen")}</button>}
      </li>
    );
  };
  const workText = ((): string => {
    const r = runs.length, n = terms.length;
    const a = r ? tr(locale, `wsCloseRuns_${pluralForm(locale, r)}`, { n: String(r) }) : "";
    const b = n ? tr(locale, `wsCloseTerms_${pluralForm(locale, n)}`, { n: String(n) }) : "";
    return a && b ? tr(locale, "wsCloseAnd", { a, b }) : a || b;
  })();
  // before «stop everything» the list is not shown (the counts say it); it stays where something needs a look: a run not read, a terminal closed without a confirmed exit
  const showList = !!stops || unknownNow || terms.some((s) => s.closeUnconfirmed);
  const w = controls.state.workspaces.find((x) => x.id === id);
  return (
    <Dialog label={tr(locale, stops ? "wsStopTitle" : "wsCloseTitle", { name: ruCase(locale, workspaceTitle(locale, w), "acc") })} onClose={onClose} locale={locale} className="ws-dialog">
      <div className="orch-form" data-ws-close>
        {!stops && <p className="orch-hint ws-close__text">{workText ? tr(locale, "wsCloseWorkN", { work: workText }) : tk(locale, "wsCloseWork")}</p>}
        {showList && <ul className="ws-list">
          {runs.map((r) => row(`run:${r}`, tr(locale, "wsCloseRun", { project: folderName(orch.canvas.agents.find((a) => a.agentId === orch.canvas.links.find((l) => l.runIds.includes(r))?.fromAgentId)?.project ?? ""), id: r.slice(0, 8) }), () => { onOpenRun(r); onClose(); }, unknownOf(r)))}
          {terms.map((s) => row(`term:${s.id}`, tr(locale, "wsCloseTerminal", { title: s.title }), () => {
            // "Open" leads to the card itself; without a card, say so rather than close as if it worked.
            if (controls.openSession(s.id)) onClose();
            else setError(tk(locale, "wsTerminalGone"));
          }, null, s.closeUnconfirmed ? tk(locale, "wsStop_unconfirmed") : undefined))}
        </ul>}
        {stops && <p className="orch-hint" role="status" data-ws-close-summary>{failed ? tk(locale, "wsStopPartial") : allStopped ? tk(locale, "wsStopDone") : tk(locale, "wsStopWaiting")}</p>}
        {unknownNow && <p className="orch-hint" role="status" data-ws-close-unknown>{tk(locale, "wsCloseUnknown")}</p>}
        <div className="orch-form__actions">
          {!stops && <button type="button" className="orch-danger ws-close__stop" data-ws-close-stop onClick={() => void stopAll()}>{tk(locale, "wsStopAndHideMore")}</button>}
          <button type="button" className="orch-cancel" data-ws-close-cancel onClick={onClose}>{tk(locale, stops ? "wsFold" : "orchCancel")}</button>
          {(!stops || failed || unknownNow) && <button type="button" className="orch-primary" data-ws-close-hide autoFocus title={tk(locale, stops ? "wsHideRestHint" : "wsHideKeepHint")} onClick={() => void hide()}>{tk(locale, stops ? "wsHideRest" : "wsHideKeep")}</button>}
        </div>
        {error && <div className="dialog-error" role="alert">{error}</div>}
      </div>
    </Dialog>
  );
}

const HISTORY_GLYPH: Record<string, "working" | "status-done" | "status-failed" | "status-idle" | "status-paused"> = {
  running: "working", preparing: "working", pausing: "working", stopping: "working", completed: "status-done", completed_no_checks: "status-done",
  failed: "status-failed", paused: "status-paused", stopped: "status-idle"
};

// Every run whose history belongs to this workspace, also runs of links that are gone.
function HistoryDialog({ controls, orch, locale, id, onClose, onOpenRun }: {
  controls: WorkspaceControls; orch: Orchestration; locale: LocaleId; id: string; onClose(): void; onOpenRun(runId: string): void;
}): React.JSX.Element {
  const [runs, setRuns] = useState<{ runId: string; status: string; project: string }[] | null>(null);
  const [failed, setFailed] = useState(false);
  const known = knownWorkspaces(controls.state);
  const load = () => {
    setFailed(false);
    void window.canvasTTY.orchestration.list().then((r) => {
      if (!r.ok) return setFailed(true);
      const owner = runOwners(orch.canvas, known);
      setRuns(r.value.filter((s) => owner(s.view.runId) === id).map((s) => ({ runId: s.view.runId, status: s.view.newer ? "newer" : runStatusKey(s.view), project: folderName(s.view.workDir ?? "") })).reverse());
    }, () => setFailed(true));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per workspace id
  useEffect(load, [id]);
  const w = controls.state.workspaces.find((x) => x.id === id);
  return (
    <Dialog label={tr(locale, "wsHistoryTitle", { name: workspaceTitle(locale, w) })} onClose={onClose} locale={locale} className="ws-dialog">
      <div className="orch-form" data-ws-history>
        {failed && <div className="dialog-error" role="alert">{tk(locale, "wsHistoryFailed")} <button type="button" onClick={load}>{t(locale, "orchRepeat")}</button></div>}
        {!failed && runs === null && <p className="orch-hint">{t(locale, "loading")}</p>}
        {runs?.length === 0 && <p className="orch-hint" data-ws-history-empty>{tk(locale, "wsHistoryEmpty")}</p>}
        <ul className="ws-list">
          {runs?.map((r) => (
            <li key={r.runId} data-ws-history-run={r.runId}>
              <span className="ws-history__run"><span>{r.project || r.runId.slice(0, 8)}</span><code>{r.runId.slice(0, 8)}</code></span>
              <span className={`ws-history__state ws-history__state--${r.status}`} data-ws-history-state={r.status}>
                <UiIcon name={HISTORY_GLYPH[r.status] ?? "status-idle"} size={16} />{r.status === "newer" ? tk(locale, "orchReadOnly") : tk(locale, `orchStatus_${r.status}`)}
              </span>
              <button type="button" data-ws-history-open onClick={() => { onOpenRun(r.runId); onClose(); }}>{t(locale, TERMINAL_STATUSES.includes(r.status) || r.status === "completed_no_checks" ? "orchTab_summary" : "orchOpenRun")}</button>
            </li>
          ))}
        </ul>
        {runs && runs.length > 0 && <p className="orch-hint">{tk(locale, "wsHistoryHint")}</p>}
      </div>
    </Dialog>
  );
}

// "Arrange by workspace…": a proposal by folder, nothing checked; only the checked cards move, after the button.
function ArrangeDialog({ controls, orch, locale, layout, id, onClose }: {
  controls: WorkspaceControls; orch: Orchestration; locale: LocaleId; layout: WorkspaceLayout; id: string; onClose(): void;
}): React.JSX.Element {
  const known = knownWorkspaces(controls.state);
  const groups = useMemo(() => arrangeGroups({ workspaceId: id, known, sessions: controls.allSessions, canvas: orch.canvas,
    runStatus: (r) => orch.runs[r]?.view.status }), [controls.allSessions, id, known, orch.canvas, orch.runs]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // per folder: "new" (a new workspace named after the folder) or an existing workspace's id
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const others = controls.state.workspaces.filter((w) => w.id !== id);
  const targetOf = (folder: string) => targets[folder] ?? others.find((w) => w.root === folder)?.id ?? "new";
  const submit = async (): Promise<void> => {
    setBusy(true);
    const errs: string[] = [];
    for (const g of groups) {
      const items = g.items.filter((i) => checked.has(i.key));
      if (!items.length) continue;
      let target = targetOf(g.folder);
      if (target === "new") {
        const before = new Set(controls.state.workspaces.map((w) => w.id));
        const text = await controls.create(folderName(g.folder) || g.folder, g.folder, false);
        if (text) { errs.push(`${g.folder}: ${text}`); continue; }
        const created = (await window.canvasTTY.workspaces.get()).workspaces.find((w) => !before.has(w.id) && w.root === g.folder);
        if (!created) { errs.push(`${g.folder}: ${tk(locale, "wsActionFailed")}`); continue; }
        target = created.id;
      }
      for (const item of items) {
        const text = await moveOne(controls, orch, locale, layout, item.kind === "terminal" ? "terminal" : "agents", item.ids, target);
        if (text) errs.push(`${item.label}: ${text}`);
      }
    }
    setBusy(false);
    setErrors(errs);
    if (!errs.length) onClose();
  };
  return (
    <Dialog label={tk(locale, "wsArrange")} onClose={onClose} locale={locale} className="ws-dialog">
      <form className="orch-form" data-ws-arrange onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <p className="orch-hint">{tk(locale, "wsArrangeHint")}</p>
        {groups.length === 0 && <p className="orch-hint" data-ws-arrange-empty>{tk(locale, "wsArrangeEmpty")}</p>}
        {groups.map((g) => (
          <section key={g.folder} className="ws-arrange__group" data-ws-arrange-folder={g.folder}>
            <h3>{g.folder}</h3>
            <label className="orch-field ws-arrange__to"><span>{tk(locale, "wsMoveTo")}</span>
              <span className="ws-arrange__select">
                <WsLabel w={others.find((w) => w.id === targetOf(g.folder))} />
              <select value={targetOf(g.folder)} onChange={(event) => setTargets((cur) => ({ ...cur, [g.folder]: event.target.value }))} data-ws-arrange-target>
                <option value="new">{tr(locale, "wsArrangeNew", { name: folderName(g.folder) || g.folder })}</option>
                {others.map((w) => <option key={w.id} value={w.id}>{workspaceTitle(locale, w)}</option>)}
              </select>
              </span>
            </label>
            {g.items.map((i) => (
              <div key={i.key} className="ws-arrange__item">
                <label>
                  <input type="checkbox" data-ws-arrange-item={i.key} disabled={i.blocked} checked={checked.has(i.key)}
                    onChange={(event) => setChecked((cur) => { const next = new Set(cur); if (event.target.checked) next.add(i.key); else next.delete(i.key); return next; })} />
                  <span>{i.kind === "terminal" ? tr(locale, "wsCloseTerminal", { title: i.label }) : tr(locale, "wsArrangeAgents", { n: String(i.ids.length) })}</span>
                </label>
                {i.blocked && <span className="ws-arrange__why">{t(locale, "orchError_group_active_run")}</span>}
              </div>
            ))}
          </section>
        ))}
        <div className="orch-form__actions">
          <button type="button" className="orch-cancel" onClick={onClose}>{t(locale, "orchCancel")}</button>
          <button type="submit" className="orch-primary" data-ws-arrange-submit disabled={busy || checked.size === 0}>{tr(locale, "wsArrangeConfirm", { n: String(checked.size) })}</button>
        </div>
        {errors.map((e) => <div key={e} className="dialog-error" role="alert">{e}</div>)}
      </form>
    </Dialog>
  );
}

function HiddenDialog({ controls, counts, locale, onClose }: { controls: WorkspaceControls; counts: Record<string, WorkspaceCounts>; locale: LocaleId; onClose(): void }): React.JSX.Element {
  const hidden = controls.state.workspaces.filter((w) => w.closed);
  return (
    <Dialog label={tk(locale, "wsHidden")} onClose={onClose} locale={locale} className="ws-dialog">
      <div className="orch-form">
        <ul className="ws-list" data-ws-hidden>
          {hidden.map((w) => (
            <li key={w.id} data-ws-hidden-item={w.id}>
              <span className="ws-pick__name"><WsLabel w={w} />{workspaceTitle(locale, w)}</span>
              {(counts[w.id]?.runs ?? 0) + (counts[w.id]?.cli ?? 0) > 0 && <span className="ws-chip" data-ws-hidden-working>{tr(locale, `wsHiddenWorking_${pluralForm(locale, (counts[w.id]?.runs ?? 0) + (counts[w.id]?.cli ?? 0))}`, { n: String((counts[w.id]?.runs ?? 0) + (counts[w.id]?.cli ?? 0)) })}</span>}
              <button type="button" onClick={() => { controls.switchTo(w.id); onClose(); }}>{tk(locale, "wsShow")}</button>
            </li>
          ))}
        </ul>
        <p className="orch-hint">{tk(locale, "wsHiddenHint")}</p>
        <div className="orch-form__actions ws-hidden__actions"><button type="button" className="orch-cancel" onClick={onClose}>{tk(locale, "wsHiddenClose")}</button></div>
      </div>
    </Dialog>
  );
}

export function BrowserElsewhereDialog({ controls, locale }: { controls: WorkspaceControls; locale: LocaleId }): React.JSX.Element | null {
  if (!controls.browserElsewhere) return null;
  const w = controls.state.workspaces.find((x) => x.id === controls.browserElsewhere);
  return (
    <Dialog label={tr(locale, "wsBrowserTitle", { name: ruCase(locale, workspaceTitle(locale, w), "prep") })} onClose={controls.closeBrowserNotice} locale={locale} className="ws-dialog">
      <div className="orch-form" data-ws-browser-elsewhere={controls.browserElsewhere}>
        <p>{tk(locale, "wsBrowserElsewhere")}</p>
        <div className="orch-form__actions">
          <button type="button" className="orch-cancel" onClick={controls.closeBrowserNotice}>{t(locale, "orchCancel")}</button>
          <button type="button" data-ws-browser-go title={tr(locale, "wsOpenNamed", { name: workspaceTitle(locale, w) })} onClick={controls.goToBrowser}>{tr(locale, "wsBrowserGoTo", { name: ruCase(locale, workspaceTitle(locale, w), "acc") })}</button>
          <button type="button" className="orch-primary" data-ws-browser-bring onClick={() => void controls.bringBrowserHere()}>{tk(locale, "wsBrowserBring")}</button>
        </div>
      </div>
    </Dialog>
  );
}

export function WorkspaceDialogs({ dialog, controls, counts, orch, layout, locale, onClose, onOpenRun }: {
  dialog: WorkspaceDialog | null; controls: WorkspaceControls; counts: Record<string, WorkspaceCounts>; orch: Orchestration; layout: WorkspaceLayout; locale: LocaleId;
  onClose(): void; onOpenRun(runId: string): void;
}): React.JSX.Element | null {
  if (!dialog) return null;
  switch (dialog.kind) {
    case "create": return <WorkspaceForm controls={controls} locale={locale} id={null} onClose={onClose} />;
    case "settings": return <WorkspaceForm controls={controls} locale={locale} id={dialog.id} onClose={onClose} />;
    case "move": return <MoveDialog controls={controls} orch={orch} locale={locale} layout={layout} item={dialog.item} id={dialog.id} label={dialog.label} onClose={onClose} />;
    case "close": return <CloseDialog controls={controls} orch={orch} locale={locale} id={dialog.id} onClose={onClose} onOpenRun={onOpenRun} />;
    case "remove": return <RemoveDialog controls={controls} locale={locale} id={dialog.id} onClose={onClose} />;
    case "history": return <HistoryDialog controls={controls} orch={orch} locale={locale} id={dialog.id} onClose={onClose} onOpenRun={onOpenRun} />;
    case "arrange": return <ArrangeDialog controls={controls} orch={orch} locale={locale} layout={layout} id={dialog.id} onClose={onClose} />;
    case "hidden": return <HiddenDialog controls={controls} counts={counts} locale={locale} onClose={onClose} />;
  }
}
