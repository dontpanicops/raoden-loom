import type { LocaleId } from "../../../../shared/contracts";
import { Dialog } from "../../components/Dialog";
import { t } from "../../lib/i18n";

interface TerminalLinkDialogProps {
  locale: LocaleId;
  url: string | null;
  anchor?: DOMRect | null;
  onClose(): void;
  onOpenCanvas(url: string): void;
  onOpenExternal(url: string): void;
}

export function TerminalLinkDialog({
  locale,
  url,
  anchor = null,
  onClose,
  onOpenCanvas,
  onOpenExternal
}: TerminalLinkDialogProps): React.JSX.Element | null {
  if (!url) return null;

  return (
    <Dialog label={t(locale, "terminalLinkTitle")} onClose={onClose} locale={locale} anchor={anchor} width={340} className="terminal-link-dialog" backdropClassName="terminal-link-dialog__backdrop">
      <div className="orch-form">
        <code className="terminal-link-dialog__url" title={url}>{url}</code>
        <div className="terminal-link-dialog__actions">
          <button type="button" className="orch-primary" onClick={() => onOpenCanvas(url)}>
            {t(locale, "terminalLinkCanvas")}
          </button>
          <button type="button" className="orch-cancel" onClick={() => onOpenExternal(url)}>
            {t(locale, "terminalLinkExternal")}
          </button>
          <button type="button" className="terminal-link-dialog__copy" onClick={() => { window.canvasTTY.clipboard.writeText(url); onClose(); }}>
            {t(locale, "terminalLinkCopy")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
