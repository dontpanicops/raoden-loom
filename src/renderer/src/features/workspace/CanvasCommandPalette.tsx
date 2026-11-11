import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CanvasLauncherItemId,
  LocaleId,
  ProviderId,
  SessionSnapshot
} from "../../../../shared/contracts";
import { ProviderIcon } from "../../components/ProviderIcon";
import { UiIcon, type UiIconName } from "../../components/UiIcon";
import { t } from "../../lib/i18n";
import { orchestrationAvailableHere, orchestrationEntry } from "../orchestration/runModel";
import { PROVIDERS } from "../../lib/providers";
import {
  CanvasMenuDivider,
  CanvasMenuKbd,
  CanvasMenuLabel,
  CanvasMenuRow,
  CanvasMenuSub
} from "../../components/CanvasMenuPrimitives";

interface CanvasCommandPaletteProps {
  locale: LocaleId;
  sessions: readonly SessionSnapshot[];
  launcherItems: readonly CanvasLauncherItemId[];
  onFocusSession(session: SessionSnapshot): void;
  onLaunch(provider: ProviderId): void;
  onCreateRegion(): void;
  onCreateNote(): void;
  onCreateOrchestrationAgent(provider: "codex" | "claude"): void;
  onOpenBrowser(): void;
  onOpenSettings(): void;
  onGoHome(): void;
  homeShortcut: string;
  // "Getting started" (mock 10): brings the first-run card back; D-016
  onShowGettingStarted(): void;
  // Project workspaces: one command per open workspace, in the switcher's order (⌘1…⌘9 on macOS).
  workspaces?: readonly { id: string; title: string }[];
  onSwitchWorkspace?(id: string): void;
  onClose(): void;
}

type CommandItem = {
  id: string;
  group: "waiting" | "sessions" | "actions";
  kind: "session" | "provider" | "action";
  label: string;
  searchDetail: string;
  icon?: UiIconName;
  provider?: ProviderId;
  status?: SessionSnapshot["status"];
  shortcut?: string;
  disabledHint?: string; // shown, not run (orchestration where it is unavailable)
  run(): void;
};

// the chip next to a session in the palette (mock 10); a quiet session has none
const STATUS_CHIP: Partial<Record<SessionSnapshot["status"], { tone: "working" | "failed" | "done"; label: "statusWorking" | "statusFailed" | "statusDone" }>> = {
  working: { tone: "working", label: "statusWorking" },
  failed: { tone: "failed", label: "statusFailed" },
  done: { tone: "done", label: "statusDone" }
};

