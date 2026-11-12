import { useEffect, useMemo, useRef, useState } from "react";
import { useEffectiveTheme } from "../settings/useEffectiveTheme";
import type {
  AgentProviderId,
  AppSettings,
  HomeGridSize,
  HomeWidgetPlacement,
  InstalledPlugin,
  LimitsSnapshot,
  LocaleId,
  ProviderId,
  SessionSnapshot,
  SessionStatus
} from "../../../../shared/contracts";
import {
  HOME_GRID_CELL_HEIGHT,
  HOME_GRID_CELL_WIDTH,
  HOME_GRID_GAP,
  HOME_GRID_MAX_COLUMNS,
  HOME_GRID_MAX_ROWS
} from "../../../../shared/contracts.ts";
import { ProviderIcon } from "../../components/ProviderIcon";
import { UiIcon } from "../../components/UiIcon";
import { t, type TranslationKey } from "../../lib/i18n";
import {
  AGENT_PROVIDERS,
  homeLauncherColumnCount,
  PROVIDERS,
  resolveHomeLimitProviders,
  resolveHomeLauncherProviders
} from "../../lib/providers";
import { sessionStatusIcon, sessionStatusLabel } from "../../lib/sessionStatus";
import { sessionStatusTone } from "../../lib/sessionStatusTone";
import { HomeMediaWidget } from "./HomeMediaWidget";
import { PluginFrame } from "../plugins/PluginFrame";
import type { PluginCanvasWheelInput } from "../plugins/pluginInputBridge";
import {
  HOME_GRID_COLUMN_STEP,
  HOME_GRID_ROW_STEP,
  homeGridPixelSize,
  isInsideHome,
  minimumHomeGridSize,
  resizeHomePlacement,
  type HomeResizeDirection,
  updateHomePlacement
} from "./homeLayout";
import {
  formatLimitDuration,
  formatResetCountdown,
  selectHomeModel,
  type HomeLimitReason,
  type HomeLimitRow,
  type LimitsLoadState
} from "./homeModel";
import { homeCanvasWidgetId } from "../workspace/canvasWidgetFocus";
import { stateLabel, type ActivityRunRow, type ActivityState } from "../orchestration/runStatus";

// Orchestration runs for the activity widget, built from the application's own state (runStatus.ts).
export interface HomeOrchestrationActivity {
  status: "loading" | "ready" | "error";
  rows(now: number): { active: ActivityRunRow[]; recent: ActivityRunRow[] };
}

interface HomeZoneProps {
  settings: AppSettings;
  mediaData: string | null;
  sessions: SessionSnapshot[];
  sessionsLoadState: LimitsLoadState;
  orchestration: HomeOrchestrationActivity;
  onRetryActivity(): void;
  onOpenRun(linkId: string): void;
  onOpenRunSummary(linkId: string): void;
  limits: LimitsSnapshot | null;
  limitsLoadState: LimitsLoadState;
  plugins: InstalledPlugin[];
  editing: boolean;
  onOpenSettings(): void;
  onOpenAgent(provider: AgentProviderId, anchor?: DOMRect): void;
  onOpenTerminal(): void;
  onOpenBrowser(): void;
  onSetDockProviders(next: AgentProviderId[]): void;
  onFocusSession(session: SessionSnapshot): void;
  onRequestMedia(): Promise<void>;
  onRemoveMedia(): Promise<void>;
  onLayoutChange(layout: HomeWidgetPlacement[]): void;
  onGridSizeChange(gridSize: HomeGridSize): void;
  onPluginError(message: string): void;
  captureCanvasWheelOverWidgets: boolean;
  focusedWidgetId: string | null;
  onWidgetFocus(id: string): void;
  onWidgetHoverChange(id: string, active: boolean): void;
  onPluginCanvasWheel(event: PluginCanvasWheelInput): void;
}

interface LayoutPointerState {
  pointerId: number;
  mode: "move" | "resize";
  direction: HomeResizeDirection | null;
  startClient: { x: number; y: number };
  startPlacement: HomeWidgetPlacement;
  scale: { x: number; y: number };
}

interface GridPointerState {
  pointerId: number;
  startClient: { x: number; y: number };
  startGridSize: HomeGridSize;
  scale: { x: number; y: number };
}

