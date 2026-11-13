// D-043 (mock 26): why a plugin did not load, in the person's words. Main keeps its own English line (loadError, the first
// line of the validation error); the known ones are said in the interface's language, any other as a check that failed —
// the line itself stays the row's tooltip.
import type { LocaleId } from "../../../../shared/contracts.ts";
import { t } from "../../lib/i18n.ts";

export function pluginLoadReason(locale: LocaleId, raw: string): string {
  const kind = /^Unknown plugin contribution kind: (.+?)\.?$/.exec(raw)?.[1];
  if (kind !== undefined) return t(locale, "pluginLoadReason_kind").replace("{kind}", () => kind);
  if (/is missing or too large/.test(raw)) return t(locale, "pluginLoadReason_missing");
  if (/JSON|Unexpected token|Expected property/.test(raw)) return t(locale, "pluginLoadReason_json");
  return t(locale, "pluginLoadReason_other");
}
