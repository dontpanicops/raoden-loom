import type { LocaleId, WindowState } from "../../../shared/contracts";
import { AppMark } from "./AppMark";
import { UiIcon } from "./UiIcon";
import { t } from "../lib/i18n";

// The canvas owns the command palette; the button asks it to open (WorkspaceCanvas listens).
export const OPEN_PALETTE_EVENT = "loom:open-palette";

interface TitleBarProps {
  locale: LocaleId;
  windowState: WindowState;
  onWindowStateChange(state: WindowState): void;
}

export function TitleBar({ locale, windowState, onWindowStateChange }: TitleBarProps): React.JSX.Element | null {
  const toggleMaximize = async (): Promise<void> => {
    const state = await window.canvasTTY.window.toggleMaximize();
    onWindowStateChange(state);
  };

  if (windowState.isMacOS && windowState.fullscreen) return null;

  const controls = (
    <div className="titlebar__controls">
      <button type="button" onClick={() => window.canvasTTY.window.minimize()} aria-label="Minimize"><UiIcon name="minimize" size={17} /></button>
      <button type="button" onClick={() => void toggleMaximize()} aria-label="Maximize">
        <UiIcon name={windowState.maximized ? "restore" : "maximize"} size={16} />
      </button>
      <button className="titlebar__close" type="button" onClick={() => window.canvasTTY.window.close()} aria-label="Close"><UiIcon name="close" size={18} /></button>
    </div>
  );

  const palette = (
    <button className="titlebar__palette" type="button" onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}>
      <UiIcon name="search" size={14} />
      <span>{t(locale, "paletteButton")}</span>
      <kbd>{windowState.isMacOS ? "\u2318K" : "Ctrl+K"}</kbd>
    </button>
  );

  if (windowState.isMacOS) {
    return (
      <header className="titlebar titlebar--macos surface-3">
        <div className="titlebar__macos-controls-space" aria-hidden="true" />
        <div className="titlebar__brand">
          <span className="titlebar__logo"><AppMark /></span>
          <strong>Raoden Loom</strong>
        </div>
        <div className="titlebar__drag" />
        {palette}
      </header>
    );
  }

  return (
    <header className="titlebar surface-3">
      <div className="titlebar__brand">
        <span className="titlebar__logo"><AppMark /></span>
        <strong>Raoden Loom</strong>
      </div>
      <div className="titlebar__drag" />
      {palette}
      {controls}
    </header>
  );
}
