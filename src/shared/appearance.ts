import type { LegacyPaletteId, PaletteId } from "./contracts.ts";

// Plugin API v1 still speaks the three pre-redesign palettes (docs/plugin-api.d.ts); the new theme is `appearance.theme`.
export function toLegacyPalette(palette: PaletteId): LegacyPaletteId {
  return palette === "bay" ? "night" : "sage";
}

// --surface-0 of each theme (tokens.css): the window colour before the page paints.
export const THEME_WINDOW_BACKGROUND: Record<PaletteId, string> = {
  sand: "#24221E", bay: "#161B27", paper: "#EDE9E1", frost: "#E8EDF5"
};
// The fallback when settings.json cannot be read.
export const DARK_WINDOW_BACKGROUND = THEME_WINDOW_BACKGROUND.sand;
export const PALETTE_IDS = new Set<PaletteId>(["sand", "bay", "paper", "frost"]);
export const isLightTheme = (theme: PaletteId): boolean => theme === "paper" || theme === "frost";
export const windowBackground = (theme: PaletteId): string => THEME_WINDOW_BACKGROUND[theme];

// `palette` keeps the last manual choice; with followSystem the theme in effect is paper by day, sand by night.
export function effectiveTheme(
  settings: { palette: PaletteId; followSystem?: boolean }, systemDark: boolean
): PaletteId {
  return settings.followSystem ? (systemDark ? "sand" : "paper") : settings.palette;
}

// Old ids are read only: the normalizer rewrites them, only the new ids are saved.
export const LEGACY_PALETTE_TO_PALETTE: Record<string, PaletteId> = { sage: "sand", lilac: "bay", night: "bay" };

// Main, before the window exists: raw settings.json text -> theme in effect. Any failure is the dark default.
export function earlyTheme(raw: string | null, systemDark: boolean): PaletteId {
  try {
    const source = JSON.parse(raw ?? "") as Record<string, unknown>;
    const id = source.palette;
    const palette = typeof id === "string" && Object.hasOwn(LEGACY_PALETTE_TO_PALETTE, id) ? LEGACY_PALETTE_TO_PALETTE[id]
      : PALETTE_IDS.has(id as PaletteId) ? id as PaletteId : "sand";
    return effectiveTheme({ palette, followSystem: source.followSystem === true }, systemDark);
  } catch {
    return "sand";
  }
}
