import { EvenG2Controls } from "./EvenG2Controls";
import { NOTIFY_UNAVAILABLE_KEY } from "../orchestration/notify";
import { useEffect, useState } from "react";
import type {
  AgentProviderId,
  AppSettings,
  NotificationSettings,
  BrowserActivityEvent,
  BrowserCommandType,
  BrowserDownloadSnapshot,
  BrowserSnapshot,
  CanvasLauncherItemId,
  CanvasColorId,
  CanvasOverlayPlacement,
  CanvasMenuStyle,
  CanvasPatternId,
  CanvasWheelCaptureMode,
  EdgePanSpeed,
  FocusActivation,
  GithubPluginSearchResult,
  HomeAccentColors,
  HomeAccentPresetId,
  InstalledPlugin,
  LimitProviderId,
  LocaleId,
  MinimapInteractionMode,
  PaletteId,
  PluginContribution,
  PluginGridSize,
  PluginManifest,
  PluginInstallPreview,
  PluginUpdateStatus,
  RadialLauncherItemId,
  SessionRowColorMode,
  ShortcutAction,
  ZoomSensitivity
} from "../../../../shared/contracts";
import {
  CANVAS_LAUNCHER_ITEMS,
  DEFAULT_CANVAS_LAUNCHER_ITEMS,
  DEFAULT_RADIAL_LAUNCHER_ITEMS,
  RADIAL_LAUNCHER_ITEMS,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP
} from "../../../../shared/contracts";
import {
  canvasOverrideBindingConflicts,
  defaultCanvasWheelBinding
} from "../../../../shared/canvasNavigation";
import { ProviderIcon } from "../../components/ProviderIcon";
import { Switch } from "../../components/Switch";
import { UiIcon, type UiIconName } from "../../components/UiIcon";
import {
  CanvasMenuDivider,
  CanvasMenuLabel,
  CanvasMenuRow
} from "../../components/CanvasMenuPrimitives";
import {
  AGENT_PROVIDERS,
  LIMIT_PROVIDERS,
  PROVIDERS,
  resolveHomeLimitProviders,
  resolveHomeLauncherProviders,
  setHomeLimitProviderEnabled,
  setHomeLauncherProviderEnabled
} from "../../lib/providers";
import { isTooBroadDownloadFolder } from "../../../../shared/downloadFolder";
import { UpdateStatusLine } from "./UpdateStatus";
import { shortcutFromKeyboardEvent, shortcutFromPointerEvent } from "../../lib/shortcuts";
import { t, type TranslationKey } from "../../lib/i18n";
import { installUrl } from "../onboarding/OnboardingCard";
import { PluginSettingsSection } from "../plugins/PluginSettingsSection";
import { HomeAppearanceSettings } from "../home/HomeAppearanceSettings";
import {
  canvasColorPatch,
  homeAccentPresetPatch,
  resolveAppearanceSettings
} from "./appearanceSettings";
import { CanvasNavigationShortcutEditor } from "./CanvasNavigationShortcutEditor";
import { AgentHooksSettings } from "./AgentHooksSettings";
import { AboutSettings } from "./AboutSettings";
import { useEffectiveTheme } from "./useEffectiveTheme";
import { setCanvasLauncherItemEnabled } from "../launcher/canvasLauncher";
import { itemLabel } from "../launcher/QuickRadialMenu";
import { setRadialLauncherItemEnabled } from "../launcher/radialLauncher";

type SettingsSection = "general" | "notifications" | "appearance" | "agents" | "controls" | "browser" | "plugins" | "about";

const SETTINGS_SECTIONS: ReadonlyArray<{
  id: SettingsSection;
  icon: UiIconName;
}> = [
  { id: "general", icon: "general" },
  { id: "notifications", icon: "bell" },
  { id: "appearance", icon: "palette" },
  { id: "agents", icon: "agents" },
  { id: "controls", icon: "pointer" },
  { id: "browser", icon: "browser" },
  { id: "plugins", icon: "blocks" },
  { id: "about", icon: "info" }
];

// Previews show the token value, not the token: the one applied to .app belongs to the current choice.
const THEME_CANVAS_PREVIEW: Record<PaletteId, string> = { sand: "#24221E", bay: "#161B27", paper: "#EDE9E1", frost: "#E8EDF5" };
const THEME_TILE_PREVIEW: Record<PaletteId, { tile: string; card: string; dot: string; text: string }> = {
  sand: { tile: "#24221E", card: "#3A3731", dot: "#F0B84A", text: "#F2EEE6" },
  bay: { tile: "#161B27", card: "#232A3A", dot: "#5B9BFF", text: "#EEF2FA" },
  paper: { tile: "#EDE9E1", card: "#FFFFFF", dot: "#A0600A", text: "#2A2823" },
  frost: { tile: "#E8EDF5", card: "#FFFFFF", dot: "#2A6FE0", text: "#1E2633" }
};

const CANVAS_COLOR_PREVIEWS: Partial<Record<CanvasColorId, string>> = {
  stone: "#B3B0A8",
  lilac: "#B8ADB9",
  night: "#1E2230",
  graphite: "#1E1E1D",
  linen: "#ECE7DD",
  mist: "#E2E9EC"
};

interface SettingsPanelProps {
  open: boolean;
  settings: AppSettings;
  plugins: InstalledPlugin[];
  browser: BrowserSnapshot;
  onClose(): void;
  onChange(patch: Partial<AppSettings>): Promise<void>;
  onPreviewPlugin(sourceUrl: string): Promise<PluginInstallPreview>;
  onInstallPlugin(token: string, selectedModules: string[]): Promise<void>;
  onSearchPlugins(query: string): Promise<GithubPluginSearchResult[]>;
  onShowcasePlugins(): Promise<GithubPluginSearchResult[]>;
  onFetchPluginIcons(sourceUrls: string[]): Promise<Record<string, string | null>>;
  onPreviewManifests(sourceUrls: string[]): Promise<Record<string, PluginManifest>>;
  onCheckPluginUpdates(): Promise<PluginUpdateStatus[]>;
  onUpdatePlugin(pluginId: string): Promise<void>;
  onSetPluginModules(pluginId: string, selectedModules: string[]): Promise<void>;
  onSetPluginEnabled(pluginId: string, enabled: boolean): Promise<void>;
  onSetPluginHookEnabled(pluginId: string, hookId: string, enabled: boolean): Promise<void>;
  onUninstallPlugin(pluginId: string): Promise<void>;
  onOpenPluginContribution(plugin: InstalledPlugin, contribution: PluginContribution): Promise<void>;
  onToggleHomeWidget(widgetId: string, size: PluginGridSize): Promise<void>;
  onEditHome(): void;
  onOpenBrowser(url?: string): Promise<void>;
}

