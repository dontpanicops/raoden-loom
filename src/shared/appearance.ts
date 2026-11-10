import type { LegacyPaletteId, PaletteId } from "./contracts.ts";

// Plugin API v1 still speaks the three pre-redesign palettes (docs/plugin-api.d.ts); the new theme is `appearance.theme`.
export function toLegacyPalette(palette: PaletteId): LegacyPaletteId {
  return palette === "bay" ? "night" : "sage";
}

// --surface-0 of the Sand theme. Both R0 themes are dark, so one constant colours the window and the startup page
// before settings are read. ponytail: R4 reads the theme synchronously from settings.json instead.
export const DARK_WINDOW_BACKGROUND = "#24221E";
