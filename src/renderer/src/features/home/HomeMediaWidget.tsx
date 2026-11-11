import { useState } from "react";
import type { LocaleId, MediaFit } from "../../../../shared/contracts";
import { UiIcon } from "../../components/UiIcon";
import { t } from "../../lib/i18n";

export interface HomeMediaWidgetProps {
  locale: LocaleId;
  dataUrl: string | null;
  fit: MediaFit;
  onRequestMedia(): Promise<void>;
  onRemoveMedia(): Promise<void>;
}

export function HomeMediaWidget({
  locale,
  dataUrl,
  fit,
  onRequestMedia,
  onRemoveMedia
}: HomeMediaWidgetProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const label = dataUrl ? t(locale, "changeMedia") : t(locale, "addMedia");
  const backgroundStyle = dataUrl ? {
    backgroundImage: `url(${dataUrl})`,
    backgroundSize: fit,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center"
  } : undefined;

  return (
    <section className={`tile mini-media ${dataUrl ? "mini-media--custom" : ""}`} aria-label={label}>
      <button
        className="mini-media__pick"
        type="button"
        disabled={busy}
        onClick={() => void run(onRequestMedia)}
        aria-label={label}
        style={backgroundStyle}
      >
        {!dataUrl && <span className="mini-media__empty-icon"><UiIcon name="image-plus" size={16} /><span>{t(locale, "mediaPick")}</span></span>}
      </button>

      {dataUrl && (
        <button
          className="mini-media__remove"
          type="button"
          disabled={busy}
          onClick={() => void run(onRemoveMedia)}
          aria-label={t(locale, "removeMedia")}
          title={t(locale, "removeMedia")}
        >
          <UiIcon name="trash" size={18} />
        </button>
      )}
    </section>
  );
}
