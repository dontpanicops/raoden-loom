import { invZoom, zoomedAttr } from "../../lib/cardChrome";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LocaleId, SessionBounds } from "../../../../shared/contracts";
import type { OrchestrationActivityEntry, OrchestrationAgentCard } from "../../../../shared/orchestration";
import { ProviderIcon } from "../../components/ProviderIcon";
import { Term } from "../../components/Term";
import { UiIcon } from "../../components/UiIcon";
import { CARD_STATUS_ICON, agentCardStatus } from "../../lib/cardStatus";
import { t, type TranslationKey } from "../../lib/i18n";
import { AGENT_CARD_EXPANDED, AGENT_CARD_LIMITS as LIMITS, AGENT_CARD_SIZE, agentCardSize, isCompact, withoutHome } from "./agentCardGeometry";
import type { AgentState } from "./runModel";
import { CARD_FEED_KINDS, entryLabel, structured } from "./RunPanel";
import { isServiceEntry, type StatusLine } from "./runStatus";
import { RESIZE_DIRECTIONS, useCardFrame } from "./useCardFrame";
import type { CardMessage } from "./useAgentCanvasUi";


interface AgentCardProps {
  card: OrchestrationAgentCard;
  locale: LocaleId;
  zoom: number;
  stackIndex: number;
  state: AgentState;
  status: StatusLine | null; // what it does now, from the shared display rules (runStatus.ts)
  activity: readonly OrchestrationActivityEntry[]; // the link's latest run's events: the live feed of a larger card
  statusTime: string | null; // the last event's time or the silence, already in words
  conditions?: string | null; // A2: "N of M conditions met" (runStatus.ts conditionsLine)
  findings?: string | null; // A3: "open blocking: N" (runStatus.ts findingsLine)
  cost?: string | null; // UX audit Н7: "Model calls: N · tokens: …" (runStatus.ts costLine)
  task?: { key: string; title: string } | null; // B2: the board task its run works on, above the line of what it does
  ended: boolean; // its link's latest run has ended: the summary is offered
  message: CardMessage | null;
  linking: "source" | "target" | null; // keyboard/click linking mode
  linked: boolean;
  offer?: "source" | "ok" | "drop" | "dim" | "dim-over" | "dim-far" | null; // while a link is dragged from a port (mock 18): fits / under the pointer / other role or folder / the latter under the pointer
  hasRun: boolean;
  selected: boolean;
  snapEnabled: boolean;
  snapTargets: readonly SessionBounds[];
  onBoundsChange(agentId: string, bounds: SessionBounds, expanded?: SessionBounds["size"]): void;
  onDelete(agentId: string): void;
  onPortDown(agentId: string, event: React.PointerEvent<HTMLButtonElement>): void;
  onPortMove(event: React.PointerEvent<HTMLButtonElement>): void;
  onPortUp(event: React.PointerEvent<HTMLButtonElement>): void;
  onPortActivate(agentId: string): void;
  portDisabledHint?: string; // linking is unavailable on this platform: the port is shown, inactive, with this hint
  onConnectHere(agentId: string): void;
  onOpenRun(agentId: string): void;
  onObserve(agentId: string): void;
  onSummary(agentId: string): void;
  stageOf?: string | null; // «stage 1 of 2», after the state of a working card (mock 06)
  failure?: { stage: string | null; line: string | null } | null; // a failed run (mock 06): «Упал на этапе N» and, when the activity knows the exit, the CLI line
  awaitsPermission?: boolean; // the run waits for a permission request: «Ждёт разрешения»
  pause?: string | null; // a paused run's short form ("Waiting for you: …"), the link chip's words (runModel viewPauseLabel)
}

const STATE_KEY: Record<AgentState, TranslationKey> = {
  idle: "orchAgentIdle", starting: "orchAgentStarting", working: "orchAgentWorking", waiting: "orchAgentWaiting", needs_you: "orchAgentNeedsYou", paused: "orchAgentPaused",
  stopping: "orchAgentStopping", completed: "orchAgentCompleted", completed_no_checks: "orchAgentCompletedNoChecks", stopped: "orchAgentStopped", failed: "orchAgentFailed", read_only: "orchReadOnly"
};

const MOVING = ["starting", "working", "checking", "waiting_agent"];