export function SettingsPanel({
  open,
  settings,
  plugins,
  browser,
  onClose,
  onChange,
  onPreviewPlugin,
  onInstallPlugin,
  onSearchPlugins,
  onShowcasePlugins,
  onFetchPluginIcons,
  onPreviewManifests,
  onCheckPluginUpdates,
  onUpdatePlugin,
  onSetPluginModules,
  onSetPluginEnabled,
  onSetPluginHookEnabled,
  onUninstallPlugin,
  onOpenPluginContribution,
  onToggleHomeWidget,
  onEditHome,
  onOpenBrowser,
}: SettingsPanelProps): React.JSX.Element {
  const locale = settings.locale;
  const theme = useEffectiveTheme(settings);
  const appearance = resolveAppearanceSettings(settings);
  const homeLauncherProviders = resolveHomeLauncherProviders(settings);
  const homeLimitProviders = resolveHomeLimitProviders(settings);
  const [section, setSection] = useState<SettingsSection>("general");
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [activity, setActivity] = useState<BrowserActivityEvent[]>([]);
  const [activityState, setActivityState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearingBrowserData, setClearingBrowserData] = useState(false);
  const [browserDataMessage, setBrowserDataMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCapturing(null);
      setShortcutError(null);
      setClearConfirm(false);
      setBrowserDataMessage(null);
    }
  }, [open]);

  useEffect(() => {
    if (section === "controls") return;
    setShortcutError(null);
    setCapturing(null);
  }, [section]);

  useEffect(() => {
    if (!open || section !== "browser") return;
    let active = true;
    setActivityState("loading");
    void window.canvasTTY.browser.getActivity()
      .then((events) => {
        if (!active) return;
        setActivity(events.slice(-40));
        setActivityState("ready");
      })
      .catch(() => {
        if (active) setActivityState("error");
      });
    const unsubscribe = window.canvasTTY.browser.onActivity(({ event }) => {
      if (!active) return;
      setActivity((current) => [...current.filter((candidate) => candidate.sequence !== event.sequence), event].slice(-40));
      setActivityState("ready");
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [open, section]);

  const clearBrowserData = async (): Promise<void> => {
    if (!clearConfirm) {
      setClearConfirm(true);
      setBrowserDataMessage(null);
      return;
    }
    setClearingBrowserData(true);
    try {
      await window.canvasTTY.browser.clearData();
      setBrowserDataMessage(t(locale, "browserDataCleared"));
      setClearConfirm(false);
    } catch {
      setBrowserDataMessage(t(locale, "browserDataClearFailed"));
    } finally {
      setClearingBrowserData(false);
    }
  };

  const [downloadFolderError, setDownloadFolderError] = useState(false);
  const saveShortcut = async (action: ShortcutAction, shortcut: string): Promise<void> => {
    const chords: [string, string][] = [...Object.entries(settings.shortcuts), ...(settings.commandPaletteShortcut ? [["commandPalette", settings.commandPaletteShortcut] as [string, string]] : [])];
    const conflict = chords.find(
      ([candidateAction, value]) => candidateAction !== action && value.toLowerCase() === shortcut.toLowerCase()
    );
    const conflictsWithNavigation = settings.canvasNavigationOverride !== null
      && canvasOverrideBindingConflicts(settings.canvasNavigationOverride, shortcut);
    const conflictsWithWheel = settings.canvasWheelCaptureMode === "key"
      && settings.canvasWheelOverride !== null
      && canvasOverrideBindingConflicts(settings.canvasWheelOverride, shortcut);
    if (conflict || conflictsWithNavigation || conflictsWithWheel) {
      setShortcutError(t(locale, "shortcutConflict"));
      return;
    }

    setShortcutError(null);
    await onChange(action === "commandPalette" ? { commandPaletteShortcut: shortcut } : { shortcuts: { ...settings.shortcuts, [action]: shortcut } });
    setCapturing(null);
  };

  const captureShortcut = (
    action: ShortcutAction,
    event: React.KeyboardEvent<HTMLButtonElement>
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setCapturing(null);
      setShortcutError(null);
      return;
    }

    const shortcut = shortcutFromKeyboardEvent(event);
    if (!shortcut) return;
    void saveShortcut(action, shortcut);
  };

  const capturePointerShortcut = (
    action: ShortcutAction,
    event: React.PointerEvent<HTMLButtonElement>
  ): void => {
    const shortcut = shortcutFromPointerEvent(event);
    if (!shortcut) return;
    event.preventDefault();
    event.stopPropagation();
    void saveShortcut(action, shortcut);
  };

  const changeCanvasWheelCaptureMode = (mode: CanvasWheelCaptureMode): void => {
    if (mode === "key" && settings.canvasWheelOverride === null) {
      void onChange({
        canvasWheelCaptureMode: mode,
        canvasWheelOverride: defaultCanvasWheelBinding(window.canvasTTY.window.isMacOS ? "darwin" : "other")
      });
      return;
    }
    void onChange({ canvasWheelCaptureMode: mode });
  };

  const canvasOverrideBindingsMatch = settings.canvasWheelCaptureMode === "key"
    && settings.canvasWheelOverride !== null
    && settings.canvasNavigationOverride !== null
    && settings.canvasWheelOverride === settings.canvasNavigationOverride;

  const sw = (label: string, description: string | undefined, checked: boolean, change: (next: boolean) => void): React.JSX.Element => (
    <SettingSwitch label={label} description={description} checked={checked} onChange={change} />
  );

  return (
    <div className={`settings-backdrop ${open ? "settings-backdrop--open" : ""}`} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside
        className={`settings-panel ${open ? "settings-panel--open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, "settings")}
        aria-hidden={!open}
      >
        <div className="settings-panel__sidebar">
          <nav className="settings-tabs" role="tablist" aria-label={t(locale, "settingsSections")}>
            {SETTINGS_SECTIONS.map(({ id, icon }) => (
              <button
                id={`settings-tab-${id}`}
                key={id}
                className={`${section === id ? "settings-tabs__button settings-tabs__button--active" : "settings-tabs__button"}${id === "about" ? " settings-tabs__button--about" : ""}`}
                type="button"
                role="tab"
                aria-controls={`settings-panel-${id}`}
                aria-selected={section === id}
                title={t(locale, id)}
                onClick={() => setSection(id)}
              >
                <span className="settings-tabs__icon"><UiIcon name={icon} size="1.05em" /></span>
                <span>{t(locale, id)}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="settings-panel__main">
          <header className="settings-panel__header">
            <h2>{t(locale, section)}</h2>
            <button
              className="settings-panel__close"
              type="button"
              onClick={onClose}
              aria-label={t(locale, "close")}
            ><UiIcon name="close" size="1.05em" /></button>
          </header>

          <div
            id={`settings-panel-${section}`}
            className="settings-panel__content"
            role="tabpanel"
            aria-labelledby={`settings-tab-${section}`}
          >
          {section === "general" && (
            <>
              <SettingGroup label={t(locale, "language")}>
                <Segmented
                  value={settings.locale}
                  options={[["ru", "Русский"], ["en", "English"]]}
                  onChange={(value) => void onChange({ locale: value as LocaleId })}
                />
              </SettingGroup>
              {sw(t(locale, "terminalSessionRestore"), t(locale, "terminalSessionRestoreDescription"), settings.restoreTerminalSessions,
                (next) => void onChange({ restoreTerminalSessions: next }))}
              {sw(t(locale, "persistCanvasRegions"), undefined, settings.persistCanvasRegions,
                (next) => void onChange({ persistCanvasRegions: next }))}
              {sw(t(locale, "persistStickyNotes"), undefined, settings.persistStickyNotes,
                (next) => void onChange({ persistStickyNotes: next }))}
              {sw(t(locale, "checkUpdatesSwitch"), t(locale, "checkUpdatesSwitchDescription"), settings.checkUpdates,
                (next) => void onChange({ checkUpdates: next }))}
              <UpdateStatusLine locale={locale} quiet />
            </>
          )}

          {section === "notifications" && <NotificationSettingsGroup settings={settings} onChange={onChange} />}

          {section === "appearance" && (
            <>
              <SettingGroup label={t(locale, "palette")} description={settings.followSystem ? `${t(locale, "paletteBySystem")} ${t(locale, "paletteDescription")}` : t(locale, "paletteDescription")}>
                <ThemeChoices
                  label={t(locale, "palette")}
                  value={settings.followSystem ? theme : settings.palette}
                  options={([
                    ["sand", t(locale, "themeSand")],
                    ["bay", t(locale, "themeBay")],
                    ["paper", t(locale, "themePaper")],
                    ["frost", t(locale, "themeFrost")]
                  ] as [PaletteId, string][])}
                  onChange={(value) => void onChange({ palette: value, followSystem: false })}
                />
              </SettingGroup>
              {sw(t(locale, "followSystem"), t(locale, "followSystemDescription"), settings.followSystem,
                (next) => void onChange({ followSystem: next }))}
              <SettingGroup label={t(locale, "uiScale")} description={t(locale, "uiScaleDescription")}>
                <label className="ui-scale-setting">
                  <span>{UI_SCALE_MIN.toFixed(2)}</span>
                  <input
                    type="range"
                    min={UI_SCALE_MIN}
                    max={UI_SCALE_MAX}
                    step={UI_SCALE_STEP}
                    value={settings.uiScale}
                    onChange={(event) => void onChange({ uiScale: Number(event.currentTarget.value) })}
                  />
                  <span>{UI_SCALE_MAX.toFixed(2)}</span>
                  <output>{settings.uiScale.toFixed(2)}×</output>
                </label>
              </SettingGroup>
              <SettingGroup label={t(locale, "canvasColor")} description={t(locale, "canvasColorDescription")}>
                <ColorDots
                  label={t(locale, "canvasColor")}
                  value={appearance.canvasColor}
                  options={([
                    ["theme", t(locale, "canvasColorTheme")],
                    ["stone", t(locale, "canvasColorStone")],
                    ["lilac", t(locale, "lilac")],
                    ["night", t(locale, "night")],
                    ["graphite", t(locale, "canvasColorGraphite")],
                    ["linen", t(locale, "canvasColorLinen")],
                    ["mist", t(locale, "canvasColorMist")]
                  ] as [CanvasColorId, string][]).map(([value, label]) => (
                    [value, label, (value === "theme" ? THEME_CANVAS_PREVIEW[theme] : CANVAS_COLOR_PREVIEWS[value]) ?? "#24221E"]
                  ))}
                  onChange={(value) => void onChange(canvasColorPatch(value as CanvasColorId))}
                />
              </SettingGroup>
              <SettingGroup label={t(locale, "canvasPattern")}>
                <Segmented
                  value={settings.pattern}
                  options={([
                    ["dots", t(locale, "dots")],
                    ["grid", t(locale, "grid")],
                    ["diagonal", t(locale, "patternDiagonal")],
                    ["rings", t(locale, "rings")],
                    ["waves", t(locale, "waves")],
                    ["none", t(locale, "patternNone")]
                  ] as [CanvasPatternId, string][])}
                  onChange={(value) => void onChange({ pattern: value as CanvasPatternId })}
                />
              </SettingGroup>
              <SettingGroup label={t(locale, "homeColors")} description={t(locale, "homeColorsDescription")}>
                <Segmented
                  value={appearance.homeAccentPreset}
                  options={([
                    ["theme", t(locale, "homePresetTheme")],
                    ["pastel", t(locale, "homePresetPastel")],
                    ["warm", t(locale, "homePresetWarm")],
                    ["cool", t(locale, "homePresetCool")],
                    ["mono", t(locale, "homePresetMono")],
                    ["dusk", t(locale, "homePresetDusk")],
                    ["custom", t(locale, "homePresetCustom")]
                  ] as [HomeAccentPresetId, string][])}
                  onChange={(value) => void onChange(homeAccentPresetPatch(value as HomeAccentPresetId))}
                />
              </SettingGroup>
              {appearance.homeAccentPreset === "custom" && (
                <SettingGroup layout="stacked" label={t(locale, "homeCustomColors")}>
                  <div className="color-editor">
                    {([
                      ["clock", t(locale, "homeColorClock")],
                      ["launcher", t(locale, "homeColorLauncher")],
                      ["browser", t(locale, "homeColorBrowser")],
                      ["settings", t(locale, "homeColorSettings")],
                      ["media", t(locale, "homeColorMedia")]
                    ] as [keyof HomeAccentColors, string][]).map(([key, label]) => (
                      <ColorField
                        key={key}
                        label={label}
                        value={appearance.homeAccentColors[key]}
                        onChange={(value) => void onChange({
                          homeAccentColors: { ...appearance.homeAccentColors, [key]: value }
                        })}
                      />
                    ))}
                  </div>
                </SettingGroup>
              )}
              <SettingGroup label={t(locale, "sessionRowColors")}>
                <Segmented
                  value={settings.sessionRowColorMode}
                  options={([
                    ["monochrome", t(locale, "sessionRowColorsMonochrome")],
                    ["status", t(locale, "sessionRowColorsByStatus")]
                  ] as [SessionRowColorMode, string][])}
                  onChange={(value) => void onChange({ sessionRowColorMode: value as SessionRowColorMode })}
                />
              </SettingGroup>
              {sw(t(locale, "reduceTransparency"), t(locale, "reduceTransparencyDescription"), settings.reduceTransparency,
                (next) => void onChange({ reduceTransparency: next }))}
              {sw(t(locale, "shortcutHints"), undefined, settings.showShortcutHints,
                (next) => void onChange({ showShortcutHints: next }))}
              <SettingGroup label={t(locale, "minimapPlacement")}>
                <PlacementChoices
                  value={settings.minimapPlacement}
                  locale={locale}
                  onChange={(minimapPlacement) => void onChange({ minimapPlacement })}
                />
              </SettingGroup>
              {settings.showShortcutHints && (
                <SettingGroup label={t(locale, "shortcutHintsPlacement")}>
                  <PlacementChoices
                    value={settings.shortcutHintsPlacement}
                    locale={locale}
                    onChange={(shortcutHintsPlacement) => void onChange({ shortcutHintsPlacement })}
                  />
                </SettingGroup>
              )}
              <SettingGroup label={t(locale, "canvasControlsPlacement")}>
                <PlacementChoices
                  value={settings.canvasControlsPlacement}
                  locale={locale}
                  onChange={(canvasControlsPlacement) => void onChange({ canvasControlsPlacement })}
                />
              </SettingGroup>
              <HomeAppearanceSettings
                settings={settings}
                plugins={plugins}
                onToggleHomeWidget={onToggleHomeWidget}
                onEditHome={onEditHome}
              />
            </>
          )}

          {section === "agents" && (
            <>
              <AgentHooksSettings
                settings={settings}
                plugins={plugins}
                onChange={onChange}
                onSetPluginHookEnabled={onSetPluginHookEnabled}
                part="core"
              />
              <AgentProviderTable
                locale={locale}
                homeLauncherProviders={homeLauncherProviders}
                homeLimitProviders={homeLimitProviders}
                onHome={(provider, enabled) => void onChange({
                  homeLauncherProviders: setHomeLauncherProviderEnabled(homeLauncherProviders, provider, enabled)
                })}
                onLimits={(provider, enabled) => void onChange({
                  homeLimitProviders: setHomeLimitProviderEnabled(homeLimitProviders, provider, enabled)
                })}
              />
              {sw(t(locale, "quickLauncher"), t(locale, "quickLauncherDescription"), settings.radialLauncherEnabled,
                (next) => void onChange({ radialLauncherEnabled: next }))}
              <SettingGroup label={t(locale, "canvasMenuStyle")} description={t(locale, "canvasMenuStyleDescription")} layout="under">
                <Segmented
                  value={settings.canvasMenuStyle}
                  options={([
                    ["mock", t(locale, "canvasMenuStyleMock")],
                    ["detailed", t(locale, "canvasMenuStyleDetailed")]
                  ] as [CanvasMenuStyle, string][])}
                  onChange={(value) => void onChange({ canvasMenuStyle: value as CanvasMenuStyle })}
                />
              </SettingGroup>
              <SettingGroup
                label={t(locale, "canvasLauncherItems")}
                description={t(locale, "canvasLauncherItemsDescription")}
                layout="top"
              >
                <div className="canvas-menu canvas-launcher-settings-menu">
                  {/* Terminal first, as in the menu itself and in mock 11 */}
                  {(["terminal", ...CANVAS_LAUNCHER_ITEMS.filter((i) => i !== "terminal")] as CanvasLauncherItemId[]).map((item: CanvasLauncherItemId) => {
                    const enabled = settings.canvasLauncherItems.includes(item);
                    return (
                      <CanvasMenuRow
                        {...(item === "terminal" ? { icon: "prompt" as const } : { iconNode: <ProviderIcon provider={item} size="small" /> })}
                        right={<span className="canvas-menu__toggle"><UiIcon name={enabled ? "minus" : "plus"} size="1em" /></span>}
                        muted={!enabled}
                        aria-pressed={enabled}
                        aria-label={`${t(locale, enabled ? "disable" : "enable")}: ${PROVIDERS[item].label}`}
                        title={`${t(locale, enabled ? "disable" : "enable")}: ${PROVIDERS[item].label}`}
                        key={item}
                        onClick={() => void onChange({
                          canvasLauncherItems: setCanvasLauncherItemEnabled(
                            settings.canvasLauncherItems,
                            item,
                            !enabled
                          )
                        })}
                      >{PROVIDERS[item].label}</CanvasMenuRow>
                    );
                  })}
                  <CanvasMenuDivider />
                  <CanvasMenuRow
                    icon="home"
                    muted
                    onClick={() => void onChange({ canvasLauncherItems: [...DEFAULT_CANVAS_LAUNCHER_ITEMS] })}
                  >{t(locale, "resetCanvasLauncher")}</CanvasMenuRow>
                </div>
              </SettingGroup>
              {settings.radialLauncherEnabled && (
              <section className="setting-group setting-group--field setting-group--stacked">
                <div className="canvas-menu canvas-launcher-settings-menu">
                  <CanvasMenuLabel>{t(locale, "quickLauncherCount").replace("{count}", String(settings.radialLauncherItems.length))}</CanvasMenuLabel>
                  {RADIAL_LAUNCHER_ITEMS.map((item: RadialLauncherItemId) => {
                    const enabled = settings.radialLauncherItems.includes(item);
                    return (
                      <CanvasMenuRow
                        icon={enabled ? "minus" : "plus"}
                        muted={!enabled}
                        aria-pressed={enabled}
                        aria-label={`${t(locale, enabled ? "disable" : "enable")}: ${itemLabel(locale, item)}`}
                        title={`${t(locale, enabled ? "disable" : "enable")}: ${itemLabel(locale, item)}`}
                        key={item}
                        onClick={() => void onChange({
                          radialLauncherItems: setRadialLauncherItemEnabled(
                            settings.radialLauncherItems,
                            item,
                            !enabled
                          )
                        })}
                      >{itemLabel(locale, item)}</CanvasMenuRow>
                    );
                  })}
                  <CanvasMenuDivider />
                  <CanvasMenuRow
                    icon="home"
                    muted
                    onClick={() => void onChange({ radialLauncherItems: [...DEFAULT_RADIAL_LAUNCHER_ITEMS] })}
                  >{t(locale, "useDefaults")}</CanvasMenuRow>
                </div>
              </section>
              )}
              <AgentHooksSettings
                settings={settings}
                plugins={plugins}
                onChange={onChange}
                onSetPluginHookEnabled={onSetPluginHookEnabled}
                part="optional"
              />
            </>
          )}

          {section === "controls" && (
            <>
              <SettingGroup label={t(locale, "focusActivation")}>
                <Segmented
                  value={settings.focusActivation}
                  options={([
                    ["off", t(locale, "focusActivationOff")],
                    ["single", t(locale, "focusActivationSingle")],
                    ["double", t(locale, "focusActivationDouble")]
                  ] as [FocusActivation, string][])}
                  onChange={(value) => void onChange({ focusActivation: value as FocusActivation })}
                />
              </SettingGroup>
              <SettingGroup
                label={t(locale, "canvasWheelCapture")}
                description={t(locale, "canvasWheelCaptureDescription")}
              >
                <Segmented
                  value={settings.canvasWheelCaptureMode}
                  options={[
                    ["off", t(locale, "wheelCaptureOff")],
                    ["always", t(locale, "wheelCaptureAlways")],
                    ["key", t(locale, "wheelCaptureKey")]
                  ]}
                  onChange={(value) => changeCanvasWheelCaptureMode(value as CanvasWheelCaptureMode)}
                />
              </SettingGroup>
              {settings.canvasWheelCaptureMode === "key" && (
                <section className="setting-group setting-group--field setting-group--stacked">
                  <CanvasNavigationShortcutEditor
                    open={open}
                    locale={locale}
                    label={t(locale, "canvasWheelOverride")}
                    binding={settings.canvasWheelOverride}
                    actionShortcuts={[...Object.values(settings.shortcuts), ...(settings.commandPaletteShortcut ? [settings.commandPaletteShortcut] : [])]}
                    allowDisable={false}
                    onCaptureStart={() => {
                      setCapturing(null);
                      setShortcutError(null);
                    }}
                    onChange={(canvasWheelOverride) => onChange({ canvasWheelOverride })}
                  />
                  {canvasOverrideBindingsMatch && (
                    <p className="shortcut-editor__warning">{t(locale, "canvasOverrideBindingsMatch")}</p>
                  )}
                </section>
              )}
              {sw(t(locale, "snapToGrid"), undefined, settings.snapToGrid,
                (next) => void onChange({ snapToGrid: next }))}
              <section className="setting-group setting-group--stacked shortcut-block">
                <h3 className="setting-subhead">{t(locale, "keyboardShortcuts")}</h3>
                <ShortcutRow
                  locale={locale}
                  label={t(locale, "homeShortcut")}
                  value={settings.shortcuts.home}
                  capturing={capturing === "home"}
                  onStart={() => {
                    setShortcutError(null);
                    setCapturing("home");
                  }}
                  onCancel={() => {
                    setShortcutError(null);
                    setCapturing(null);
                  }}
                  onKeyDown={(event) => captureShortcut("home", event)}
                  onPointerDown={(event) => capturePointerShortcut("home", event)}
                />
                {shortcutError && capturing === "home" && (
                  <p className="shortcut-editor__error" role="alert">{shortcutError}</p>
                )}
                <ShortcutRow
                  locale={locale}
                  label={t(locale, "renameWindow")}
                  value={settings.shortcuts.renameWindow}
                  capturing={capturing === "renameWindow"}
                  onStart={() => {
                    setShortcutError(null);
                    setCapturing("renameWindow");
                  }}
                  onCancel={() => {
                    setShortcutError(null);
                    setCapturing(null);
                  }}
                  onKeyDown={(event) => captureShortcut("renameWindow", event)}
                  onPointerDown={(event) => capturePointerShortcut("renameWindow", event)}
                />
                {shortcutError && capturing === "renameWindow" && (
                  <p className="shortcut-editor__error" role="alert">{shortcutError}</p>
                )}
                <CanvasNavigationShortcutEditor
                  open={open}
                  locale={locale}
                  label={t(locale, "canvasNavigationOverrideHint")}
                  binding={settings.canvasNavigationOverride}
                  actionShortcuts={[...Object.values(settings.shortcuts), ...(settings.commandPaletteShortcut ? [settings.commandPaletteShortcut] : [])]}
                  allowDisable
                  onCaptureStart={() => {
                    setCapturing(null);
                    setShortcutError(null);
                  }}
                  onChange={(canvasNavigationOverride) => onChange({ canvasNavigationOverride })}
                />
                <ShortcutRow
                  locale={locale}
                  label={t(locale, "commandPalette")}
                  value={settings.commandPaletteShortcut ?? (window.canvasTTY.window.isMacOS ? "⌘K" : "Ctrl+K")}
                  capturing={capturing === "commandPalette"}
                  onStart={() => {
                    setShortcutError(null);
                    setCapturing("commandPalette");
                  }}
                  onCancel={() => {
                    setShortcutError(null);
                    setCapturing(null);
                  }}
                  onKeyDown={(event) => captureShortcut("commandPalette", event)}
                  onPointerDown={() => undefined}
                />
                {shortcutError && capturing === "commandPalette" && (
                  <p className="shortcut-editor__error" role="alert">{shortcutError}</p>
                )}
                <p className="shortcut-editor__hint">{t(locale, "shortcutsAccepted")}</p>
              </section>
              {sw(t(locale, "hoverFocus"), t(locale, "hoverFocusDescription"), settings.hoverFocus,
                (next) => void onChange({ hoverFocus: next }))}
              {settings.hoverFocus && (
                <SettingGroup label={t(locale, "hoverFocusSpeed")}>
                  <Segmented
                    value={settings.hoverFocusSpeed}
                    options={(["slow", "normal", "fast"] as EdgePanSpeed[]).map((value) => [value, t(locale, value)])}
                    onChange={(value) => void onChange({ hoverFocusSpeed: value as EdgePanSpeed })}
                  />
                </SettingGroup>
              )}
              <SettingGroup
                label={t(locale, "minimapInteractionMode")}
                description={t(locale, "minimapInteractionModeDescription")}
              >
                <Segmented
                  value={settings.minimapInteractionMode}
                  options={([
                    ["click", t(locale, "minimapInteractionClick")],
                    ["drag", t(locale, "minimapInteractionDrag")]
                  ] as [MinimapInteractionMode, string][])}
                  onChange={(value) => void onChange({
                    minimapInteractionMode: value as MinimapInteractionMode
                  })}
                />
              </SettingGroup>
              {sw(t(locale, "edgePan"), t(locale, "edgePanDescription"), settings.edgePan,
                (next) => void onChange({ edgePan: next }))}
              <SettingGroup label={t(locale, "edgePanSpeed")}>
                <Segmented
                  value={settings.edgePanSpeed}
                  options={(["slow", "normal", "fast"] as EdgePanSpeed[]).map((value) => [value, t(locale, value)])}
                  onChange={(value) => void onChange({ edgePanSpeed: value as EdgePanSpeed })}
                />
              </SettingGroup>
              <SettingGroup label={t(locale, "zoomSensitivity")}>
                <Segmented
                  value={settings.zoomSensitivity}
                  options={(["slow", "normal", "fast"] as ZoomSensitivity[]).map((value) => [value, t(locale, value)])}
                  onChange={(value) => void onChange({ zoomSensitivity: value as ZoomSensitivity })}
                />
              </SettingGroup>
              {sw(t(locale, "useScrollWheelToZoom"), t(locale, "useScrollWheelToZoomDescription"), settings.useScrollWheelToZoom,
                (next) => void onChange({ useScrollWheelToZoom: next }))}
              <SettingGroup label={t(locale, "terminalWheelDirection")}>
                <Segmented
                  value={settings.invertTerminalWheel ? "inverted" : "normal"}
                  options={[["inverted", t(locale, "wheelInverted")], ["normal", t(locale, "wheelNormal")]]}
                  onChange={(value) => void onChange({ invertTerminalWheel: value === "inverted" })}
                />
              </SettingGroup>
              <SettingGroup label={t(locale, "canvasWheelDirection")}>
                <Segmented
                  value={settings.invertCanvasWheel ? "inverted" : "normal"}
                  options={[["normal", t(locale, "wheelNormal")], ["inverted", t(locale, "wheelInverted")]]}
                  onChange={(value) => void onChange({ invertCanvasWheel: value === "inverted" })}
                />
              </SettingGroup>
              {/* D-012: Even G2 is not in the mock-up; it stays here as a collapsible block at the bottom */}
              <details className="settings-fold" data-even-g2-fold>
                <summary>Even G2</summary>
                <EvenG2Controls locale={locale} />
              </details>
            </>
          )}

          {section === "browser" && (
            <>
              {sw(t(locale, "browserAgentAccess"), t(locale, "browserAgentAccessDescription"), settings.browserAgentAccess,
                (next) => void onChange({ browserAgentAccess: next }))}
              {sw(t(locale, "browserAgentPresence"), t(locale, "browserAgentPresenceDescription"), settings.browserShowAgentPresence,
                (next) => void onChange({ browserShowAgentPresence: next }))}
              {sw(t(locale, "browserRestoreTabs"), t(locale, "browserRestoreTabsDescription"), settings.browserRestoreTabs,
                (next) => void onChange({ browserRestoreTabs: next }))}
              <section className="setting-group setting-group--field setting-group--download-folder" data-browser-download-folder>
                <div className="setting-group__copy">
                  <h3>{t(locale, "browserDownloads")}</h3>
                  <p className="setting-group__description setting-path" title={settings.browserDownloadDir ?? undefined}>{settings.browserDownloadDir ?? t(locale, "browserDownloadsDefaultPath")}</p>
                </div>
                <div className="setting-group__control">
                  {settings.browserDownloadDir !== null && (
                    <button type="button" className="set-btn set-btn--quiet" onClick={() => void onChange({ browserDownloadDir: null })}>{t(locale, "browserDownloadsReset")}</button>
                  )}
                  <button type="button" className="set-btn" data-browser-download-change onClick={() => void window.canvasTTY.dialog.pickDirectory(settings.browserDownloadDir ?? undefined).then((picked) => { if (!picked) return; if (isTooBroadDownloadFolder(picked)) { setDownloadFolderError(true); return; } setDownloadFolderError(false); void onChange({ browserDownloadDir: picked }); })}>{t(locale, "browserDownloadsChange")}</button>
                </div>
              </section>
              {downloadFolderError && <p className="update-status update-status--failed" role="alert" data-download-folder-error>{t(locale, "browserDownloadsTooBroad")}</p>}
              <SettingGroup layout="stacked" label={t(locale, "browserDownloadsRecent")}>
                <BrowserDownloadList downloads={browser.downloads} locale={locale} />
              </SettingGroup>
              <SettingGroup layout="caps" label={t(locale, "browserActivity")}>
                <BrowserActivityList activity={activity} state={activityState} locale={locale} />
              </SettingGroup>
              <SettingGroup
                label={t(locale, "browserData")}
                description={t(locale, "browserDataDescription")}
              >
                <div className="browser-settings__data-actions">
                  <button
                    className={clearConfirm ? "browser-settings__clear browser-settings__clear--confirm" : "browser-settings__clear"}
                    type="button"
                    disabled={clearingBrowserData}
                    onClick={() => void clearBrowserData()}
                  >
                    {clearingBrowserData
                      ? t(locale, "browserDataClearing")
                      : clearConfirm
                        ? t(locale, "browserDataClearConfirm")
                        : t(locale, "browserDataClear")}
                  </button>
                  {clearConfirm && !clearingBrowserData && (
                    <button className="browser-settings__cancel" type="button" onClick={() => setClearConfirm(false)}>
                      {t(locale, "cancel")}
                    </button>
                  )}
                </div>
                {browserDataMessage && <p className="browser-settings__message" role="status">{browserDataMessage}</p>}
              </SettingGroup>
            </>
          )}

          {section === "plugins" && (
            <PluginSettingsSection
              settings={settings}
              plugins={plugins}
              onPreviewPlugin={onPreviewPlugin}
              onInstallPlugin={onInstallPlugin}
              onSearchPlugins={onSearchPlugins}
              onShowcasePlugins={onShowcasePlugins}
              onFetchPluginIcons={onFetchPluginIcons}
              onPreviewManifests={onPreviewManifests}
              onOpenBrowser={onOpenBrowser}
              onCheckPluginUpdates={onCheckPluginUpdates}
              onUpdatePlugin={onUpdatePlugin}
              onSetPluginModules={onSetPluginModules}
              onSetPluginEnabled={onSetPluginEnabled}
              onUninstallPlugin={onUninstallPlugin}
              onOpenPluginContribution={onOpenPluginContribution}
            />
          )}

            {section === "about" && <AboutSettings locale={locale} />}
          </div>
        </div>
      </aside>
    </div>
  );
}

function BrowserDownloadList({
  downloads,
  locale
}: {
  downloads: BrowserDownloadSnapshot[];
  locale: LocaleId;
}): React.JSX.Element {
  const recent = [...downloads]
    .sort((left, right) => right.startedAt - left.startedAt)
    .slice(0, 6);
  if (recent.length === 0) return <p className="browser-settings__empty">{t(locale, "browserNoDownloads")}</p>;

  return (
    <div className="browser-settings__list" data-wheel-owner="local">
      {recent.map((download) => {
        const percent = download.totalBytes > 0
          ? Math.min(100, Math.round(download.receivedBytes / download.totalBytes * 100))
          : null;
        return (
          <div className="browser-settings__download" key={download.id}>
            <span className="browser-settings__download-icon"><UiIcon name="download" size={15} /></span>
            <span className="browser-settings__row-copy">
              <strong title={download.fileName}>{download.fileName}</strong>
              <small>{downloadStatusLabel(locale, download.status)}{percent === null ? "" : `, ${percent}%`}</small>
            </span>
            {download.status === "progressing" && percent !== null && (
              <span className="browser-settings__progress" aria-label={`${percent}%`}>
                <span style={{ width: `${percent}%` }} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BrowserActivityList({
  activity,
  state,
  locale
}: {
  activity: BrowserActivityEvent[];
  state: "idle" | "loading" | "ready" | "error";
  locale: LocaleId;
}): React.JSX.Element {
  if (state === "loading" || state === "idle") {
    return <p className="browser-settings__empty">{t(locale, "browserActivityLoading")}</p>;
  }
  if (state === "error") return <p className="browser-settings__empty browser-settings__empty--error">{t(locale, "browserActivityFailed")}</p>;
  const recent = [...activity].sort((left, right) => right.sequence - left.sequence).slice(0, 10);
  if (recent.length === 0) return <p className="browser-settings__empty">{t(locale, "browserNoActivity")}</p>;

  return (
    <div className="browser-settings__list" data-wheel-owner="local">
      {recent.map((event) => {
        const provider = event.provider ?? "unknown";
        return (
          <div className={`browser-settings__activity ${event.ok ? "" : "browser-settings__activity--failed"}`} key={event.sequence}>
            <span className="browser-settings__badge" title={event.agentId ?? t(locale, "browserYou")}>
              {provider !== "unknown" && <ProviderIcon provider={provider} size="small" />}
              {event.agentId ?? t(locale, "browserYou")}
            </span>
            <span className="browser-settings__op">{activityOperationLabel(locale, event.operation)}</span>
            <time dateTime={new Date(event.timestamp).toISOString()}>
              {new Date(event.timestamp).toLocaleTimeString(locale === "ru" ? "ru-RU" : "en-GB", {
                hour: "2-digit",
                minute: "2-digit"
              })}
            </time>
          </div>
        );
      })}
    </div>
  );
}

function downloadStatusLabel(locale: LocaleId, status: BrowserDownloadSnapshot["status"]): string {
  const keys = {
    pending: "browserDownloadPending",
    progressing: "browserDownloadProgressing",
    completed: "browserDownloadCompleted",
    canceled: "browserDownloadCanceled",
    interrupted: "browserDownloadInterrupted"
  } as const;
  return t(locale, keys[status]);
}

const ACTIVITY_LABELS: Record<LocaleId, Record<BrowserCommandType, string>> = {
  ru: {
    browser_list_tabs: "Просмотрел вкладки",
    browser_new_tab: "Открыл вкладку",
    browser_close_tab: "Закрыл вкладку",
    browser_activate_tab: "Выбрал вкладку",
    browser_navigate: "Перешёл по адресу",
    browser_back: "Вернулся назад",
    browser_forward: "Перешёл вперёд",
    browser_reload: "Обновил страницу",
    browser_observe: "Осмотрел страницу",
    browser_read_page: "Прочитал страницу",
    browser_screenshot: "Сделал снимок",
    browser_click: "Нажал на странице",
    browser_hover: "Навёл курсор",
    browser_type: "Ввёл текст",
    browser_select: "Выбрал значение",
    browser_press: "Нажал клавишу",
    browser_scroll: "Прокрутил страницу",
    browser_drag: "Перетащил элемент",
    browser_wait_for: "Ждал изменения",
    browser_handle_dialog: "Ответил сайту",
    browser_download_wait: "Ждал загрузку",
    browser_upload: "Передал файл",
    browser_get_activity: "Проверил историю"
  },
  en: {
    browser_list_tabs: "Viewed tabs",
    browser_new_tab: "Opened a tab",
    browser_close_tab: "Closed a tab",
    browser_activate_tab: "Selected a tab",
    browser_navigate: "Opened an address",
    browser_back: "Went back",
    browser_forward: "Went forward",
    browser_reload: "Reloaded the page",
    browser_observe: "Inspected the page",
    browser_read_page: "Read the page",
    browser_screenshot: "Took a screenshot",
    browser_click: "Clicked the page",
    browser_hover: "Moved the pointer",
    browser_type: "Entered text",
    browser_select: "Selected a value",
    browser_press: "Pressed a key",
    browser_scroll: "Scrolled the page",
    browser_drag: "Dragged an item",
    browser_wait_for: "Waited for a change",
    browser_handle_dialog: "Answered the site",
    browser_download_wait: "Waited for a download",
    browser_upload: "Uploaded a file",
    browser_get_activity: "Checked activity"
  }
};

function activityOperationLabel(locale: LocaleId, operation: BrowserCommandType): string {
  return ACTIVITY_LABELS[locale][operation];
}

function ShortcutRow({
  locale,
  label,
  value,
  capturing,
  onStart,
  onCancel,
  onKeyDown,
  onPointerDown
}: {
  locale: LocaleId;
  label: string;
  value: string;
  capturing: boolean;
  onStart(): void;
  onCancel(): void;
  onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void;
  onPointerDown(event: React.PointerEvent<HTMLButtonElement>): void;
}): React.JSX.Element {
  return (
    <div className="shortcut-editor__row">
      <span>{label}</span>
      <div className="shortcut-editor__actions">
        <button
          className={capturing ? "shortcut-editor__key shortcut-editor__key--capturing" : "shortcut-editor__key"}
          type="button"
          data-shortcut-capture="true"
          onClick={onStart}
          onPointerDown={(event) => {
            if (capturing) onPointerDown(event);
          }}
          onKeyDown={(event) => {
            if (capturing) onKeyDown(event);
          }}
        >{capturing ? t(locale, "shortcutPress") : value}</button>
        <button
          className="shortcut-editor__edit"
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={capturing ? onCancel : onStart}
        >{capturing ? t(locale, "cancel") : t(locale, "shortcutEdit")}</button>
      </div>
    </div>
  );
}

function PlacementChoices({
  value,
  locale,
  onChange
}: {
  value: CanvasOverlayPlacement;
  locale: LocaleId;
  onChange(value: CanvasOverlayPlacement): void;
}): React.JSX.Element {
  const options: Array<[CanvasOverlayPlacement, string]> = [
    ["top-left", t(locale, "topLeft")],
    ["top-right", t(locale, "topRight")],
    ["bottom-left", t(locale, "bottomLeft")],
    ["bottom-right", t(locale, "bottomRight")]
  ];
  return (
    <div className="segmented segmented--placement">
      {options.map(([optionValue, label]) => (
        <button
          className={value === optionValue ? "segmented__button segmented__button--active" : "segmented__button"}
          type="button"
          key={optionValue}
          onClick={() => onChange(optionValue)}
        >{label}</button>
      ))}
    </div>
  );
}

// Orchestration notifications (UX audit PR 3): the switches for what is shown, the ticks for which events are reported.
function NotificationSettingsGroup({ settings, onChange }: { settings: AppSettings; onChange(patch: Partial<AppSettings>): Promise<void> }): React.JSX.Element {
  const locale = settings.locale;
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => { try { setUnavailable(localStorage.getItem(NOTIFY_UNAVAILABLE_KEY) === "1"); } catch { /* no storage: nothing to say */ } }, []);
  const set = (key: keyof NotificationSettings, value: boolean): void => void onChange({ notifications: { ...settings.notifications, [key]: value } });
  const switches: [keyof NotificationSettings, TranslationKey, TranslationKey][] = [
    ["banner", "notifyBannerChannel", "notifyBannerChannelDescription"], ["system", "notifySystemChannel", "notifySystemChannelDescription"],
    ["dockBadge", "notifyDockBadge", "notifyDockBadgeDescription"], ["bounce", "notifyBounce", "notifyBounceDescription"],
    ["board", "notifyBoard", "notifyBoardDescription"],
    // C4: under «board», shown while it is on
    ...(settings.notifications.board ? [["boardHead", "notifyBoardHead", "notifyBoardHeadDescription"] as [keyof NotificationSettings, TranslationKey, TranslationKey]] : [])
  ];
  const events: [keyof NotificationSettings, TranslationKey][] = [["waiting", "notifyWaiting"], ["failed", "notifyFailed"], ["completed", "notifyCompleted"]];
  return (
    <>
      {unavailable && <p className="setting-group__description notify-unavailable" role="status" data-notify-unavailable>{t(locale, "notifyUnavailable")}</p>}
      {switches.map(([key, label, description]) => (
        <SettingSwitch key={key} label={t(locale, label)} description={t(locale, description)}
          checked={settings.notifications[key]} onChange={(next) => set(key, next)} />
      ))}
      <section className="setting-group setting-group--field">
        <div className="setting-group__copy"><h3>{t(locale, "notifyReportAbout")}</h3></div>
        <div className="setting-group__control notify-events">
          {events.map(([key, label]) => (
            <label className="notify-events__item" key={key}>
              <input type="checkbox" checked={settings.notifications[key]} onChange={(event) => set(key, event.currentTarget.checked)} />
              <span>{t(locale, label)}</span>
            </label>
          ))}
        </div>
      </section>
      <p className="setting-group__description setting-group__footnote" data-notify-intro>{t(locale, "notifyIntro")}</p>
      <p className="setting-group__description setting-group__footnote" data-notify-system-hint>{t(locale, "notifySystemHint")}</p>
      <p className="setting-group__description setting-group__footnote" data-notify-badge-hint>{t(locale, "notifyBadgeHint")}</p>
    </>
  );
}

function SettingSwitch({
  label,
  description,
  checked,
  onChange
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange(checked: boolean): void;
}): React.JSX.Element {
  return (
    <SettingGroup label={label} description={description} layout="switch">
      <Switch checked={checked} label={label} onChange={onChange} />
    </SettingGroup>
  );
}

function ThemeChoices({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: PaletteId;
  options: [PaletteId, string][];
  onChange(value: PaletteId): void;
}): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons that keeps its own layout; a fieldset would bring its own box
    <div className="theme-choices" role="group" aria-label={label}>
      {options.map(([id, label]) => (
        <button
          className={value === id ? "theme-choice theme-choice--active" : "theme-choice"}
          type="button"
          key={id}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          <span className="theme-choice__preview" aria-hidden="true" style={{ background: THEME_TILE_PREVIEW[id].tile }}>
            <i style={{ background: THEME_TILE_PREVIEW[id].card }} />
            <b style={{ background: THEME_TILE_PREVIEW[id].dot }} />
          </span>
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function ColorDots({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: [string, string, string][];
  onChange(value: string): void;
}): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons that keeps its own layout; a fieldset would bring its own box
    <div className="color-dots" role="group" aria-label={label}>
      {options.map(([optionValue, label, color]) => (
        <button
          className={`color-dot${optionValue === "theme" ? " color-dot--theme" : ""}${value === optionValue ? " color-dot--active" : ""}`}
          type="button"
          key={optionValue}
          aria-pressed={value === optionValue}
          aria-label={label}
          title={label}
          style={optionValue === "theme" ? undefined : { background: color }}
          onClick={() => onChange(optionValue)}
        />
      ))}
    </div>
  );
}

// «Agents»: one row per provider: is its CLI found, is it in the HOME dock, are its limits shown.
function AgentProviderTable({
  locale,
  homeLauncherProviders,
  homeLimitProviders,
  onHome,
  onLimits
}: {
  locale: LocaleId;
  homeLauncherProviders: AgentProviderId[];
  homeLimitProviders: LimitProviderId[];
  onHome(provider: AgentProviderId, enabled: boolean): void;
  onLimits(provider: LimitProviderId, enabled: boolean): void;
}): React.JSX.Element {
  const [found, setFound] = useState<AgentProviderId[] | null>(null);
  const [failed, setFailed] = useState(false); // a failed lookup is not «CLI not found»: the cell stays empty
  useEffect(() => {
    let active = true;
    window.canvasTTY.providers.available().then((list: AgentProviderId[]) => { if (active) setFound(list); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  const install = (): void => void window.canvasTTY.external.openUrl(installUrl(locale));
  return (
    <table className="agent-table" aria-busy={found === null && !failed}>
      <thead>
        <tr>
          <th scope="col">{t(locale, "agentTableProvider")}</th>
          <th scope="col">{t(locale, "agentTableCli")}</th>
          <th scope="col">{t(locale, "agentTableDock")}</th>
          <th scope="col">{t(locale, "agentTableLimits")}</th>
        </tr>
      </thead>
      <tbody>
        {AGENT_PROVIDERS.map((provider) => {
          const label = PROVIDERS[provider].label;
          const limited = (LIMIT_PROVIDERS as AgentProviderId[]).includes(provider);
          return (
            <tr key={provider} data-provider={provider}>
              <th scope="row"><span className="agent-table__identity"><ProviderIcon provider={provider} size="small" />{label}</span></th>
              <td className="agent-table__cli">
                {found === null ? null : found.includes(provider)
                  ? <span className="agent-table__found"><UiIcon name="done" size="1em" />{t(locale, "cliFound")}</span>
                  : <><span>{t(locale, "cliMissing")}</span><button type="button" className="agent-table__install" onClick={install}>{t(locale, "howToInstall")}</button></>}
              </td>
              <td><Switch checked={homeLauncherProviders.includes(provider)} label={`${t(locale, "agentTableDock")}: ${label}`} onChange={(next) => onHome(provider, next)} /></td>
              <td>{limited
                ? <Switch checked={homeLimitProviders.includes(provider as LimitProviderId)} label={`${t(locale, "agentTableLimits")}: ${label}`} onChange={(next) => onLimits(provider as LimitProviderId, next)} />
                : <span className="agent-table__none" aria-hidden="true">—</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SettingGroup({
  label,
  description,
  layout = "field",
  children
}: {
  label: string;
  description?: string;
  layout?: "field" | "stacked" | "switch" | "under" | "top" | "caps";
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className={`setting-group setting-group--field${layout === "stacked" || layout === "under" || layout === "caps" ? " setting-group--stacked" : ""}${layout === "caps" ? " setting-group--caps" : ""}${layout === "switch" ? " setting-group--switch" : ""}${layout === "under" ? " setting-group--under" : ""}${layout === "top" ? " setting-group--top" : ""}`}>
      <div className="setting-group__copy">
        <h3>{label}</h3>
        {description && <p className="setting-group__description">{description}</p>}
      </div>
      <div className="setting-group__control">{children}</div>
    </section>
  );
}

function Segmented({
  value,
  options,
  wrap = false,
  onChange
}: {
  value: string;
  options: [string, string][];
  wrap?: boolean;
  onChange(value: string): void;
}): React.JSX.Element {
  return (
    <div className={`segmented ${wrap ? "segmented--wrap" : ""}`}>
      {options.map(([optionValue, label]) => (
        <button
          className={value === optionValue ? "segmented__button segmented__button--active" : "segmented__button"}
          type="button"
          key={optionValue}
          onClick={() => onChange(optionValue)}
        >{label}</button>
      ))}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const commit = (): void => {
    if (/^#[0-9A-F]{6}$/i.test(draft)) {
      onChange(draft.toUpperCase());
      return;
    }
    setDraft(value);
  };

  return (
    <label className="color-field">
      <span className="color-field__label">{label}</span>
      <span className="color-field__controls">
        <span className="color-field__swatch" style={{ background: value }}>
          <input
            type="color"
            value={value}
            aria-label={label}
            onChange={(event) => onChange(event.currentTarget.value.toUpperCase())}
          />
        </span>
        <input
          className="color-field__hex"
          type="text"
          value={draft}
          maxLength={7}
          spellCheck={false}
          aria-label={`${label} HEX`}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setDraft(value);
              event.currentTarget.blur();
            }
          }}
        />
      </span>
    </label>
  );
}
