import type { LocaleId, ProviderId, SessionStatus } from "../../../shared/contracts";
import type { UiIconName } from "../components/UiIcon";
import { t, type TranslationKey } from "./i18n";

const STATUS_KEYS: Record<SessionStatus, TranslationKey> = {
  idle: "statusIdle",
  working: "statusWorking",
  needs_approval: "statusNeedsApproval",
  unavailable: "statusUnavailable",
  done: "statusDone",
  failed: "statusFailed"
};

const STATUS_ICONS: Record<SessionStatus, UiIconName | null> = {
  idle: null,
  working: "working",
  needs_approval: "bell",
  unavailable: null,
  done: "done",
  failed: "error"
};

export function sessionStatusLabel(locale: LocaleId, status: SessionStatus, _provider?: ProviderId): string {
  return t(locale, STATUS_KEYS[status]);
}

export function sessionStatusIcon(status: SessionStatus): UiIconName | null {
  return STATUS_ICONS[status];
}

// The long form a terminal card's footer says (mock-up 06): the exit code and what to do, where the short label (HOME, summary) says only the state.
export function sessionCardLabel(locale: LocaleId, status: SessionStatus, exitCode: number | null): string {
  if (status === "needs_approval") return t(locale, "statusNeedsApprovalCard");
  if (exitCode !== null && (status === "done" || status === "failed")) return t(locale, status === "done" ? "statusExitedCode" : "statusFailedCode").replace("{code}", String(exitCode));
  return sessionStatusLabel(locale, status);
}
