import { useEffect, useRef, useState } from "react";
import type {
  CanvasLauncherItemId,
  CanvasMenuStyle,
  LocaleId,
  Point,
  ProviderId
} from "../../../../shared/contracts";
import { AppMark } from "../../components/AppMark";
import { ProviderIcon } from "../../components/ProviderIcon";
import { t } from "../../lib/i18n";
import { orchestrationAvailableHere, orchestrationEntry } from "../orchestration/runModel";
import { PROVIDERS } from "../../lib/providers";
import {
  CanvasMenuChevron,
  CanvasMenuDivider,
  CanvasMenuIcon,
  CanvasMenuKbd,
  CanvasMenuRow
} from "../../components/CanvasMenuPrimitives";
import {
  chooseCanvasSubmenuSide,
  type CanvasContextMenuKind,
  type CanvasSubmenuSide
} from "./canvasContextRouting";
import { CANVAS_REGION_COLORS } from "./canvasRegions";

interface CanvasContextMenuProps {
  kind: CanvasContextMenuKind;
  position: Point;
  locale: LocaleId;
  launcherItems: readonly CanvasLauncherItemId[];
  menuStyle: CanvasMenuStyle;
  currentRegionColor: string | null;
  onCreateRegion(): void;
  onCreateNote(): void;
  onLaunch(provider: ProviderId): void;
  onOpenBrowser(): void;
  onCreateOrchestrationAgent(provider: "codex" | "claude"): void;
  onOpenSettings(): void;
  onRenameRegion(): void;
  onChangeRegionColor(color: string): void;
  onDeleteRegion(): void;
  onEditNote(): void;
  onBringNoteToFront(): void;
  onDeleteNote(): void;
  onMoveToWorkspace(): void;
  onClose(): void;
}

