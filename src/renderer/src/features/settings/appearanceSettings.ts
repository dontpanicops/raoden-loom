import type {
  AppSettings,
  CanvasColorId,
  HomeAccentColors,
  HomeAccentPresetId
} from "../../../../shared/contracts";
import { DEFAULT_HOME_ACCENT_COLORS } from "../../../../shared/contracts.ts";

export interface ResolvedAppearanceSettings {
  homeAccentPreset: HomeAccentPresetId;
  homeAccentColors: HomeAccentColors;
  canvasColor: CanvasColorId;
}

export function resolveAppearanceSettings(
  settings: Omit<Pick<Partial<AppSettings>, "palette" | "homeAccentPreset" | "homeAccentColors" | "canvasColor">, "canvasColor">
    & { canvasColor?: CanvasColorId | "palette" }
): ResolvedAppearanceSettings {
  return {
    homeAccentPreset: settings.homeAccentPreset ?? "theme",
    homeAccentColors: settings.homeAccentColors ?? DEFAULT_HOME_ACCENT_COLORS,
    canvasColor: settings.canvasColor && settings.canvasColor !== "palette"
      ? settings.canvasColor
      : "theme"
  };
}

export function canvasColorPatch(canvasColor: CanvasColorId): Pick<AppSettings, "canvasColor"> {
  return { canvasColor };
}

export function homeAccentPresetPatch(
  homeAccentPreset: HomeAccentPresetId
): Pick<AppSettings, "homeAccentPreset"> {
  return { homeAccentPreset };
}
