// A jargon word explained in place: dotted underline, the explanation on hover (title), shown under the word on keyboard
// focus and read with the word (aria-label). A button so it is reachable by Tab. The explanations are the i18n keys orchTerm_<id>.
import type { LocaleId } from "../../../shared/contracts";
import { t } from "../lib/i18n";

export function Term({ locale, id, hint, children }: { locale: LocaleId; id: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  const text = hint ?? t(locale, `orchTerm_${id}` as never);
  return <button type="button" className="orch-term" title={text} data-hint={text} aria-label={typeof children === "string" ? `${children}: ${text}` : text} data-term={id}>{children}</button>;
}