// A managed orchestration agent (stage-8-contract.md §1): not a terminal, never a PTY. Moves and resizes like a
// terminal card (1.5.13); a larger card shows the agent's latest events. The lead's port starts a link by drag (or by
// click/Enter, then "Link here" on an executor).
export function AgentCard(props: AgentCardProps): React.JSX.Element {
  const { card, locale, zoom, state, status, message, linking, snapEnabled, snapTargets } = props;
  const [confirming, setConfirming] = useState(false);
  // a larger size is the one "Expand" returns to
  const save = (next: SessionBounds): void => props.onBoundsChange(card.agentId, next, isCompact(next.size) ? undefined : next.size);
  const frame = useCardFrame({ bounds: card.bounds, zoom, snapEnabled, snapTargets, limits: LIMITS,
    onMoved: (next) => props.onBoundsChange(card.agentId, next), onResized: save });
  const { bounds, live, apply } = frame;
  const { position, size } = bounds;
  const compact = isCompact(size);
  // compact <-> the size it had last time it was larger
  const toggle = (): void => {
    const larger = live.current.size; // kept to come back to, read before the card shrinks
    const next = compact
      ? { position: live.current.position, size: agentCardSize(card.expanded ?? AGENT_CARD_EXPANDED) }
      : { position: live.current.position, size: { ...AGENT_CARD_SIZE } };
    apply(next);
    props.onBoundsChange(card.agentId, next, compact ? undefined : larger);
  };
  // a double click on the header does what its «Expand / Collapse» button does (the button is the keyboard's way)
  const header = useRef<HTMLElement>(null);
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    const el = header.current;
    const onDouble = (event: MouseEvent): void => { if (!(event.target as HTMLElement).closest("button:not(.orch-term)")) toggleRef.current(); };
    el?.addEventListener("dblclick", onDouble);
    return () => el?.removeEventListener("dblclick", onDouble);
  }, []);
  const doing = status && MOVING.includes(status.state) ? status.doing : null;
  const held = props.pause && (state === "paused" || state === "needs_you");
  const stateLabel = held && props.pause ? props.pause : state === "failed" && props.failure?.stage ? props.failure.stage : state === "needs_you" && props.awaitsPermission ? t(locale, "orchAgentAwaitsPermission") : t(locale, STATE_KEY[state]);
  const stage = !held && state === "working" && props.stageOf ? props.stageOf : "";
  const stateText = stage ? `${stateLabel} · ${stage}` : stateLabel;
  // SPEC 11.2 / mock 21: below 100% the status leaves the body for the footer (the terminal's format); below 40% the card is a summary: name and glyph
  const zoomed = zoom < 1;
  const farSummary = zoom < 0.4;
  const provider = card.provider === "codex" ? "Codex" : "Claude";
  const extra = status ? status.wait ?? status.now : null;

  return (
    <article
      className={`agent-card agent-card--${card.provider} agent-card--${state} ${props.selected ? "agent-card--selected" : ""} ${linking ? `agent-card--linking-${linking}` : ""} ${props.offer ? `agent-card--offer-${props.offer}` : ""}`}
      data-interactive="true"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the card is the keyboard's stop of its own: the focus ring lies on it, not on a header button (mock 18)
      tabIndex={0}
      data-zoomed={zoomedAttr(zoom)}
      data-agent-far={farSummary ? "" : undefined}
      data-agent-tight={zoom < 0.6 ? "" : undefined}
      data-agent-id={card.agentId}
      data-agent-role={card.role}
      data-hover-host=""
      data-canvas-layer-id={`agent:${card.agentId}`}
      aria-label={`${card.provider === "codex" ? "Codex" : "Claude"} — ${t(locale, card.role === "lead" ? "orchRoleLead" : "orchRoleExecutor")}`}
      style={{ zIndex: props.stackIndex, width: size.width, height: size.height, transform: `translate(${position.x}px, ${position.y}px)`, "--iz": invZoom(zoom) } as React.CSSProperties}
    >
      <header className="agent-card__header" {...frame.header} ref={header}>
        <span className="agent-card__identity">
          <ProviderIcon provider={card.provider} size="small" />
          <i className="agent-card__dot" aria-hidden="true" />
          <strong data-hover-anchor="">{card.provider === "codex" ? "Codex" : "Claude"}</strong>
          <small><Term locale={locale} id={card.role}><span className="agent-card__role">{t(locale, card.role === "lead" ? "orchRoleLead" : "orchRoleExecutor")}</span></Term></small>
        </span>
        <span className="agent-card__header-actions">
          <button className="agent-card__expand" type="button" data-agent-expand={compact ? "compact" : "expanded"} onClick={toggle}
            title={t(locale, compact ? "orchCardExpand" : "orchCardCollapse")} aria-label={t(locale, compact ? "orchCardExpand" : "orchCardCollapse")}>
            <UiIcon name={compact ? "maximize" : "restore"} size="1.05em" />
          </button>
          <button className="agent-card__close" type="button" onClick={() => (props.linked ? setConfirming(true) : props.onDelete(card.agentId))}
            title={t(locale, "orchDeleteCard")} aria-label={t(locale, "orchDeleteCard")}>
            <UiIcon name="trash" size="1.1em" />
          </button>
        </span>
      </header>
      <div className="agent-card__body">
        {/* every line is one line: a long one ends with "…" and says all of it in its tooltip (1.5.13) */}
        {!zoomed && <div className="agent-card__status" role="status">
          <span className={`agent-card__state agent-card__state--${state}`} data-agent-pause={held ? "yes" : undefined}
            title={compact && props.statusTime ? `${stateText} · ${props.statusTime}` : stateText}>
            <UiIcon name={CARD_STATUS_ICON[agentCardStatus(state)]} size="1.1em" />
            <span>{stateText}</span></span>
          {props.statusTime && !compact && <span className="agent-card__time" data-agent-time title={props.statusTime}>{props.statusTime}</span>}
        </div>}
        <div className="agent-card__project" title={card.project}><small>{withoutHome(card.project)}</small></div>
        {/* the status already names a held state (paused, ended, waiting for you); the sentence adds what moves */}
        {state === "failed" && props.failure?.line && <div className="agent-card__line" data-agent-failure title={props.failure.line}>{props.failure.line}</div>}
        {props.task && <div className="agent-card__line agent-card__task" data-agent-task={props.task.key} title={props.task.title}>{props.task.key} · {props.task.title}</div>}
        {doing && <div className="agent-card__line agent-card__doing" data-agent-doing title={doing}>{doing}</div>}
        {extra && <div className="agent-card__line" data-agent-now title={extra}>{extra}</div>}
        {card.role === "lead" && !props.linked && !message && state === "idle" && <p className="agent-card__hint" data-agent-port-hint>{t(locale, "orchCardPortHint")}</p>}
        {message && !message.pairWith && <div className={`agent-card__message agent-card__message--${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</div>}
        {/* semantic zoom: far out the card keeps its lines and gives the wheel back to the canvas */}
        {!compact && zoom >= 0.4 && props.hasRun && <CardFeed locale={locale} entries={props.activity} role={card.role} height={size.height} />}
        {confirming && (
          <div className="agent-card__confirm" role="alertdialog" aria-label={t(locale, "orchDeleteCard")}>
            <span>{t(locale, "orchDeleteCardLinked")}</span>
            <button type="button" className="agent-card__danger" onClick={() => { setConfirming(false); props.onDelete(card.agentId); }}>{t(locale, "orchDeleteCard")}</button>
            <button type="button" autoFocus onClick={() => setConfirming(false)}>{t(locale, "orchCancel")}</button>
          </div>
        )}
        <div className="agent-card__actions">
          {linking === "target" && (
            <button className="agent-card__connect" type="button" onClick={() => props.onConnectHere(card.agentId)}>{t(locale, "orchConnectHere")}</button>
          )}
          {props.ended && (
            <button className="agent-card__summary" type="button" onClick={() => props.onSummary(card.agentId)}>{t(locale, "orchSummaryButton")}</button>
          )}
          {/* R12r/R12t (mock 03/06/21): the run's two ways in show only on hover, focus or a selected card; «Открыть запуск» stays when the run failed or waits for the person */}
          {props.hasRun && (
            <button className="agent-card__open agent-card__run-action" type="button" onClick={() => props.onOpenRun(card.agentId)}>{t(locale, "orchOpenRun")}</button>
          )}
          {props.hasRun && (
            <button className="agent-card__observe agent-card__run-action" type="button" onClick={() => props.onObserve(card.agentId)}>{t(locale, "orchObserve")}</button>
          )}
        </div>
      </div>
      {zoomed && !farSummary && (
        <footer className="agent-card__footer" role="status" title={compact && props.statusTime ? `${stateText} · ${props.statusTime}` : stateText}>
          <span className={`agent-card__state agent-card__state--${state}`} data-agent-pause={held ? "yes" : undefined}>
            <UiIcon name={CARD_STATUS_ICON[agentCardStatus(state)]} size="1.1em" />
            <span className="agent-card__state-text">
              <span className="agent-card__state-label">{stateLabel}</span>
              {stage && <span className="agent-card__state-stage"> · {stage}</span>}
            </span>
          </span>
        </footer>
      )}
      {farSummary && (
        <div className="agent-card__far" role="status" title={`${provider} · ${stateText}`}>
          <strong>{provider}</strong>
          <span className={`agent-card__state agent-card__state--${state}`}><UiIcon name={CARD_STATUS_ICON[agentCardStatus(state)]} size="1.4em" /></span>
        </div>
      )}
      {(props.offer === "drop" || props.offer === "dim-over" || props.offer === "dim-far") && (
        <span className="agent-card__offer" aria-hidden="true">{t(locale, props.offer === "drop" ? "orchReleaseToLink" : "orchOtherFolder")}</span>
      )}
      {RESIZE_DIRECTIONS.map((direction) => (
        <div key={direction} className={`terminal-card__resize-handle terminal-card__resize-handle--${direction}`} aria-hidden="true" data-agent-resize={direction}
          {...frame.handle(direction)} />
      ))}
      {card.role === "lead" && (
        <button
          className="agent-card__port"
          type="button"
          aria-label={t(locale, "orchPort")}
          title={props.portDisabledHint ?? t(locale, "orchPort")}
          disabled={props.portDisabledHint !== undefined}
          aria-pressed={linking === "source"}
          onPointerDown={(event) => props.onPortDown(card.agentId, event)}
          onPointerMove={props.onPortMove}
          onPointerUp={props.onPortUp}
          onPointerCancel={props.onPortUp}
          onLostPointerCapture={props.onPortUp}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              props.onPortActivate(card.agentId);
            }
          }}
        />
      )}
    </article>
  );
}

// The agent's latest events, as the activity feed says them (RunPanel entryLabel), newest at the bottom. It follows new
// events while the reader is at the bottom; scrolled up, it stays where the reader is until they come back down.
function CardFeed({ locale, entries, role, height }: { locale: LocaleId; entries: readonly OrchestrationActivityEntry[]; role: "lead" | "executor"; height: number }): React.JSX.Element {
  // the lead's card is also the reviewer's (the reviewer is a session of the lead's CLI)
  const items = useMemo(() => entries.filter((e) => (role === "lead" ? e.role === "lead" || e.role === "reviewer" : e.role === "executor")
    && CARD_FEED_KINDS.has(e.kind) && !isServiceEntry(e)).slice(-200), [entries, role]);
  const box = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  useLayoutEffect(() => {
    const el = box.current;
    // a new event, or a taller card, while the reader is at the bottom: still at the bottom
    if (el && following && items.length + height > 0) el.scrollTop = el.scrollHeight;
  }, [items.length, height, following]);
  const onScroll = (): void => {
    const el = box.current;
    if (el) setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 8);
  };
  return (
    <div className="agent-card__feed" ref={box} onScroll={onScroll} data-agent-feed data-following={following ? "yes" : "no"} data-wheel-owner="local">
      {items.length === 0 && <p className="agent-card__feed-empty">{t(locale, "orchCardFeedEmpty")}</p>}
      {items.map((e) => {
        // a report a CLI wrote as JSON is "Message: report", as in the activity feed
        const text = withoutHome(structured(e) ? `${t(locale, "orchAct_message")}: ${t(locale, "orchFeedReport")}` : entryLabel(locale, e, entries));
        return (
          <div key={e.id} className="agent-card__feed-item" data-activity-id={e.id} title={text}>
            <time>{e.ts ? new Date(e.ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "—"}</time> · <span>{text}</span>
          </div>
        );
      })}
    </div>
  );
}
