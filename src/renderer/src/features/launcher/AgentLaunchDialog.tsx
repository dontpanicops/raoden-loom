import { useEffect, useState } from "react";
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

interface AgentLaunchDialogProps {
  provider: AgentProviderId | null;
  settings: AppSettings;
  onClose(): void;
  onAcknowledge(provider: AgentProviderId): Promise<void>;
  onLaunch(provider: AgentProviderId, profile: LaunchProfileId, cwd: string): Promise<void>;
}

export function AgentLaunchDialog({
  provider,
  settings,
  onClose,
  onAcknowledge,
  onLaunch
}: AgentLaunchDialogProps): React.JSX.Element | null {
  const [profile, setProfile] = useState<LaunchProfileId>("normal");
  const [cwd, setCwd] = useState(settings.lastDirectory);
  const [confirmDanger, setConfirmDanger] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locale = settings.locale;

  useEffect(() => {
    if (!provider) return;
    setProfile("normal");
    setCwd(settings.lastDirectory);
    setConfirmDanger(false);
    setError(null);
  }, [provider, settings.lastDirectory]);

  if (!provider) return null;

  const acknowledged = settings.acknowledgedDangerousProfiles.includes(provider);
  const dangerKey = PROVIDERS[provider].dangerKey!;

  const chooseDirectory = async (): Promise<void> => {
    const selected = await window.canvasTTY.dialog.pickDirectory(cwd);
    if (selected) {
      setCwd(selected);
      setError(null);
    }
  };

  const pasteDirectory = async (): Promise<void> => {
    try {
      const path = directoryPathFromClipboard(await window.canvasTTY.clipboard.readText());
      if (!path) {
        setError(t(locale, "clipboardPathMissing"));
        return;
      }
      setCwd(path);
      setError(null);
    } catch {
      setError(t(locale, "clipboardReadFailed"));
    }
  };

  const submit = async (): Promise<void> => {
    if (profile === "yolo" && !acknowledged && !confirmDanger) {
      setConfirmDanger(true);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (profile === "yolo" && !acknowledged) await onAcknowledge(provider);
      await onLaunch(provider, profile, cwd);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t(locale, "launchFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog label={`${t(locale, "launchAgent")}: ${PROVIDERS[provider].label}`} onClose={onClose} locale={locale} className="agent-launch-dialog">
      <form className="orch-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="launch-dialog__top">
          <div className="launch-dialog__provider"><ProviderIcon provider={provider} size="large" /></div>
          <div className="folder-field">
            <button className="folder-field__picker" type="button" onClick={() => void chooseDirectory()}>
              <UiIcon name="folder" size={28} />
              <span className="folder-field__copy">
                <small>{t(locale, "projectFolder")}</small>
                <strong title={cwd}>{cwd}</strong>
              </span>
              <UiIcon name="chevron" size={20} />
            </button>
            <button className="folder-field__paste" type="button" onClick={() => void pasteDirectory()} title={t(locale, "pasteProjectPath")} aria-label={t(locale, "pasteProjectPath")}>
              <UiIcon name="copy" size={20} />
              <span>{t(locale, "pastePath")}</span>
            </button>
          </div>
        </div>

        <div className="profile-row" role="group">
          <button className={profile === "normal" ? "profile-button profile-button--active" : "profile-button"} type="button" aria-pressed={profile === "normal"} onClick={() => {
            setProfile("normal");
            setConfirmDanger(false);
          }}>{t(locale, "normal")}</button>
          <button className={profile === "yolo" ? "profile-button profile-button--active" : "profile-button"} type="button" aria-pressed={profile === "yolo"} onClick={() => {
            setProfile("yolo");
            setConfirmDanger(false);
          }}>{t(locale, "yolo")}</button>
        </div>

        {profile === "yolo" && (
          <div className={`danger-note ${confirmDanger ? "danger-note--confirm" : ""}`}>
            <strong>{t(locale, dangerKey)}</strong>
            {!acknowledged && <span>{confirmDanger ? t(locale, "dangerousFirstUse") : t(locale, "confirmLaunch")}</span>}
          </div>
        )}
        {error && <div className="dialog-error" role="alert">{error}</div>}
        <div className="orch-form__actions">
          <button type="button" className="orch-cancel" onClick={onClose}>{t(locale, "cancel")}</button>
          <button type="submit" className="orch-primary" disabled={busy}>{busy ? <span className="launch-submit__busy" /> : t(locale, "launch")}</button>
        </div>
      </form>
    </Dialog>
  );
}
