// A jargon word explained in place: dotted underline, the explanation on hover (title) and read with the word on focus
// (aria-label). The explanations are the i18n keys orchTerm_<id>.
import type { LocaleId } from "../../../shared/contracts";
import { t } from "../lib/i18n";

export function Term({ locale, id, hint, children }: { locale: LocaleId; id: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  const text = hint ?? t(locale, `orchTerm_${id}` as never);
  return <span className="orch-term" tabIndex={0} title={text} aria-label={typeof children === "string" ? `${children}: ${text}` : text} data-term={id}>{children}</span>;
}