export function CanvasCommandPalette({
  locale,
  sessions,
  launcherItems,
  onFocusSession,
  onLaunch,
  onCreateRegion,
  onCreateNote,
  onCreateOrchestrationAgent,
  onOpenBrowser,
  onOpenSettings,
  onGoHome,
  homeShortcut,
  onShowGettingStarted,
  workspaces = [],
  onSwitchWorkspace,
  onClose
}: CanvasCommandPaletteProps): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const commands = useMemo<CommandItem[]>(() => [
    ...sessions.map((session) => ({
      id: `session:${session.id}`,
      group: session.status === "needs_approval" ? "waiting" as const : "sessions" as const,
      kind: "session" as const,
      label: session.title,
      searchDetail: PROVIDERS[session.provider].label,
      provider: session.provider,
      status: session.status,
      run: () => onFocusSession(session)
    })),
    ...workspaces.map((w, i) => ({
      id: `workspace:${w.id}`,
      group: "actions" as const,
      kind: "action" as const,
      label: `${t(locale, "wsPaletteSwitch")}: ${w.title}`,
      searchDetail: t(locale, "wsBar"),
      icon: "blocks" as const,
      ...(window.canvasTTY.window.isMacOS && i < 9 ? { shortcut: `⌘${i + 1}` } : {}),
      run: () => onSwitchWorkspace?.(w.id)
    })),
    {
      id: "create:region",
      group: "actions",
      kind: "action",
      label: t(locale, "canvasMenuCreateRegion"),
      searchDetail: t(locale, "canvasMenuActions"),
      icon: "maximize",
      run: onCreateRegion
    },
    {
      id: "create:note",
      group: "actions",
      kind: "action",
      label: t(locale, "newStickyNote"),
      searchDetail: t(locale, "canvasMenuActions"),
      icon: "sticky-note",
      run: onCreateNote
    },
    ...launcherItems.map((provider) => ({
      id: `launch:${provider}`,
      group: "actions" as const,
      kind: "provider" as const,
      label: provider === "terminal"
        ? t(locale, "paletteNewTerminal")
        : `${t(locale, "canvasMenuLaunchAgent")} · ${PROVIDERS[provider].label}`,
      searchDetail: `${t(locale, "canvasMenuLaunchAgent")} ${PROVIDERS[provider].label}`,
      provider,
      run: () => onLaunch(provider)
    })),
    ...(["codex", "claude"] as const).map((provider) => ({
      id: `agent:${provider}`,
      group: "actions" as const,
      kind: "action" as const,
      label: t(locale, provider === "codex" ? "orchAgentCodex" : "orchAgentClaude"),
      searchDetail: `${t(locale, "canvasMenuActions")} agent ${provider}`,
      icon: "plus" as const,
      disabledHint: (({ hint }) => (hint ? t(locale, hint) : undefined))(orchestrationEntry(orchestrationAvailableHere())),
      run: () => onCreateOrchestrationAgent(provider)
    })),
    {
      id: "open:browser",
      group: "actions",
      kind: "action",
      label: t(locale, "canvasMenuOpenBrowser"),
      searchDetail: t(locale, "canvasMenuActions"),
      icon: "browser",
      run: onOpenBrowser
    },
    {
      id: "go:home",
      group: "actions",
      kind: "action",
      label: t(locale, "paletteGoHome"),
      searchDetail: t(locale, "canvasMenuActions"),
      icon: "home",
      shortcut: homeShortcut,
      run: onGoHome
    },
    {
      id: "open:getting-started",
      group: "actions",
      kind: "action",
      label: t(locale, "paletteGettingStarted"),
      searchDetail: t(locale, "canvasMenuActions"),
      icon: "info",
      run: onShowGettingStarted
    },
    {
      id: "open:settings",
      group: "actions",
      kind: "action",
      label: t(locale, "settings"),
      searchDetail: t(locale, "canvasMenuActions"),
      icon: "settings",
      shortcut: window.canvasTTY.window.isMacOS ? "⌘," : "Ctrl+,",
      run: onOpenSettings
    }
  ], [homeShortcut, launcherItems, locale, onCreateNote, onCreateOrchestrationAgent, onCreateRegion, onFocusSession, onGoHome, onLaunch, onOpenBrowser, onOpenSettings, onShowGettingStarted, onSwitchWorkspace, sessions, workspaces]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    // the arrow keys walk the rows in the order they are shown: waiting, sessions, actions
    const rank = { waiting: 0, sessions: 1, actions: 2 } as const;
    const shown = [...commands].sort((a, b) => rank[a.group] - rank[b.group]);
    if (!normalized) return shown;
    return shown.filter((command) => (
      `${command.label} ${command.searchDetail}`.toLocaleLowerCase(locale).includes(normalized)
    ));
  }, [commands, locale, query]);
  const selectedIndex = Math.min(selected, Math.max(0, filtered.length - 1));
  const waitingCommands = filtered.filter((command) => command.group === "waiting");
  const sessionCommands = filtered.filter((command) => command.group === "sessions");
  const actionCommands = filtered.filter((command) => command.group === "actions");

  useEffect(() => input.current?.focus({ preventScroll: true }), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: query is the trigger: back to the first row on each edit
  useEffect(() => setSelected(0), [query]);

  const run = (command: CommandItem | undefined): void => {
    if (!command || command.disabledHint) return;
    command.run();
    onClose();
  };

  const renderCommand = (command: CommandItem): React.JSX.Element => {
    const index = filtered.indexOf(command);
    const selectedRow = index === selectedIndex;
    const sharedProps = {
      role: "option" as const,
      "aria-selected": selectedRow,
      selected: selectedRow,
      onPointerMove: () => setSelected(index),
      onClick: () => run(command)
    };

    if (command.kind === "session" && command.provider) {
      const waiting = command.group === "waiting";
      const chip = !waiting && command.status ? STATUS_CHIP[command.status] : undefined;
      return (
        <CanvasMenuRow
          {...sharedProps}
          indent
          right={waiting
            ? <CanvasMenuKbd>↵</CanvasMenuKbd>
            : chip && <span className={`canvas-palette__chip canvas-palette__chip--${chip.tone}`}>{t(locale, chip.label)}</span>}
          key={command.id}
        >
          <span className="canvas-menu__provider">
            <ProviderIcon provider={command.provider} size="small" />
            {command.label}
            {waiting && <span className="canvas-palette__detail">{PROVIDERS[command.provider].label} · {t(locale, "statusNeedsApproval")}</span>}
          </span>
        </CanvasMenuRow>
      );
    }

    if (command.kind === "provider" && command.provider) {
      return (
        <CanvasMenuRow
          {...sharedProps}
          indent
          muted={command.provider === "terminal"}
          right={command.provider === "terminal"
            ? undefined
            : <CanvasMenuSub>{t(locale, "normal").toLocaleLowerCase(locale)}</CanvasMenuSub>}
          key={command.id}
        >
          <span className="canvas-menu__provider">
            <ProviderIcon provider={command.provider} size="small" />
            {command.label}
          </span>
        </CanvasMenuRow>
      );
    }

    return (
      <CanvasMenuRow
        {...sharedProps}
        icon={command.icon}
        muted
        disabled={command.disabledHint !== undefined}
        title={command.disabledHint}
        right={command.shortcut ? <CanvasMenuKbd>{command.shortcut}</CanvasMenuKbd> : undefined}
        key={command.id}
      >{command.label}</CanvasMenuRow>
    );
  };

  return (
    <div
      className="canvas-command-palette__backdrop"
      data-interactive="true"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="canvas-menu canvas-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, "commandPalette")}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelected((current) => filtered.length === 0 ? 0 : (current + 1) % filtered.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelected((current) => filtered.length === 0 ? 0 : (current - 1 + filtered.length) % filtered.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            run(filtered[selectedIndex]);
          }
        }}
      >
        <label className="canvas-command-palette__search">
          <UiIcon name="search" size="1em" />
          <input
            ref={input}
            value={query}
            placeholder={t(locale, "commandPalettePlaceholder")}
            aria-label={t(locale, "commandPalettePlaceholder")}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <kbd className="canvas-palette__esc">esc</kbd>
        </label>
        <div className="canvas-command-palette__results" role="listbox">
          {filtered.length === 0 && (
            <p className="canvas-command-palette__empty">{t(locale, "commandPaletteEmpty")}</p>
          )}
          {waitingCommands.length > 0 && (
            <>
              <CanvasMenuLabel>{t(locale, "canvasMenuWaiting")}</CanvasMenuLabel>
              {waitingCommands.map(renderCommand)}
            </>
          )}
          {sessionCommands.length > 0 && (
            <>
              <CanvasMenuLabel>{t(locale, "canvasMenuSessions")}</CanvasMenuLabel>
              {sessionCommands.map(renderCommand)}
            </>
          )}
          {(waitingCommands.length > 0 || sessionCommands.length > 0) && actionCommands.length > 0 && <CanvasMenuDivider />}
          {actionCommands.length > 0 && (
            <>
              <CanvasMenuLabel>{t(locale, "canvasMenuActions")}</CanvasMenuLabel>
              {actionCommands.map(renderCommand)}
            </>
          )}
        </div>
        <footer className="canvas-command-palette__footer">
          <span>{t(locale, "paletteFooterChoose")}</span>
          <span>{t(locale, "paletteFooterOpen")}</span>
        </footer>
      </section>
    </div>
  );
}
