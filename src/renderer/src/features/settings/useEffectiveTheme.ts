import { useEffect, useState } from "react";
import { effectiveTheme } from "../../../../shared/appearance";
import type { AppSettings, PaletteId } from "../../../../shared/contracts";

// The only place besides Settings that reads settings.palette: the theme in effect (followSystem -> paper/sand).
export function useEffectiveTheme(settings: Pick<AppSettings, "palette" | "followSystem">): PaletteId {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return undefined;
    const update = (): void => setSystemDark(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return effectiveTheme(settings, systemDark);
}
