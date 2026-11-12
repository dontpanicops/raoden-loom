import appManifest from "../../../../../package.json";
import type { LocaleId } from "../../../../shared/contracts";
import { t, type TranslationKey } from "../../lib/i18n";
import { AppMark } from "../../components/AppMark";
import { CheckUpdatesButton, UpdateStatusLine } from "./UpdateStatus";

const FAQ: ReadonlyArray<readonly [TranslationKey, TranslationKey]> = [
  ["aboutFaqStatusQuestion", "aboutFaqStatusAnswer"],
  ["aboutFaqDataQuestion", "aboutFaqDataAnswer"],
  ["aboutFaqDisableQuestion", "aboutFaqDisableAnswer"],
  ["aboutFaqProviderTrustQuestion", "aboutFaqProviderTrustAnswer"],
  ["aboutFaqPluginHooksQuestion", "aboutFaqPluginHooksAnswer"]
];

const REPO = "https://github.com/dontpanicops/raoden-loom";
const LINKS: ReadonlyArray<readonly [TranslationKey, string]> = [
  ["aboutLinkChangelog", `${REPO}/releases`],
  ["aboutLinkLicenses", `${REPO}/blob/main/LICENSE`],
  ["aboutLinkIssues", `${REPO}/issues`]
];

export function AboutSettings({ locale }: { locale: LocaleId }): React.JSX.Element {
  const channel = import.meta.env.DEV ? "DEV" : "RELEASE";
  return (
    <section className="about-settings">
      <div className="about-settings__top">
      <header className="about-settings__header">
        <span className="about-settings__icon"><AppMark size={28} /></span>
        <span className="about-settings__name">
          <strong>Raoden Loom</strong>
          <small>{t(locale, "aboutVersion")} {appManifest.version} · macOS · {channel}</small>
        </span>
      </header>
      <CheckUpdatesButton locale={locale} />
      </div>
      <UpdateStatusLine locale={locale} />

      <div className="about-settings__faq">
        <h3>{t(locale, "aboutFaq")}</h3>
        {FAQ.map(([question, answer]) => (
          <details key={question}>
            <summary>{t(locale, question)}</summary>
            <p>{t(locale, answer)}</p>
          </details>
        ))}
      </div>

      <nav className="about-settings__links">
        {LINKS.map(([label, url]) => (
          <button key={label} type="button" onClick={() => void window.canvasTTY.external.openUrl(url)}>{t(locale, label)}</button>
        ))}
      </nav>
    </section>
  );
}