// Waiting first, then working, failed, the rest (mock 05: "by status").
const SESSION_ORDER: Record<SessionStatus, number> = { needs_approval: 0, working: 1, failed: 2, done: 3, idle: 4, unavailable: 5 };
const HOME_RESIZE_DIRECTIONS: HomeResizeDirection[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const FAILURE_TOOLTIP_GAP = 6;
const FAILURE_TOOLTIP_MARGIN = 16;
const FAILURE_TOOLTIP_MAX_WIDTH = 380;
const FAILURE_TOOLTIP_MAX_DETAILS_HEIGHT = 130; // about 7 mono lines (mock 05)
const FAILURE_TOOLTIP_MIN_DETAILS_HEIGHT = 60;
const FAILURE_TOOLTIP_CHROME_HEIGHT = 120; // header and note

interface SessionFailureDetailsProps {
  sessionId: string;
  title: string;
  exitCode: number | null;
  details: string;
  locale: LocaleId;
}

function SessionFailureDetails({ sessionId, title, exitCode, details, locale }: SessionFailureDetailsProps): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const tooltipId = `session-failure-${sessionId}`;
  const tail = details.split("\n").filter((line) => line.trim() !== "").slice(-7).join("\n"); // the full text is what "Copy" takes

  const cancelClose = (): void => {
    if (closeTimer.current === null) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  const closeTooltip = (): void => {
    cancelClose();
    const tooltip = tooltipRef.current;
    if (tooltip?.matches(":popover-open")) tooltip.hidePopover();
    setOpen(false);
  };

  const scheduleClose = (): void => {
    cancelClose();
    closeTimer.current = setTimeout(closeTooltip, 160);
  };

  const positionTooltip = (): void => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const bounds = trigger.getBoundingClientRect();
    const width = Math.min(FAILURE_TOOLTIP_MAX_WIDTH, window.innerWidth - FAILURE_TOOLTIP_MARGIN * 2);
    const left = Math.max(
      FAILURE_TOOLTIP_MARGIN,
      Math.min(bounds.right - width, window.innerWidth - width - FAILURE_TOOLTIP_MARGIN)
    );
    const availableBelow = window.innerHeight - bounds.bottom - FAILURE_TOOLTIP_GAP - FAILURE_TOOLTIP_MARGIN;
    const availableAbove = bounds.top - FAILURE_TOOLTIP_GAP - FAILURE_TOOLTIP_MARGIN;
    const placeBelow = availableBelow >= availableAbove;
    const availableHeight = Math.max(placeBelow ? availableBelow : availableAbove, FAILURE_TOOLTIP_MIN_DETAILS_HEIGHT);
    const detailsHeight = Math.max(
      FAILURE_TOOLTIP_MIN_DETAILS_HEIGHT,
      Math.min(FAILURE_TOOLTIP_MAX_DETAILS_HEIGHT, availableHeight - FAILURE_TOOLTIP_CHROME_HEIGHT)
    );

    tooltip.style.left = `${left}px`;
    tooltip.style.setProperty("--failure-tooltip-details-max-height", `${detailsHeight}px`);
    if (placeBelow) {
      tooltip.style.top = `${bounds.bottom + FAILURE_TOOLTIP_GAP}px`;
      tooltip.style.bottom = "auto";
    } else {
      tooltip.style.top = "auto";
      tooltip.style.bottom = `${window.innerHeight - bounds.top + FAILURE_TOOLTIP_GAP}px`;
    }
  };

  const openTooltip = (): void => {
    cancelClose();
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    positionTooltip();
    if (!tooltip.matches(":popover-open")) tooltip.showPopover();
    setOpen(true);
  };

  const handleEscape = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeTooltip();
    triggerRef.current?.focus();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: positionTooltip only reads refs and constants
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", positionTooltip);
    window.addEventListener("scroll", positionTooltip, true);
    return () => {
      window.removeEventListener("resize", positionTooltip);
      window.removeEventListener("scroll", positionTooltip, true);
    };
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount-only cleanup; cancelClose only reads a ref
  useEffect(() => () => cancelClose(), []);

  return (
    <>
      <button
        ref={triggerRef}
        className="usage-row__failure-trigger"
        type="button"
        aria-controls={tooltipId}
        aria-describedby={tooltipId}
        aria-expanded={open}
        title={t(locale, "showErrorDetails")}
        aria-label={t(locale, "showErrorDetails")}
        onClick={openTooltip}
        onMouseEnter={openTooltip}
        onMouseLeave={scheduleClose}
        onFocus={openTooltip}
        onBlur={scheduleClose}
        onKeyDown={handleEscape}
      >
        <UiIcon name="error" size={16} />{sessionStatusLabel(locale, "failed")}
      </button>
      <div
        ref={tooltipRef}
        className="usage-row__failure-tooltip"
        id={tooltipId}
        role="group"
        aria-label={t(locale, "statusFailed")}
        popover="manual"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onFocus={cancelClose}
        onBlur={scheduleClose}
        onKeyDown={handleEscape}
        onToggle={(event) => setOpen(event.currentTarget.matches(":popover-open"))}
      >
        <div className="usage-row__failure-head">
          <span className="usage-row__failure-title">
            <UiIcon name="error" size={14} />
            <span className="usage-row__failure-name">{title}</span>
            {exitCode !== null && <span className="usage-row__failure-code">{t(locale, "failureHeadline").replace("{name} ", "").replace("{code}", String(exitCode))}</span>}
          </span>
          <button
            className="usage-row__failure-copy"
            type="button"
            onClick={() => window.canvasTTY.clipboard.writeText(details)}
            title={t(locale, "copyErrorDetails")}
            aria-label={t(locale, "copyErrorDetails")}
          >
            {t(locale, "failureCopy")}
          </button>
        </div>
        <span className="usage-row__failure-details">{tail}</span>
        <p className="usage-row__failure-note">{t(locale, "failureNote")}</p>
      </div>
    </>
  );
}

