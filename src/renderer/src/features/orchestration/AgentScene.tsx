// Agent cards and their links inside the canvas scene (world coordinates). The link gesture: drag from the lead's port
// onto an executor card, or press the port (click, Enter, Space) and then "Link here" on an executor; Escape cancels.
// Every rule (self, roles, repeat, projects) is checked in main; a refusal is shown on the card.
import { useEffect, useRef, useState } from "react";
import type { LinkBend } from "../../../../shared/linkBend";
import type { LocaleId, Point, SessionBounds } from "../../../../shared/contracts";
import type { OrchestrationAgentCard, OrchestrationAgentLink } from "../../../../shared/orchestration";
import { t, type TranslationKey } from "../../lib/i18n";
import { tr } from "./boardModel";
import { agentLayerId, pastCanvasDragThreshold } from "../workspace/canvasSelectionGesture";
import { AgentCard } from "./AgentCard";
import { chipOnCurve, chipSize } from "./linkChip";
import { arrowPath, bendFromHandle, linkGeometry, linkPath } from "./linkCurve";
import { linkTrace } from "./linkTrace";
import { ACTIVE_STATUSES, activeRole, liveRuns, shownRunId, agentState, cardRole, orchestrationAvailableHere, orchestrationEntry, participantState, runStatusKey, viewPauseLabel, PAUSES, TERMINAL_STATUSES, type AgentState } from "./runModel";
import { ReleaseNewerLink } from "./RunPanel";
import { conditionsLine, costLine, duration, findingsLine, roleStatus, type StatusLine } from "./runStatus";
import type { AgentCanvasUi } from "./useAgentCanvasUi";
import type { Orchestration } from "./useOrchestration";

interface AgentSceneProps {
  orch: Orchestration;
  ui: AgentCanvasUi;
  locale: LocaleId;
  zoom: number;
  snapEnabled: boolean;
  worldPoint(clientX: number, clientY: number): Point;
  zIndexOf(layerId: string): number;
  groupSelected(layerId: string): boolean;
  withNudge(layerId: string, bounds: SessionBounds): SessionBounds;
  snapTargetsFor(layerId: string): SessionBounds[];
  regionTitles?: readonly { x: number; y: number; width: number; height: number }[]; // where the regions' titles sit: a link chip keeps off them
  taskOfRun?(runId: string): { key: string; title: string } | null; // B2: «T-4 · title» on a card at work
}

const EMPTY: readonly never[] = [];
const rightMid = (b: SessionBounds): Point => ({ x: b.position.x + b.size.width, y: b.position.y + b.size.height / 2 });
const leftMid = (b: SessionBounds): Point => ({ x: b.position.x, y: b.position.y + b.size.height / 2 });
const rect = (b: SessionBounds) => ({ x: b.position.x, y: b.position.y, width: b.size.width, height: b.size.height });

// a card that can take the dragged link (an executor of the lead's project folder) is lit, the rest dim
function offerOf(card: { role: string; project: string }, from: { project: string } | undefined, over: boolean): "ok" | "drop" | "dim" | "dim-over" {
  const fits = card.role === "executor" && from !== undefined && card.project === from.project;
  return fits ? (over ? "drop" : "ok") : over ? "dim-over" : "dim";
}

