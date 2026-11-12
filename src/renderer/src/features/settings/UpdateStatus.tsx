// «Check for updates»: the answer line («Version X is available · Open the page», «You have the latest version») and the
// button. Nothing is downloaded or installed: «Open the page» opens the release page in the browser.
import type { LocaleId } from "../../../../shared/contracts";
import { t } from "../../lib/i18n";
import { runUpdateCheck, useUpdateState } from "../../lib/updateStatus";

/** quiet: only a found update is told (the General screen); otherwise every answer is. */
export function UpdateStatusLine({ locale, quiet = false }: { locale: LocaleId; quiet?: boolean }): React.JSX.Element | null {
  const state = useUpdateState();
  if (state.status === "idle" || (quiet && state.status !== "available")) return null;
  if (state.status === "checking") return <p className="update-status" role="status" data-update-status="checking">{t(locale, "checkingUpdates")}</p>;
  if (state.status === "latest") return <p className="update-status" role="status" data-update-status="latest">{t(locale, "updateLatest")}</p>;
  if (state.status === "failed") return <p className="update-status update-status--failed" role="status" data-update-status="failed">{t(locale, "updateFailed")}</p>;
  const url = state.url;
  return (
    <p className="update-status update-status--available" role="status" data-update-status="available">
      <span>{t(locale, "updateAvailable").replace("{version}", state.version)}</span>
      <span aria-hidden="true"> · </span>
      <button type="button" className="update-status__open" onClick={() => void window.canvasTTY.external.openUrl(url)}>{t(locale, "updateOpenPage")}</button>
    </p>
  );
}

export function CheckUpdatesButton({ locale }: { locale: LocaleId }): React.JSX.Element {
  const state = useUpdateState();
  return (
    <button type="button" className="about-settings__check" data-update-check disabled={state.status === "checking"} onClick={() => void runUpdateCheck()}>
      {state.status === "checking" ? t(locale, "checkingUpdates") : t(locale, "checkUpdates")}
    </button>
  );
}