export function HomeZone({
  settings,
  mediaData,
  sessions,
  sessionsLoadState,
  orchestration,
  onRetryActivity,
  onOpenRun,
  onOpenRunSummary,
  limits,
  limitsLoadState,
  plugins,
  editing,
  onOpenSettings,
  onOpenAgent,
  onOpenTerminal,
  onOpenBrowser,
  onSetDockProviders,
  onFocusSession,
  onRequestMedia,
  onRemoveMedia,
  onLayoutChange,
  onGridSizeChange,
  onPluginError,
  captureCanvasWheelOverWidgets,
  focusedWidgetId,
  onWidgetFocus,
  onWidgetHoverChange,
  onPluginCanvasWheel
}: HomeZoneProps): React.JSX.Element {
  const locale = settings.locale;
  const theme = useEffectiveTheme(settings);
  const launcherProviders = resolveHomeLauncherProviders(settings);
  const dockCandidates = AGENT_PROVIDERS.filter((provider) => !launcherProviders.includes(provider));
  const [dockMenuOpen, setDockMenuOpen] = useState(false);
  const [cliFound, setCliFound] = useState<readonly AgentProviderId[]>([]); // which agents' CLIs main finds, shown in the «Add» list (SPEC 11.1)
  useEffect(() => {
    if (dockMenuOpen) window.canvasTTY.providers.available().then(setCliFound).catch(() => setCliFound([]));
  }, [dockMenuOpen]);
  useEffect(() => {
    if (!dockMenuOpen) return undefined;
    const close = (event: PointerEvent | KeyboardEvent): void => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !(event.target as Element | null)?.closest?.(".launcher-add-menu, .launcher-button--add")) setDockMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [dockMenuOpen]);
  const limitProviders = resolveHomeLimitProviders(settings);
  const [now, setNow] = useState(() => new Date());
  // biome-ignore lint/correctness/useExhaustiveDependencies: limitProviders is a fresh array each render; settings.homeLimitProviders is its source
  const home = useMemo(
    () => selectHomeModel(sessions, limits, limitsLoadState, now.getTime(), limitProviders),
    [sessions, limits, limitsLoadState, now, settings.homeLimitProviders]
  );
  const homeElement = useRef<HTMLElement>(null);
  const layoutPointer = useRef<LayoutPointerState | null>(null);
  const gridPointer = useRef<GridPointerState | null>(null);
  const layoutRef = useRef(settings.homeLayout);
  const gridRef = useRef(settings.homeGridSize);
  const [draftLayout, setDraftLayout] = useState(settings.homeLayout);
  const [draftGridSize, setDraftGridSize] = useState(settings.homeGridSize);
  layoutRef.current = draftLayout;
  gridRef.current = draftGridSize;

  useEffect(() => {
    if (!layoutPointer.current) setDraftLayout(settings.homeLayout);
  }, [settings.homeLayout]);

  useEffect(() => {
    if (!gridPointer.current) setDraftGridSize(settings.homeGridSize);
  }, [settings.homeGridSize]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const startLayoutPointer = (
    event: React.PointerEvent<HTMLButtonElement>,
    placement: HomeWidgetPlacement,
    mode: LayoutPointerState["mode"],
    direction: HomeResizeDirection | null = null
  ): void => {
    const bounds = homeElement.current?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    layoutPointer.current = {
      pointerId: event.pointerId,
      mode,
      direction,
      startClient: { x: event.clientX, y: event.clientY },
      startPlacement: placement,
      scale: {
        x: bounds.width / homeGridPixelSize(gridRef.current).width,
        y: bounds.height / homeGridPixelSize(gridRef.current).height
      }
    };
  };

  const moveLayoutPointer = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const state = layoutPointer.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const columnDelta = Math.round(
      (event.clientX - state.startClient.x) / (HOME_GRID_COLUMN_STEP * state.scale.x)
    );
    const rowDelta = Math.round(
      (event.clientY - state.startClient.y) / (HOME_GRID_ROW_STEP * state.scale.y)
    );
    const next = state.mode === "move"
      ? {
        ...state.startPlacement,
        column: state.startPlacement.column + columnDelta,
        row: state.startPlacement.row + rowDelta
      }
      : resizeHomePlacement(
        state.startPlacement,
        state.direction ?? "se",
        columnDelta,
        rowDelta
      );
    const updated = updateHomePlacement(
      layoutRef.current,
      next,
      gridRef.current,
      { allowOutside: true }
    );
    if (updated) {
      layoutRef.current = updated;
      setDraftLayout(updated);
      onLayoutChange(updated);
    }
  };

  const endLayoutPointer = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (layoutPointer.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    layoutPointer.current = null;
    onLayoutChange(layoutRef.current);
  };

  const startGridPointer = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const bounds = homeElement.current?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pixels = homeGridPixelSize(gridRef.current);
    gridPointer.current = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startGridSize: gridRef.current,
      scale: { x: bounds.width / pixels.width, y: bounds.height / pixels.height }
    };
  };

  const moveGridPointer = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const state = gridPointer.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const minimum = minimumHomeGridSize(layoutRef.current);
    const next = {
      columns: clamp(
        state.startGridSize.columns + Math.round(
          (event.clientX - state.startClient.x) / (HOME_GRID_COLUMN_STEP * state.scale.x)
        ),
        minimum.columns,
        HOME_GRID_MAX_COLUMNS
      ),
      rows: clamp(
        state.startGridSize.rows + Math.round(
          (event.clientY - state.startClient.y) / (HOME_GRID_ROW_STEP * state.scale.y)
        ),
        minimum.rows,
        HOME_GRID_MAX_ROWS
      )
    };
    gridRef.current = next;
    setDraftGridSize(next);
  };

  const endGridPointer = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (gridPointer.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    gridPointer.current = null;
    onGridSizeChange(gridRef.current);
  };

  const openPluginLauncher = (provider: ProviderId): void => {
    if (provider === "terminal") onOpenTerminal();
    else onOpenAgent(provider);
  };

  const widgetContent = (widgetId: string): React.ReactNode => {
    if (widgetId === "core.limits") {
      const noneFound = home.limitRows.length > 0 && home.limitRows.every((row) => row.reason === "cli-not-found");
      return (
        <section className="tile agent-overview limits-list" aria-label={t(locale, "modelLimits")}>
          <header className="home-tile__head">
            <span>{t(locale, "homeLimitsHead")}</span>
            {!noneFound && <span>{t(locale, "homeLimitsReset")}</span>}
          </header>
          {home.limitRows.length === 0 ? (
            <div className="home-tile__note">{t(locale, "noVisibleLimits")}</div>
          ) : noneFound ? (
            <div className="home-tile__note limits-list__missing">
              <strong><UiIcon name="info" size={14} />{t(locale, "homeCliMissing")}</strong>
              <span>{t(locale, "homeCliMissingHint")}</span>
              <InstallLink locale={locale} />
            </div>
          ) : home.limitRows.map((row) => (
            <LimitRow key={row.provider} row={row} locale={locale} now={now.getTime()} />
          ))}
        </section>
      );
    }
    if (widgetId === "core.sessions") {
      const runs = orchestration.rows(now.getTime());
      const failed = [
        sessionsLoadState === "error" ? t(locale, "actSessionsError") : null,
        orchestration.status === "error" ? t(locale, "actRunsError") : null
      ].filter((x): x is string => x !== null);
      const loading = sessionsLoadState === "loading" || orchestration.status === "loading";
      const nothing = home.sessionRows.length === 0 && runs.active.length === 0 && runs.recent.length === 0;
      return (
        <section
          className="tile usage-list"
          data-session-row-colors={settings.sessionRowColorMode}
          data-wheel-owner="local"
          data-canvas-wheel-priority="local"
          data-activity-load={failed.length ? "error" : loading ? "loading" : "ready"}
          aria-label={t(locale, "activeSessions")}
        >
          <header className="home-tile__head">
            <span>{t(locale, "homeSessionsHead")}{!nothing && ` · ${runs.active.length + home.sessionRows.length}`}</span>
            {!nothing && <span>{t(locale, "homeSessionsSort")}</span>}
          </header>
          {failed.length > 0 && (
            <div className="activity-list__error" role="alert">
              <span>{failed.join(". ")}</span>
              <button type="button" onClick={onRetryActivity}>{t(locale, "actRetry")}</button>
            </div>
          )}
          {/* "No sessions" only when every source answered and is empty; never while loading or after a failure. */}
          {nothing && !failed.length && (
            loading
              ? <div className="home-tile__note" aria-busy="true">{t(locale, "actLoading")}</div>
              : <div className="home-tile__note">{t(locale, "noActiveSessions")}</div>
          )}
          {!nothing && loading && <div className="activity-list__hint" aria-busy="true">{t(locale, "actLoading")}</div>}
          {runs.active.map((row) => (
            <RunActivityRow key={row.runId} row={row} locale={locale} onOpen={() => onOpenRun(row.linkId)} />
          ))}
          {[...home.sessionRows].sort((a, b) => SESSION_ORDER[a.status] - SESSION_ORDER[b.status]).map((session) => {
            const statusIcon = sessionStatusIcon(session.status);
            const failureDetails = session.status === "failed"
              ? session.failureDetails ?? `${t(locale, "failureOutputUnavailable")}${session.exitCode ?? "unknown"}`
              : null;
            return (
              <div className="usage-row-wrap" key={session.id}>
                <button
                  className="usage-row"
                  data-session-tone={sessionStatusTone(session.status)}
                  type="button"
                  onClick={() => onFocusSession(session)}
                  aria-label={`${session.title}, ${sessionStatusLabel(locale, session.status, session.provider)}`}
                  title={failureDetails ? undefined : session.title}
                >
                  <ProviderIcon provider={session.provider} size="small" />
                  <span className="usage-row__name">{session.title}</span>
                  {!failureDetails && (
                    <span className="usage-row__chip">
                      <UiIcon name={statusIcon ?? "status-idle"} size={14} />{sessionStatusLabel(locale, session.status, session.provider)}
                    </span>
                  )}
                </button>
                {failureDetails && (
                  <SessionFailureDetails sessionId={session.id} title={session.title} exitCode={session.exitCode} details={failureDetails} locale={locale} />
                )}
              </div>
            );
          })}
          {runs.recent.length > 0 && (
            <div className="activity-recent" data-activity-recent-list>
              <h3>{t(locale, "actRecent")}</h3>
              {runs.recent.map((row) => (
                <div className="activity-recent__row" key={row.runId} data-activity-recent={row.runId} data-run-state={row.line?.state}>
                  <button type="button" className="activity-recent__open" onClick={() => onOpenRun(row.linkId)} title={row.projectPath}>
                    <strong>{row.project}</strong>
                    <span>{row.line ? stateLabel(locale, row.line.state) : ""}{row.conditions ? ` · ${row.conditions}` : ""}{row.at ? ` · ${clockTime(locale, row.at)}` : ""}</span>
                  </button>
                  <button type="button" className="activity-recent__summary" onClick={() => onOpenRunSummary(row.linkId)}>{t(locale, "orchSummaryButton")}</button>
                </div>
              ))}
            </div>
          )}
        </section>
      );
    }
    if (widgetId === "core.clock") return <ClockWidget locale={locale} now={now} />;
    if (widgetId === "core.media") {
      return (
        <HomeMediaWidget
          locale={locale}
          dataUrl={mediaData}
          fit={settings.mediaFit}
          onRequestMedia={onRequestMedia}
          onRemoveMedia={onRemoveMedia}
        />
      );
    }
    if (widgetId === "core.launcher") {
      return (
        <section
          className="tile launcher-dock"
          style={{ "--launcher-columns": homeLauncherColumnCount(launcherProviders) } as React.CSSProperties}
        >
          <button className="launcher-button launcher-button--terminal" type="button" onClick={() => onOpenTerminal()} title={t(locale, "terminal")}>
            <ProviderIcon provider="terminal" size="small" /><span>{t(locale, "terminal")}</span>
          </button>
          <button
            className="launcher-button launcher-button--browser"
            type="button"
            onClick={onOpenBrowser}
            title={t(locale, "browser")}
            aria-label={t(locale, "browser")}
          >
            <UiIcon name="browser" size="2.2em" /><span>{t(locale, "browser")}</span>
          </button>
          {launcherProviders.map((provider) => (
            <div className="launcher-cell" key={provider}>
              <button className="launcher-button" type="button" onClick={(event) => onOpenAgent(provider, event.currentTarget.getBoundingClientRect())} title={PROVIDERS[provider].label}>
                <ProviderIcon provider={provider} size="small" /><span>{PROVIDERS[provider].label}</span>
              </button>
              <button
                className="launcher-cell__remove"
                type="button"
                aria-label={`${t(locale, "dockRemove")}: ${PROVIDERS[provider].label}`}
                title={t(locale, "dockRemove")}
                onClick={() => onSetDockProviders(launcherProviders.filter((p) => p !== provider))}
              >
                <UiIcon name="close" size={12} />
              </button>
            </div>
          ))}
          {dockCandidates.length > 0 && (
            <div className="launcher-cell">
              <button
                className="launcher-button launcher-button--add"
                type="button"
                aria-haspopup="menu"
                aria-expanded={dockMenuOpen}
                title={t(locale, "dockAdd")}
                onClick={() => setDockMenuOpen((open) => !open)}
              >
                <UiIcon name="plus" size="2.2em" /><span>{t(locale, "dockAdd")}</span>
              </button>
              {dockMenuOpen && (
                <div className="launcher-add-menu" role="menu" data-dock-add-menu>
                  {dockCandidates.map((provider) => (
                    <button
                      key={provider}
                      className="launcher-add-menu__item"
                      type="button"
                      role="menuitem"
                      onClick={() => { onSetDockProviders(AGENT_PROVIDERS.filter((p) => p === provider || launcherProviders.includes(p))); setDockMenuOpen(false); }}
                    >
                      <ProviderIcon provider={provider} size="small" />
                      <span className="launcher-add-menu__text"><span>{PROVIDERS[provider].label}</span><small>{t(locale, cliFound.includes(provider) ? "dockCliFound" : "dockCliMissing")}</small></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      );
    }
    if (widgetId === "core.settings") {
      return (
        <button className="tile settings-button" type="button" onClick={onOpenSettings} aria-label={t(locale, "settings")}>
          <UiIcon name="sliders-horizontal" size={28} /><span>{t(locale, "settings")}</span>
        </button>
      );
    }

    const match = widgetId.match(/^plugin:([^:]+):([^:]+)$/);
    const plugin = match ? plugins.find((candidate) => candidate.manifest.id === match[1] && candidate.enabled) : null;
    const contribution = plugin?.manifest.contributions.find((candidate) => (
      candidate.id === match?.[2] && candidate.kind === "home-widget"
    ));
    if (plugin && contribution) {
      const canvasWidgetId = homeCanvasWidgetId(widgetId);
      return (
        <section className="tile plugin-widget">
          <PluginFrame
            key={plugin.selectedModules.join(",")}
            plugin={plugin}
            contribution={contribution}
            locale={locale}
            palette={theme}
            sessions={sessions}
            limits={limits}
            captureCanvasWheelOverWidgets={captureCanvasWheelOverWidgets || focusedWidgetId !== canvasWidgetId}
            onCanvasWheel={onPluginCanvasWheel}
            onFocus={() => onWidgetFocus(canvasWidgetId)}
            onHoverChange={(active) => onWidgetHoverChange(canvasWidgetId, active)}
            onOpenLauncher={openPluginLauncher}
            onError={onPluginError}
          />
        </section>
      );
    }
    return editing ? <div className="tile plugin-widget plugin-widget--unavailable">{widgetId}</div> : null;
  };

  // the editor names tiles for people, never by their technical id
  const widgetTitle = (widgetId: string): string => {
    const core: Record<string, TranslationKey> = {
      "core.limits": "modelLimits", "core.sessions": "activeSessions", "core.clock": "clock",
      "core.media": "personalMedia", "core.launcher": "launcher", "core.settings": "settings"
    };
    if (core[widgetId]) return t(locale, core[widgetId]);
    const match = widgetId.match(/^plugin:([^:]+):([^:]+)$/);
    return plugins.find((plugin) => plugin.manifest.id === match?.[1])?.manifest.name ?? widgetId;
  };

  const homePixels = homeGridPixelSize(draftGridSize);
  // the panel under the tiles (mock 03/05) hugs the tiles as drawn (a dock that wraps grows, a short tile is shorter than its slot), not the grid
  const [panel, setPanel] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const zone = homeElement.current;
    if (!zone) return;
    const measure = (): void => {
      const boxes = [...zone.querySelectorAll<HTMLElement>(".home-widget-slot")].map((slot) => ({ left: slot.offsetLeft, top: slot.offsetTop, width: slot.offsetWidth, height: slot.firstElementChild instanceof HTMLElement ? Math.min(slot.offsetHeight, slot.firstElementChild.offsetHeight) : slot.offsetHeight }));
      if (boxes.length === 0) return setPanel(null);
      const left = Math.min(...boxes.map((b) => b.left)), top = Math.min(...boxes.map((b) => b.top));
      const next = { left, top, width: Math.max(...boxes.map((b) => b.left + b.width)) - left, height: Math.max(...boxes.map((b) => b.top + b.height)) - top };
      setPanel((prev) => prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height ? prev : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const el of zone.querySelectorAll(".home-widget-slot, .home-widget-slot > *")) observer.observe(el);
    return () => observer.disconnect();
  }, [draftLayout, homeElement]);

  return (
    <section
      ref={homeElement}
      className={`home-zone ${editing ? "home-zone--editing" : ""}`}
      aria-label={t(locale, "homeZone")}
      style={{
        width: homePixels.width,
        height: homePixels.height,
        gridTemplateColumns: `repeat(${draftGridSize.columns}, ${HOME_GRID_CELL_WIDTH}px)`,
        gridTemplateRows: `repeat(${draftGridSize.rows}, ${HOME_GRID_CELL_HEIGHT}px)`
      }}
    >
      {!editing && panel && (
        <>
          <span className="home-zone__panel" style={{ left: panel.left - 16, top: panel.top - 16, width: panel.width + 32, height: panel.height + 32 }} aria-hidden="true" />
          <span className="home-zone__label" style={{ left: panel.left - 16, top: panel.top - 16 - 30 }} aria-hidden="true">HOME</span>
        </>
      )}
      {editing && (
        <>
          <span className="home-zone__boundary-label">
            {t(locale, "homeBoundary")} · {draftGridSize.columns} × {draftGridSize.rows}
          </span>
          <button
            className="home-zone__boundary-resize"
            type="button"
            data-interactive="true"
            aria-label={t(locale, "resizeHomeBoundary")}
            title={t(locale, "resizeHomeBoundary")}
            onPointerDown={startGridPointer}
            onPointerMove={moveGridPointer}
            onPointerUp={endGridPointer}
            onPointerCancel={endGridPointer}
          />
        </>
      )}
      {draftLayout.map((placement) => {
        const content = widgetContent(placement.widgetId);
        if (!content) return null;
        return (
          <div
            className={`home-widget-slot ${isInsideHome(placement, draftGridSize) ? "" : "home-widget-slot--outside"}`}
            data-interactive="true"
            data-canvas-widget-id={homeCanvasWidgetId(placement.widgetId)}
            data-canvas-widget-focusable={isFocusableHomeWidget(placement.widgetId, plugins) ? "true" : undefined}
            key={placement.widgetId}
            style={{
              left: placement.column * HOME_GRID_COLUMN_STEP,
              top: placement.row * HOME_GRID_ROW_STEP,
              width: placement.columnSpan * HOME_GRID_COLUMN_STEP - HOME_GRID_GAP,
              height: placement.rowSpan * HOME_GRID_ROW_STEP - HOME_GRID_GAP
            }}
          >
            {content}
            {editing && (
              <>
                <button
                  className="home-widget-slot__move"
                  type="button"
                  onPointerDown={(event) => startLayoutPointer(event, placement, "move")}
                  onPointerMove={moveLayoutPointer}
                  onPointerUp={endLayoutPointer}
                  onPointerCancel={endLayoutPointer}
                >{widgetTitle(placement.widgetId)}</button>
                {HOME_RESIZE_DIRECTIONS.map((direction) => (
                  <button
                    className={`home-widget-slot__resize home-widget-slot__resize--${direction}`}
                    type="button"
                    key={direction}
                    aria-label={`${t(locale, "resizeHomeWidget")}: ${widgetTitle(placement.widgetId)}`}
                    onPointerDown={(event) => startLayoutPointer(event, placement, "resize", direction)}
                    onPointerMove={moveLayoutPointer}
                    onPointerUp={endLayoutPointer}
                    onPointerCancel={endLayoutPointer}
                  />
                ))}
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

const RUN_TONE: Record<ActivityState, "working" | "waiting" | "idle"> = {
  starting: "working", working: "working", checking: "working", waiting_agent: "working", waiting_user: "waiting",
  paused: "waiting", stopping: "idle", completed: "idle", completed_no_checks: "idle", stopped: "idle", failed: "idle", read_only: "idle"
};
const RUN_ICON: Partial<Record<ActivityState, "working" | "attention" | "bell" | "error" | "done">> = {
  starting: "working", working: "working", checking: "working", waiting_user: "bell", failed: "error", completed: "done",
  completed_no_checks: "attention" // a warning, never the done mark: no check ran
};
const clockTime = (locale: LocaleId, iso: string): string =>
  new Date(iso).toLocaleTimeString(locale === "ru" ? "ru-RU" : "en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// One orchestration run: who works on what in which project, why it waits; the participants fold out inside the row.
// Opening it shows the existing run; nothing is started.
function RunActivityRow({ row, locale, onOpen }: { row: ActivityRunRow; locale: LocaleId; onOpen(): void }): React.JSX.Element {
  const line = row.line;
  const kind = <em className="activity-kind activity-kind--run">{t(locale, "actOrchestration")}</em>;
  if (!line) {
    return (
      <div className="usage-row-wrap activity-run" data-activity-run={row.runId} data-run-state={row.load}>
        <button className="usage-row" type="button" onClick={onOpen} title={row.projectPath}>
          <UiIcon name={row.load === "error" ? "error" : "working"} size={24} />
          <span className="usage-row__copy">
            <strong>{row.project}</strong>
            <span>{kind} {t(locale, row.load === "error" ? "actRunError" : "actLoading")}</span>
          </span>
        </button>
      </div>
    );
  }
  const icon = RUN_ICON[line.state];
  const extra = line.wait ?? line.now;
  const last = line.lastEventAt ? t(locale, "orchNow_lastEvent").replace("{time}", clockTime(locale, line.lastEventAt)) : null;
  const details = [line.doing, extra, row.conditions, row.findings, line.quiet ?? last].filter(Boolean).join(" · ");
  // one 30px row as in mock 05: mark, project, status; the rest is in the tooltip (and kept in the row for readers)
  return (
    <div className="usage-row-wrap activity-run" data-activity-run={row.runId} data-run-state={line.state}>
      <button className="usage-row activity-run__main" type="button" data-session-tone={RUN_TONE[line.state]} onClick={onOpen}
        aria-label={`${row.project}, ${stateLabel(locale, line.state)}: ${line.doing}`} title={`${row.projectPath}\n${details}`}>
        {line.actor === "lead" || line.actor === "executor" || line.actor === "reviewer"
          ? <ProviderIcon provider={line.actor === "executor" ? "claude" : "codex"} size="small" />
          : <UiIcon name="blocks" size={20} />}
        <span className="usage-row__name">{row.project}</span>
        <span className="usage-row__chip">
          <UiIcon name={icon ?? "status-idle"} size={14} />{stateLabel(locale, line.state)}
        </span>
        <span className="activity-run__detail">
          {kind} <span>{line.doing}</span>
          {extra && <span data-activity-extra>{extra}</span>}
          {row.conditions && <span data-activity-conditions>{row.conditions}</span>}
          {row.findings && <span data-activity-findings>{row.findings}</span>}
          {(line.quiet || last) && <span>{line.quiet ?? last}</span>}
        </span>
      </button>
      <details className="activity-run__people">
        <summary>{t(locale, "actParticipants")}</summary>
        <ul>
          {row.roles.map(({ role, line: r }) => (
            <li key={role} data-activity-role={role} data-run-state={r.state}>
              <b>{role === "executor" ? "Claude" : "Codex"}{role === "reviewer" ? ` · ${t(locale, "orchRoleReviewer")}` : ""}</b> · {stateLabel(locale, r.state)} — {r.doing}{r.wait ? ` (${r.wait})` : ""}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function isFocusableHomeWidget(widgetId: string, plugins: readonly InstalledPlugin[]): boolean {
  if (widgetId === "core.sessions") return true;
  if (!widgetId.startsWith("plugin:")) return false;
  const [, pluginId, contributionId] = widgetId.split(":");
  return plugins.some((plugin) => plugin.enabled
    && plugin.manifest.id === pluginId
    && plugin.manifest.contributions.some((contribution) => (
      contribution.id === contributionId && contribution.kind === "home-widget"
    )));
}

function ClockWidget({ locale, now }: { locale: LocaleId; now: Date }): React.JSX.Element {
  const formatLocale = locale === "ru" ? "ru-RU" : "en-GB";
  const time = now.toLocaleTimeString(formatLocale, { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString(formatLocale, { weekday: "long", day: "numeric", month: "long" });

  return (
    <section className="tile clock-tile">
      <time className="clock-tile__time">{time}</time>
      <span className="clock-tile__date">{date}</span>
    </section>
  );
}

function LimitRow({ row, locale, now }: { row: HomeLimitRow; locale: LocaleId; now: number }): React.JSX.Element {
  const providerLabel = PROVIDERS[row.provider].limitsLabel ?? PROVIDERS[row.provider].label;
  const meta = limitMeta(row, locale);
  const stateLabel = row.state === "loading"
    ? t(locale, "limitLoading")
    : row.state === "error"
      ? t(locale, "limitError")
      : row.state === "stale"
        ? t(locale, "limitStale")
        : row.state === "available"
          ? null
          : limitReasonLabel(row.reason, locale);
  const accessibleLabel = [
    providerLabel,
    meta,
    stateLabel !== meta ? stateLabel : null
  ]
    .filter(Boolean)
    .join(", ");

  const staleNote = row.state === "stale" || row.state === "error";
  return (
    <article className={`limit-row limit-row--${row.state}`} aria-label={accessibleLabel} title={accessibleLabel}>
      <ProviderIcon provider={row.provider} size="small" />
      <span className="limit-row__name">{providerLabel}</span>
      {row.window ? (
        <>
          <span className="limit-row__value">{formatResetCountdown(row.window.resetsAt, now, locale)}</span>
          <span className="limit-row__track" aria-hidden="true">
            <i className="limit-row__fill" style={{ width: `${row.window.usedPercent}%` }} />
          </span>
          {staleNote && <span className="limit-row__note">{stateLabel}</span>}
        </>
      ) : <span className="limit-row__value">{stateLabel}</span>}
    </article>
  );
}

function InstallLink({ locale }: { locale: LocaleId }): React.JSX.Element {
  // The repository's own getting-started page; the docs name no per-CLI install commands.
  const page = locale === "ru" ? "getting-started.ru.md" : "getting-started.md";
  return (
    <button type="button" className="home-tile__link"
      onClick={() => void window.canvasTTY.external.openUrl(`https://github.com/dontpanicops/raoden-loom/blob/main/docs/${page}`)}>
      {t(locale, "howToInstall")}
    </button>
  );
}

function limitMeta(row: HomeLimitRow, locale: LocaleId): string {
  if (row.state === "loading") return t(locale, "limitLoading");
  if (row.state === "error") return t(locale, "limitError");
  if (!row.window) return limitReasonLabel(row.reason, locale);

  const details = [
    formatLimitDuration(row.window.windowMinutes, locale),
    `${formatPercent(row.window.usedPercent, locale)} ${t(locale, "limitUsed")}`,
    formatReset(row.window.resetsAt, locale)
  ];
  if (row.state === "stale") {
    details.push(limitReasonLabel(row.reason, locale));
  }
  return details.filter(Boolean).join(" · ");
}

function formatReset(resetsAt: number, locale: LocaleId): string {
  const formatLocale = locale === "ru" ? "ru-RU" : "en-GB";
  const formatted = new Intl.DateTimeFormat(formatLocale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(resetsAt);
  return `${t(locale, "limitResetsAt")} ${formatted}`;
}

function formatPercent(value: number, locale: LocaleId): string {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-GB", {
    maximumFractionDigits: 1
  }).format(value) + "%";
}

function limitReasonLabel(reason: HomeLimitReason | null, locale: LocaleId): string {
  const key = reason === "cli-not-found"
    ? "limitCliNotFound"
    : reason === "not-authenticated"
      ? "limitNotAuthenticated"
      : reason === "subscription-required"
        ? "limitSubscriptionRequired"
      : reason === "unsupported-protocol"
        ? "limitUnsupported"
        : reason === "timeout"
          ? "limitTimeout"
          : reason === "protocol-error"
            ? "limitProtocolError"
            : reason === "percentage-unavailable"
              ? "limitPercentageUnavailable"
              : reason === "reset-unavailable"
                ? "limitResetUnavailable"
              : reason === "refresh-error"
                ? "limitRefreshError"
                : "limitUnavailable";
  return t(locale, key);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
