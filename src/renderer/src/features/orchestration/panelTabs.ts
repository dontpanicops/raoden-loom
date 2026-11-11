// The run panel's three tabs and the way every older key lands on them (R3a). Pure: no React, testable under node.
// Tabs: summary (Итог), work (Ход работы: modes feed/journal/records), changes. A section is an anchor inside the summary.
export type PanelTab = "summary" | "work" | "changes";
export type PanelMode = "feed" | "journal" | "records";
export type PanelSection = "plan" | "result" | "overview";
export type PanelRole = "all" | "lead" | "executor" | "reviewer" | "check"; // "all": the feed of every role (R5b, the mock-up's "Все")
// The eight keys the panel had before R3a (code, smoke scripts, tests still say them).
export type LegacyPanelTab = "plan" | "result" | "summary" | "overview" | "activity" | "changes" | "log" | "history";
export interface PanelTarget { tab: PanelTab; mode?: PanelMode; section?: PanelSection }
// What a caller may ask for: a legacy key, or the new parts (a tab can be given by its legacy name too).
export interface PanelView { tab?: PanelTab | LegacyPanelTab; mode?: PanelMode; section?: PanelSection; role?: PanelRole }
export type PanelViewArg = LegacyPanelTab | PanelView;

export const LEGACY_VIEWS: Record<LegacyPanelTab, PanelTarget> = {
  summary: { tab: "summary" },
  plan: { tab: "summary", section: "plan" },
  result: { tab: "summary", section: "result" },
  overview: { tab: "summary", section: "overview" },
  activity: { tab: "work", mode: "feed" },
  log: { tab: "work", mode: "journal" },
  history: { tab: "work", mode: "records" },
  changes: { tab: "changes" }
};

export function legacyView(key: string): PanelTarget | null {
  return Object.hasOwn(LEGACY_VIEWS, key) ? { ...LEGACY_VIEWS[key as LegacyPanelTab] } : null;
}

const hasOwn = (o: object, k: string): boolean => Object.hasOwn(o, k);

// A request (legacy key or parts) as the new parts; unknown tab keys are dropped. role passes through.
export function panelView(arg: PanelViewArg | undefined): PanelView {
  if (!arg) return {};
  if (typeof arg === "string") return legacyView(arg) ?? {};
  const { tab, mode, section, role } = arg;
  const out: PanelView = {};
  if (role) out.role = role;
  const lv = tab && hasOwn(LEGACY_VIEWS, tab) ? LEGACY_VIEWS[tab as LegacyPanelTab] : null;
  if (tab === "work") out.tab = tab;
  else if (lv) {
    out.tab = lv.tab;
    // a legacy tab key carries its own mode and section; explicit parts win
    if (lv.mode) out.mode = lv.mode;
    if (lv.section) out.section = lv.section;
  }
  if (mode) out.mode = mode;
  if (section) out.section = section;
  return out;
}