export function AgentScene(props: AgentSceneProps): React.JSX.Element {
  const { orch, ui, locale, zoom } = props;
  const entry = orchestrationEntry(orchestrationAvailableHere());
  const portDrag = useRef<{ from: string; pointerId: number; start: Point; moved: boolean } | null>(null);
  const [preview, setPreview] = useState<{ from: string; to: Point } | null>(null);
  const [dropOver, setDropOver] = useState<string | null>(null); // the card under the pointer while a link is dragged
  const [selectedLink, setSelectedLink] = useState<string | null>(null); // the link whose bend handle shows
  const [bendDrag, setBendDrag] = useState<{ linkId: string; bend: LinkBend | null } | null>(null); // local until pointerup
  const bendRef = useRef<{ pointerId: number; bend: LinkBend | null } | null>(null);

  // Escape cancels both: the click mode and a drag from the port in progress (its release then links nothing).
  // Always listening: a press on the port is only in a ref until it moves.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      ui.setLinkingFrom(null);
      portDrag.current = null;
      setPreview(null);
      setSelectedLink(null);
      bendRef.current = null; // the handle unmounts mid-drag: no pointerup will come
      setBendDrag(null);
    };
    // a press anywhere but on a link's curve or chip deselects it
    const onDown = (event: PointerEvent): void => {
      const el = event.target as Element | null;
      const hit = el?.closest?.("[data-link-hit]")?.getAttribute("data-link-hit");
      if (hit) setSelectedLink(hit);
      else if (!el?.closest?.(".agent-link__handle, .agent-link__chip")) setSelectedLink(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown, true); };
  }, [ui]);

  const agents = orch.canvas.agents.map((card) => ({ card, bounds: props.withNudge(agentLayerId(card.agentId), card.bounds) }));
  const boundsOf = new Map(agents.map(({ card, bounds }) => [card.agentId, bounds]));
  // C1 (stage-c-parallel.md §6.2): a link may run several tasks at once, each in its own copy. The cards do not multiply:
  // they show one run — the one picked by the switcher, else the latest that goes on, else the latest.
  const liveOf = (link: OrchestrationAgentLink) => liveRuns(link, orch.runs);
  const runIdOf = (link: OrchestrationAgentLink | undefined): string | undefined => shownRunId(link, orch.runs, ui.pickedRuns);
  const runOf = (link: OrchestrationAgentLink | undefined) => {
    const runId = runIdOf(link);
    return runId ? orch.runs[runId]?.view ?? null : null;
  };
  const linkOf = (card: OrchestrationAgentCard) =>
    orch.canvas.links.find((l) => l.fromAgentId === card.agentId || l.toAgentId === card.agentId);
  // "Working" only once its CLI process reported its start; before that the turn is only being started.
  const cardState = (card: OrchestrationAgentCard, link: OrchestrationAgentLink | undefined): AgentState => {
    const runId = runIdOf(link);
    const run = runId ? orch.runs[runId] ?? null : null;
    const s = agentState(card.role, run?.view ?? null);
    // a pause only the person can end ("Ждёт вас: …") is the waiting tone on the card of the role that holds the turn, on both when none does (mock 06)
    const v = run?.view;
    if (s === "paused" && v?.reason && PAUSES[v.reason]?.you !== false && viewPauseLabel(locale, v, orch.activity[v.runId]?.entries ?? []) !== null
      && (!activeRole(v) || (activeRole(v) === "reviewer" ? "lead" : activeRole(v)) === card.role)) return "needs_you";
    if (s !== "working" || !runId) return s;
    const p = participantState(cardRole(card.role, run!.view), run!.view, orch.activity[runId]?.entries ?? [], run!.open);
    return p.phase === "running" || p.phase === "finishing" ? "working" : "starting";
  };
  const isLatest = (link: OrchestrationAgentLink) => runIdOf(link) === link.runIds.at(-1);
  const openRunOf = (link: OrchestrationAgentLink) => (isLatest(link) ? ui.openRun(link.linkId) : ui.openRunById(runIdOf(link)!));
  // The concrete line under the state: the same rules as the home widget and the summary.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  const cardStatus = (card: OrchestrationAgentCard, link: OrchestrationAgentLink | undefined): { status: StatusLine | null; time: string | null; conditions: string | null; findings: string | null; cost: string | null } => {
    const runId = runIdOf(link);
    const run = runId ? orch.runs[runId] : undefined;
    if (!runId || !run) return { status: null, time: runId && orch.runErrors[runId] ? t(locale, "actRunError") : null, conditions: null, findings: null, cost: null };
    const status = roleStatus(locale, cardRole(card.role, run.view), { view: run.view, entries: orch.activity[runId]?.entries ?? [], open: run.open, stageTitles: orch.stageTitles(runId), now });
    const time = status.quiet ?? (status.lastEventAt
      ? `${t(locale, "orchNow_lastEvent").replace("{time}", new Date(status.lastEventAt).toLocaleTimeString(locale))} · ${duration(locale, now - Date.parse(status.lastEventAt))}`
      : null);
    return { status, time, conditions: conditionsLine(locale, run.view), findings: findingsLine(locale, run.view), cost: costLine(locale, card.role, run.view, orch.activity[runId]?.entries ?? []) };
  };

  return (
    <>
      <svg className="agent-links" width="1" height="1" aria-hidden="true">
        {orch.canvas.links.map((link) => {
          const from = boundsOf.get(link.fromAgentId);
          const to = boundsOf.get(link.toAgentId);
          if (!from || !to) return null;
          const view = runOf(link);
          const busy = view !== null && (ACTIVE_STATUSES.includes(view.status) || !!view.newer); // a newer version's run holds its link whatever its journaled status
          const waiting = !!view && (!!view.permission || (view.status === "paused" && !view.halted && !view.newer));
          const bend = bendDrag?.linkId === link.linkId ? bendDrag.bend : link.bend;
          const g = linkGeometry(rightMid(from), leftMid(to), bend);
          const d = linkPath(g);
          const selected = selectedLink === link.linkId;
          const resetBend = (): void => { setBendDrag(null); void orch.setLinkBend(link.linkId, null); };
          return (
            <g key={link.linkId} className={`agent-link${busy ? " agent-link--busy" : ""}${waiting ? " agent-link--waiting" : ""}${selected ? " agent-link--selected" : ""}`} data-agent-link-curve={link.linkId}>
              <path className="agent-link__hit" d={d} data-interactive="true" data-link-hit={link.linkId} />
              <path className="agent-link__line" d={d} vectorEffect="non-scaling-stroke" />
              <path className="agent-link__arrow" d={arrowPath(g, 12 / zoom)} />
              {selected && (
                // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only drag handle; the keyboard resets the bend from the chip
                <circle className="agent-link__handle" cx={g.mid.x} cy={g.mid.y} r={7 / zoom} data-interactive="true" data-agent-link-handle={link.linkId}
                  onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); bendRef.current = { pointerId: e.pointerId, bend: null }; }}
                  onPointerMove={(e) => {
                    if (bendRef.current?.pointerId !== e.pointerId) return;
                    const b = bendFromHandle(rightMid(from), leftMid(to), props.worldPoint(e.clientX, e.clientY));
                    bendRef.current.bend = b;
                    setBendDrag({ linkId: link.linkId, bend: b });
                  }}
                  onPointerUp={(e) => {
                    const r = bendRef.current;
                    if (r?.pointerId !== e.pointerId) return;
                    bendRef.current = null;
                    if (r.bend) void orch.setLinkBend(link.linkId, r.bend).finally(() => setBendDrag(null));
                    else setBendDrag(null);
                  }}
                  onPointerCancel={() => { bendRef.current = null; setBendDrag(null); }}
                  onLostPointerCapture={() => { if (!bendRef.current) return; bendRef.current = null; setBendDrag(null); }} // after pointerup the ref is already clear and the save is in flight
                  onDoubleClick={resetBend}>
                  <title>{t(locale, "orchLinkBendHandle")}</title>
                </circle>
              )}
            </g>
          );
        })}
        {preview && boundsOf.get(preview.from) && (() => {
          const g = linkGeometry(rightMid(boundsOf.get(preview.from)!), preview.to);
          return (
            <g className="agent-link agent-link--preview">
              <path className="agent-link__line" d={linkPath(g)} vectorEffect="non-scaling-stroke" />
              <path className="agent-link__arrow" d={arrowPath(g, 12 / zoom)} />
            </g>
          );
        })()}
      </svg>
      {agents.map(({ card, bounds }) => {
        const layerId = agentLayerId(card.agentId);
        const link = linkOf(card);
        const view = runOf(link);
        const shown = cardStatus(card, link);
        return (
          <AgentCard
            key={card.agentId}
            card={{ ...card, bounds }}
            locale={locale}
            zoom={zoom}
            stackIndex={props.zIndexOf(layerId)}
            state={cardState(card, link)}
            status={shown.status}
            activity={view ? orch.activity[view.runId]?.entries ?? EMPTY : EMPTY}
            pause={view ? viewPauseLabel(locale, view, orch.activity[view.runId]?.entries ?? []) : null}
            statusTime={shown.time}
            conditions={shown.conditions}
            findings={shown.findings}
            cost={shown.cost}
            task={view && !TERMINAL_STATUSES.includes(view.status) ? props.taskOfRun?.(view.runId) ?? null : null}
            ended={view !== null && TERMINAL_STATUSES.includes(view.status)}
            message={ui.messages[card.agentId] ?? null}
            linking={ui.linkingFrom === card.agentId ? "source" : ui.linkingFrom && card.role === "executor" ? "target" : null}
            offer={preview && card.agentId !== preview.from ? offerOf(card, agents.find((a) => a.card.agentId === preview.from)?.card, dropOver === card.agentId) : null}
            linked={link !== undefined}
            hasRun={!!link?.runIds.length}
            selected={props.groupSelected(layerId)}
            snapEnabled={props.snapEnabled}
            snapTargets={props.snapTargetsFor(layerId)}
            onBoundsChange={(agentId, next, expanded) => orch.moveAgent(agentId, next, expanded)}
            onDelete={(agentId) => void ui.deleteAgent(agentId)}
            portDisabledHint={entry.hint ? t(locale, entry.hint) : undefined}
            onPortActivate={(agentId) => { if (!entry.disabled) ui.setLinkingFrom(ui.linkingFrom === agentId ? null : agentId); }}
            onConnectHere={(agentId) => { if (ui.linkingFrom) void ui.connect(ui.linkingFrom, agentId); }}
            onOpenRun={() => { if (link) openRunOf(link); }}
            onSummary={() => { if (link) (isLatest(link) ? ui.openPanel(link.linkId, { tab: "summary" }) : ui.openRunById(runIdOf(link)!, { tab: "summary" })); }}
            onObserve={() => { if (link) (isLatest(link) ? ui.openPanel(link.linkId, { tab: "work", mode: "feed", role: card.role }) : ui.openRunById(runIdOf(link)!, { tab: "work", mode: "feed", role: card.role })); }}
            onPortDown={(agentId, event) => {
              linkTrace("port.down", { agentId, pointerId: event.pointerId, button: event.button, x: event.clientX, y: event.clientY });
              if (event.button !== 0 || entry.disabled) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              portDrag.current = { from: agentId, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, moved: false };
            }}
            onPortMove={(event) => {
              const d = portDrag.current;
              if (!d || d.pointerId !== event.pointerId) return;
              event.stopPropagation();
              if (!d.moved && !pastCanvasDragThreshold(d.start, { x: event.clientX, y: event.clientY })) return;
              if (!d.moved) linkTrace("port.moved", { pointerId: event.pointerId, x: event.clientX, y: event.clientY });
              d.moved = true;
              setPreview({ from: d.from, to: props.worldPoint(event.clientX, event.clientY) });
              setDropOver(document.elementsFromPoint(event.clientX, event.clientY).map((el) => el.closest<HTMLElement>("[data-agent-id]")).find((el) => el !== null)?.dataset.agentId ?? null);
            }}
            onPortUp={(event) => {
              const d = portDrag.current;
              linkTrace("port.end", { type: event.type, pointerId: event.pointerId, drag: d ? { from: d.from, pointerId: d.pointerId, moved: d.moved } : null, x: event.clientX, y: event.clientY });
              if (!d || d.pointerId !== event.pointerId) return;
              event.stopPropagation();
              portDrag.current = null;
              setPreview(null);
              setDropOver(null);
              // cancelled, or the capture lost without a release (another pointer event took it): the gesture ends here
              if (event.type !== "pointerup") return;
              if (!d.moved) {
                ui.setLinkingFrom(ui.linkingFrom === d.from ? null : d.from);
                return;
              }
              const target = document.elementsFromPoint(event.clientX, event.clientY)
                .map((el) => el.closest<HTMLElement>("[data-agent-id]"))
                .find((el) => el !== null);
              const toId = target?.dataset.agentId;
              linkTrace("port.drop", { from: d.from, toId: toId ?? null, under: document.elementsFromPoint(event.clientX, event.clientY).slice(0, 5).map((el) => String(el.className).slice(0, 60)) });
              if (toId) void ui.connect(d.from, toId);
            }}
          />
        );
      })}
      {/* After the cards, at the z of the higher of its two cards: never hidden by its own cards (when they sit close
          or overlap), still below any window raised above them. */}
      {orch.canvas.links.map((link) => {
        const from = boundsOf.get(link.fromAgentId);
        const to = boundsOf.get(link.toAgentId);
        if (!from || !to) return null;
        const view = runOf(link);
        const busy = view !== null && (ACTIVE_STATUSES.includes(view.status) || !!view.newer); // a newer version's run holds its link whatever its journaled status
        // several live runs (up to 4): the chip says the most demanding one's state (needs you, then paused, else the shown run)
        const liveViews = liveOf(link).map((id) => orch.runs[id]?.view).filter((v): v is NonNullable<typeof v> => !!v);
        const shown = liveViews.length > 1 ? liveViews.find((v) => v.permission) ?? liveViews.find((v) => v.status === "paused") ?? view : view;
        const label = shown?.permission ? t(locale, "orchLinkNeedsYou") : shown?.newer ? t(locale, "orchReadOnly") : shown ? viewPauseLabel(locale, shown, orch.activity[shown.runId]?.entries ?? []) ?? t(locale, `orchStatus_${runStatusKey(shown)}` as TranslationKey) : t(locale, "orchNoRun");
        // on the curve, off the cards (and the bend handle when selected) (Н14, linkChip.ts)
        const g = linkGeometry(rightMid(from), leftMid(to), bendDrag?.linkId === link.linkId ? bendDrag.bend : link.bend);
        const at = chipOnCurve(g, [...agents.map(({ bounds }) => rect(bounds)), ...(props.regionTitles ?? [])], chipSize(label, (busy ? 0 : 2) + (view ? 2 : 0) + (view?.newer ? 1 : 0) + (link.bend ? 1 : 0) + (liveViews.length > 1 ? 1 : 0)) /* new goal, ×, open run, observe, release, reset, runs: every button counts */, selectedLink === link.linkId, [rect(from), rect(to)]);
        return (
          <div key={link.linkId} className={`agent-link__chip${view?.permission ? " agent-link__chip--needs-you" : ""}`} data-interactive="true" data-agent-link-id={link.linkId}
            role="group" aria-label={t(locale, "orchLink")}
            style={{ left: at.x, top: at.y,
              zIndex: Math.max(props.zIndexOf(agentLayerId(link.fromAgentId)), props.zIndexOf(agentLayerId(link.toAgentId))) }}>
            <span className="agent-link__state">
              {label}
            </span>
            {!busy && <button type="button" disabled={entry.disabled} title={entry.hint ? t(locale, entry.hint) : undefined}
              onClick={() => ui.openGoal(link.linkId)}>{t(locale, "orchNewGoal")}</button>}
            {liveViews.length > 1 && (() => {
              const live = liveOf(link);
              const i = Math.max(0, live.indexOf(runIdOf(link) ?? ""));
              return (
                <button type="button" data-agent-runs={live.length} title={tr(locale, "agentRunPick", { n: i + 1, total: live.length })}
                  onClick={() => ui.pickRun(link.linkId, live[(i + 1) % live.length])}>
                  {`${tr(locale, "agentRuns", { n: live.length })} · ${i + 1}/${live.length} ›`}</button>
              );
            })()}
            {view && <button type="button" onClick={() => openRunOf(link)}>{t(locale, "orchOpenRun")}</button>}
            {view?.newer && <ReleaseNewerLink orch={orch} linkId={link.linkId} runId={view.runId} locale={locale} />}
            {view && <button type="button" onClick={() => {
              const r = view.permission?.role ?? activeRole(view);
              ui.openPanel(link.linkId, { tab: "work", mode: "feed", role: r === "check" ? "check" : r ?? "executor" });
            }}>{t(locale, "orchObserve")}</button>}
            {link.bend && <button type="button" className="agent-link__reset" onClick={() => { bendRef.current = null; setBendDrag(null); void orch.setLinkBend(link.linkId, null); }}>{t(locale, "orchLinkBendReset")}</button>}
            {!busy && (
              <button type="button" className="agent-link__delete" onClick={() => void ui.deleteLink(link)}
                title={t(locale, "orchDeleteLink")} aria-label={t(locale, "orchDeleteLink")}>×</button>
            )}
          </div>
        );
      })}
    </>
  );
}