export function CanvasContextMenu({
  kind,
  position,
  locale,
  launcherItems,
  menuStyle,
  currentRegionColor,
  onCreateRegion,
  onCreateNote,
  onLaunch,
  onOpenBrowser,
  onCreateOrchestrationAgent,
  onOpenSettings,
  onRenameRegion,
  onChangeRegionColor,
  onDeleteRegion,
  onEditNote,
  onBringNoteToFront,
  onDeleteNote,
  onMoveToWorkspace,
  onClose
}: CanvasContextMenuProps): React.JSX.Element {
  const menu = useRef<HTMLDivElement>(null);
  const orchestration = orchestrationEntry(orchestrationAvailableHere());
  // mock 22: the role of the agent, in the secondary tone at the right
  const roleHint = (provider: "codex" | "claude"): React.JSX.Element => <span className="canvas-menu__kbd canvas-menu__role">{t(locale, provider === "codex" ? "ctxRoleLead" : "ctxRoleExecutor")}</span>;
  const [submenu, setSubmenu] = useState<"launch" | "agent" | null>(null);
  const [submenuSide, setSubmenuSide] = useState<CanvasSubmenuSide>("right");

  // biome-ignore lint/correctness/useExhaustiveDependencies: kind is the trigger: focus the first row when the menu changes
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>(".canvas-menu__row")?.focus({ preventScroll: true });
  }, [kind]);

  const toggleSubmenu = (which: "launch" | "agent"): void => {
    if (submenu === which) {
      setSubmenu(null);
      return;
    }
    const root = menu.current;
    const workspace = root?.closest<HTMLElement>(".workspace");
    if (root && workspace) {
      const fontSize = Number.parseFloat(window.getComputedStyle(root).fontSize) || 13;
      setSubmenuSide(chooseCanvasSubmenuSide(
        root.getBoundingClientRect(),
        workspace.getBoundingClientRect(),
        15.5 * fontSize,
        .55 * fontSize
      ));
    }
    setSubmenu(which);
  };

  return (
    <div
      ref={menu}
      className="canvas-menu"
      data-interactive="true"
      role="menu"
      aria-label={t(locale, "canvasContextMenu")}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        moveMenuFocus(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
      }}
    >
      {kind === "empty" && (
        <>
          <CanvasMenuRow icon="maximize" role="menuitem" onClick={onCreateRegion}>{t(locale, "ctxRegion")}</CanvasMenuRow>
          <CanvasMenuRow icon="sticky-note" role="menuitem" onClick={onCreateNote}>{t(locale, "ctxNote")}</CanvasMenuRow>
          <div className="canvas-menu__submenu-anchor">
            <CanvasMenuRow
              icon="terminal"
              right={<CanvasMenuChevron />}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={submenu === "launch"}
              onClick={() => toggleSubmenu("launch")}
            >{t(locale, "canvasMenuLaunch")}</CanvasMenuRow>
            {submenu === "launch" && (
              <div className={`canvas-menu canvas-menu__submenu canvas-menu__submenu--${submenuSide}`} role="menu">
                {launcherItems.map((provider) => (
                  provider === "terminal" ? (
                    <CanvasMenuRow icon="terminal" indent right={window.canvasTTY.window.isMacOS ? <CanvasMenuKbd>⌘T</CanvasMenuKbd> : undefined} role="menuitem" key={provider} onClick={() => onLaunch(provider)}>{PROVIDERS[provider].label}</CanvasMenuRow>
                  ) : (
                    <CanvasMenuRow indent role="menuitem" key={provider} onClick={() => onLaunch(provider)}>
                      <span className="canvas-menu__provider">
                        <ProviderIcon provider={provider} size="small" />
                        {PROVIDERS[provider].label}
                      </span>
                    </CanvasMenuRow>
                  )
                ))}
                <CanvasMenuDivider />
                <CanvasMenuRow muted indent role="menuitem" onClick={onOpenSettings}>{t(locale, "ctxConfigureList")}</CanvasMenuRow>
              </div>
            )}
          </div>
          {menuStyle === "mock" ? (
          <div className="canvas-menu__submenu-anchor">
            <CanvasMenuRow
              iconNode={<AppMark size={16} />}
              right={<CanvasMenuChevron />}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={submenu === "agent"}
              disabled={orchestration.disabled}
              title={orchestration.hint ? t(locale, orchestration.hint) : undefined}
              onClick={() => toggleSubmenu("agent")}
            >{t(locale, "ctxOrchestrationAgent")}</CanvasMenuRow>
            {submenu === "agent" && (
              <div className={`canvas-menu canvas-menu__submenu canvas-menu__submenu--${submenuSide}`} role="menu">
                {(["codex", "claude"] as const).map((provider) => (
                  <CanvasMenuRow indent role="menuitem" key={provider} right={roleHint(provider)} onClick={() => onCreateOrchestrationAgent(provider)}>
                    <span className="canvas-menu__provider">
                      <ProviderIcon provider={provider} size="small" />
                      {PROVIDERS[provider].label}
                    </span>
                  </CanvasMenuRow>
                ))}
              </div>
            )}
          </div>
          ) : (["codex", "claude"] as const).map((provider) => (
            <CanvasMenuRow icon="plus" role="menuitem" key={provider} right={roleHint(provider)} disabled={orchestration.disabled} title={orchestration.hint ? t(locale, orchestration.hint) : undefined}
              onClick={() => onCreateOrchestrationAgent(provider)}>
              {t(locale, provider === "codex" ? "ctxAgentCodex" : "ctxAgentClaude")}
            </CanvasMenuRow>
          ))}
          <CanvasMenuRow icon="browser" role="menuitem" onClick={onOpenBrowser}>
            {t(locale, "ctxBrowser")}
          </CanvasMenuRow>
          <CanvasMenuDivider />
          <CanvasMenuRow
            icon="settings"
            muted
            right={<CanvasMenuKbd>{window.canvasTTY.window.isMacOS ? "⌘," : "Ctrl+,"}</CanvasMenuKbd>}
            role="menuitem"
            onClick={onOpenSettings}
          >{t(locale, "settings")}</CanvasMenuRow>
        </>
      )}

      {kind === "region" && (
        <>
          <CanvasMenuRow
            icon="pencil"
            role="menuitem"
            onClick={onRenameRegion}
          >{t(locale, "canvasMenuRenameRegion")}</CanvasMenuRow>
          <div className="canvas-menu__row canvas-menu__color-title" aria-hidden="true">
            <CanvasMenuIcon icon="palette" />
            <span className="canvas-menu__grow">{t(locale, "canvasMenuColor")}</span>
          </div>
          <div className="canvas-menu__swatches" role="group" aria-label={t(locale, "canvasRegionColor")}>
            {/* mock 18: five colors; the region's own color stays among them when it is one of the rest */}
            {[...CANVAS_REGION_COLORS.slice(0, 5), ...(currentRegionColor && !CANVAS_REGION_COLORS.slice(0, 5).some((c) => c === currentRegionColor) ? [currentRegionColor] : [])].map((color) => (
              <button
                className={`canvas-menu__swatch ${color === currentRegionColor ? "canvas-menu__swatch--selected" : ""}`}
                type="button"
                role="menuitemradio"
                key={color}
                style={{ background: color }}
                aria-label={`${t(locale, "canvasRegionColor")} ${color}`}
                aria-checked={color === currentRegionColor}
                onClick={() => onChangeRegionColor(color)}
              />
            ))}
          </div>
          <CanvasMenuRow icon="sticky-note" role="menuitem" onClick={onCreateNote}>
            {t(locale, "canvasMenuNoteInRegion")}
          </CanvasMenuRow>
          <CanvasMenuRow icon="maximize" role="menuitem" data-ws-move-menu onClick={onMoveToWorkspace}>
            {t(locale, "wsMoveToWorkspace")}
          </CanvasMenuRow>
          <CanvasMenuDivider />
          <CanvasMenuRow icon="trash" danger role="menuitem" onClick={onDeleteRegion}>
            {t(locale, "canvasMenuDeleteRegion")}
          </CanvasMenuRow>
          <div className="canvas-menu__note">{t(locale, "canvasMenuRegionContentsStay")}</div>
        </>
      )}

      {kind === "note" && (
        <>
          <CanvasMenuRow
            icon="pencil"
            right={<CanvasMenuKbd>↵</CanvasMenuKbd>}
            role="menuitem"
            onClick={onEditNote}
          >{t(locale, "editStickyNote")}</CanvasMenuRow>
          <CanvasMenuRow icon="bring-to-front" role="menuitem" onClick={onBringNoteToFront}>
            {t(locale, "canvasMenuBringToFront")}
          </CanvasMenuRow>
          <CanvasMenuRow icon="maximize" role="menuitem" data-ws-move-menu onClick={onMoveToWorkspace}>
            {t(locale, "wsMoveToWorkspace")}
          </CanvasMenuRow>
          <CanvasMenuDivider />
          <CanvasMenuRow icon="trash" danger role="menuitem" onClick={onDeleteNote}>
            {t(locale, "deleteStickyNote")}
          </CanvasMenuRow>
        </>
      )}

      {kind === "card" && (
        <CanvasMenuRow icon="maximize" role="menuitem" data-ws-move-menu onClick={onMoveToWorkspace}>
          {t(locale, "wsMoveToWorkspace")}
        </CanvasMenuRow>
      )}
    </div>
  );
}

function moveMenuFocus(menu: HTMLElement, direction: 1 | -1): void {
  const rows = [...menu.querySelectorAll<HTMLButtonElement>(".canvas-menu__row:not(:disabled)")];
  if (rows.length === 0) return;
  const current = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next = current < 0 ? 0 : (current + direction + rows.length) % rows.length;
  rows[next]?.focus({ preventScroll: true });
}
