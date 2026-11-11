import { useCallback, useEffect, useState } from "react";
import type {
  AgentProviderId,
  AppSettings,
  LaunchProfileId
} from "../../../../shared/contracts";
import { Dialog } from "../../components/Dialog";
import { ProviderIcon } from "../../components/ProviderIcon";
import { UiIcon } from "../../components/UiIcon";
import { t } from "../../lib/i18n";
import { PROVIDERS } from "../../lib/providers";
import { directoryPathFromClipboard } from "../../lib/directoryPathFromClipboard";
import { installUrl } from "../onboarding/OnboardingCard";

interface AgentLaunchDialogProps {
  provider: AgentProviderId | null;
  settings: AppSettings;
  /** The dock button the card was opened from (mock 14: a popover, no scrim); none from the menus: a dialog. */
  anchor: DOMRect | null;
  /** Folders of the sessions already open, newest first. */
  recentDirectories: readonly string[];
  onClose(): void;
  onRemoveFromDock(provider: AgentProviderId): void;
  onLaunch(provider: AgentProviderId, profile: LaunchProfileId, cwd: string): Promise<void>;
}

const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
// The product's own name where the button's label is shorter (mock 14: "Claude Code").
const cardName = (provider: AgentProviderId): string => (provider === "claude" ? "Claude Code" : PROVIDERS[provider].label);

export function AgentLaunchDialog({
  provider,
  settings,
  anchor,
  recentDirectories,
  onClose,
  onRemoveFromDock,
  onLaunch
}: AgentLaunchDialogProps): React.JSX.Element | null {
  const [profile, setProfile] = useState<LaunchProfileId>("normal");
  const [cwd, setCwd] = useState(settings.lastDirectory);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the CLIs main finds in PATH; null until asked (the card shows the launch form meanwhile)
  const [found, setFound] = useState<AgentProviderId[] | null>(null);
  const locale = settings.locale;

  const check = useCallback(() => {
    window.canvasTTY.providers.available().then((list: AgentProviderId[]) => setFound(list)).catch(() => setFound(null));
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a newly opened card starts from the defaults; the folder is read once per opening
  useEffect(() => {
    if (!provider) return;
    setProfile("normal");
    setCwd(settings.lastDirectory);
    setUnderstood(false);
    setError(null);
    check();
  }, [provider, check]);

  if (!provider) return null;

  const missing = found !== null && !found.includes(provider);
  const name = cardName(provider);
  const mark = <span className="launch-card__mark"><ProviderIcon provider={provider} size="large" /></span>;

  if (missing) {
    return (
      <Dialog label={name} sub={t(locale, "launchMissing")} lead={mark} onClose={onClose} locale={locale} anchor={anchor} className="agent-launch-dialog agent-launch-dialog--missing">
        <div className="orch-form launch-card" data-launch-missing>
          <p className="launch-card__text">{t(locale, "launchMissingText").replace("{name}", name)}</p>
          <div className="launch-card__row launch-card__row--buttons">
            <button type="button" className="orch-primary" data-autofocus onClick={() => void window.canvasTTY.external.openUrl(installUrl(locale))}>{t(locale, "howToInstall")}</button>
            <button type="button" className="launch-card__btn" onClick={check}>{t(locale, "onboardingRecheck")}</button>
          </div>
          <button type="button" className="launch-card__link" onClick={() => { onRemoveFromDock(provider); onClose(); }}>{t(locale, "launchRemoveFromDock")}</button>
        </div>
      </Dialog>
    );
  }

  const chooseDirectory = async (): Promise<void> => {
    const selected = await window.canvasTTY.dialog.pickDirectory(cwd);
    if (selected) {
      setCwd(selected);
      setError(null);
    }
  };

  // a pasted path goes through the same clean-up as before: file-manager lists, quotes, file:// links
  const pastePath = (event: React.ClipboardEvent<HTMLInputElement>): void => {
    const path = directoryPathFromClipboard(event.clipboardData.getData("text/plain"));
    if (!path) return;
    event.preventDefault();
    setCwd(path);
    setError(null);
  };

  const yolo = profile === "yolo";
  const submit = async (): Promise<void> => {
    if (yolo && !understood) return;
    setBusy(true);
    setError(null);
    try {
      await onLaunch(provider, profile, cwd);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t(locale, "launchFailed"));
    } finally {
      setBusy(false);
    }
  };

  const choose = (next: LaunchProfileId): void => {
    setProfile(next);
    setUnderstood(false);
  };
  const recent = recentDirectories.filter((dir) => dir !== cwd).slice(0, 3);

  return (
    <Dialog label={name} sub={t(locale, "launchNewSession")} lead={mark} onClose={onClose} locale={locale} anchor={anchor} className="agent-launch-dialog">
      <form className="orch-form launch-card" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="launch-card__field">
          <label htmlFor="launch-cwd">{t(locale, "projectFolder")}</label>
          <div className="launch-card__row">
            <input id="launch-cwd" className="launch-card__path" value={cwd} title={cwd} spellCheck={false} onChange={(event) => { setCwd(event.currentTarget.value); setError(null); }} onPaste={pastePath} />
            <button className="launch-card__btn" type="button" onClick={() => void chooseDirectory()}>{t(locale, "launchChoose")}</button>
          </div>
          {recent.length > 0 && (
            <p className="launch-card__hint launch-card__recent">{t(locale, "launchRecent")}: {recent.map((dir, i) => (
              <span key={dir}>{i > 0 && " · "}<button type="button" title={dir} onClick={() => setCwd(dir)}>{baseName(dir)}</button></span>
            ))}</p>
          )}
        </div>

        <div className="launch-card__field">
          <span id="launch-profile">{t(locale, "launchProfile")}</span>
          <div className="profile-row" role="group" aria-labelledby="launch-profile">
            <button className={profile === "normal" ? "profile-button profile-button--active" : "profile-button"} type="button" data-autofocus={profile === "normal" ? "" : undefined} aria-pressed={profile === "normal"} onClick={() => choose("normal")}>{t(locale, "normal")}</button>
            <button className={yolo ? "profile-button profile-button--active profile-button--danger" : "profile-button"} type="button" data-autofocus={yolo ? "" : undefined} aria-pressed={yolo} onClick={() => choose("yolo")}>{t(locale, "yolo")}</button>
          </div>
          {!yolo && <p className="launch-card__hint">{t(locale, "launchHintNormal")}</p>}
        </div>

        {yolo && (
          <div className="danger-note" title={t(locale, PROVIDERS[provider].dangerKey!)}>
            <p><UiIcon name="status-failed" size={16} />{t(locale, "launchYoloWarn")}</p>
            <label className="danger-note__ack"><input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.currentTarget.checked)} />{t(locale, "launchYoloAck")}</label>
          </div>
        )}
        {error && <div className="dialog-error" role="alert">{error}</div>}
        <button type="submit" className="orch-primary launch-card__go" disabled={busy || (yolo && !understood)}>{busy ? <span className="launch-submit__busy" /> : t(locale, yolo ? "launchYoloGo" : "launch")}</button>
        {yolo && <p className="launch-card__hint">{t(locale, "launchYoloNote")}</p>}
      </form>
    </Dialog>
  );
}
