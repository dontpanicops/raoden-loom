import type { LocaleId } from "../../../../shared/contracts";
import { Dialog } from "../../components/Dialog";
import { UiIcon } from "../../components/UiIcon";
import { t } from "../../lib/i18n";

interface TerminalLinkDialogProps {
  locale: LocaleId;
  url: string | null;
  onClose(): void;
  onOpenCanvas(url: string): void;
  onOpenExternal(url: string): void;
}

export function TerminalLinkDialog({
  locale,
  url,
  onClose,
  onOpenCanvas,
  onOpenExternal
}: TerminalLinkDialogProps): React.JSX.Element | null {
  if (!url) return null;

  return (
    <Dialog label={t(locale, "terminalLinkTitle")} onClose={onClose} locale={locale} className="terminal-link-dialog" backdropClassName="terminal-link-dialog__backdrop">
      <div className="orch-form">
        <p className="orch-hint">{t(locale, "terminalLinkDescription")}</p>
        <code className="terminal-link-dialog__url" title={url}>{url}</code>
        <div className="orch-form__actions">
          <button type="button" className="orch-cancel" onClick={() => onOpenExternal(url)}>
            <UiIcon name="browser" size={16} />
            {t(locale, "terminalLinkExternal")}
          </button>
          <button type="button" className="orch-primary" onClick={() => onOpenCanvas(url)}>
            <UiIcon name="app-window" size={16} />
            {t(locale, "terminalLinkCanvas")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
