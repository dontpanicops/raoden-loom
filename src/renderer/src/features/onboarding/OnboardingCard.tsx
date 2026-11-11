import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentProviderId, LocaleId } from "../../../../shared/contracts";
import { ProviderIcon } from "../../components/ProviderIcon";
import { UiIcon } from "../../components/UiIcon";
import { t } from "../../lib/i18n";
import { AGENT_PROVIDERS, PROVIDERS } from "../../lib/providers";
import { onboardingSteps, onboardingVisible, type OnboardingPlace } from "./onboardingSteps";

interface Props {
  locale: LocaleId;
  dismissed: boolean;
  pinned?: boolean; // brought back from the palette: shown although every step is done
  hasTerminal: boolean;
  linked: boolean;
  place: OnboardingPlace | null;
  wheelKey: string | null;
  onNewTerminal(): void;
  onDismiss(): void;
}

// The repository's own getting-started page; the docs name no per-CLI install commands.
export const installUrl = (locale: LocaleId): string =>
  `https://github.com/dontpanicops/raoden-loom/blob/main/docs/${locale === "ru" ? "getting-started.ru.md" : "getting-started.md"}`;

// "Getting started": a level-3 card in the canvas overlays, placed clear of HOME and the minimap (onboardingPlacement).
export function OnboardingCard({ locale, dismissed, pinned = false, hasTerminal, linked, place, wheelKey, onNewTerminal, onDismiss }: Props): React.JSX.Element | null {
  const [found, setFound] = useState<AgentProviderId[]>([]);
  const opened = useRef(false);
  if (hasTerminal) opened.current = true; // closing the terminal again does not untick the step
  const check = useCallback(() => {
    window.canvasTTY.providers.available().then((list: AgentProviderId[]) => setFound(list)).catch(() => setFound([]));
  }, []);
  useEffect(check, [check]);
  const steps = onboardingSteps({ terminalOpened: opened.current, cliFound: found.length, linked });
  if (!place || !(pinned && !dismissed) && !onboardingVisible(dismissed, steps)) return null;
  const done = (id: string): boolean => steps.find((s) => s.id === id)?.done ?? false;
  const current = steps.find((s) => !s.done)?.id;
  const row = (n: number, id: "terminal" | "cli" | "link", title: string, hint: string, extra?: React.ReactNode, action?: React.ReactNode): React.JSX.Element => (
    <li className={`onboarding__step ${done(id) ? "onboarding__step--done" : ""} ${current === id ? "onboarding__step--current" : ""}`} data-onboarding-step={id} data-done={done(id) ? "yes" : "no"}>
      <span className="onboarding__num" aria-hidden="true">{done(id) ? <UiIcon name="status-done" size="1.4em" /> : n}</span>
      <span className="onboarding__text">
        <strong>{title}{done(id) ? <span className="onboarding__state">{t(locale, "onboardingStepDone")}</span> : <span className="sr-only"> ({t(locale, "onboardingStepTodo")})</span>}</strong>
        <small>{hint}</small>
        {extra}
      </span>
      {action && <span className="onboarding__action">{action}</span>}
    </li>
  );
  return (
    <>
    {place.guide && (
      <aside className="canvas-guide surface-3" style={{ left: place.guide.left, top: place.guide.top }} data-interactive="true" aria-label={t(locale, "guideTitle")}>
        <span className="canvas-guide__title">{t(locale, "guideTitle")}</span>
        <div><kbd>{t(locale, "guideDrag")}</kbd><span>{t(locale, "guideDragText")}</span></div>
        <div><kbd>{wheelKey ? `${wheelKey} + ${t(locale, "guideWheel")}` : t(locale, "guideWheel")}</kbd><span>{t(locale, "guideZoomText")}</span></div>
        <div><kbd>{t(locale, "guideRmb")}</kbd><span>{t(locale, "guideRmbText")}</span></div>
        <div><kbd>Home</kbd><span>{t(locale, "guideHomeText")}</span></div>
      </aside>
    )}
    <section className="onboarding surface-3" style={{ left: place.left, top: place.top, width: place.width, maxHeight: place.maxHeight, "--ob-k": place.width < 520 ? 0.88 : 1 } as React.CSSProperties} data-interactive="true" aria-label={t(locale, "onboardingTitle")} data-onboarding>
      <span className="onboarding__eyebrow">{t(locale, "onboardingTitle")}</span>
      <h2>{t(locale, "onboardingHeading")}</h2>
      <p>{t(locale, "onboardingIntro")}</p>
      <ol>
        {row(1, "terminal", t(locale, "onboardingStepTerminal"), t(locale, "onboardingStepTerminalHint"), undefined,
          !done("terminal") && <button type="button" className="onboarding__primary" onClick={onNewTerminal}>{t(locale, "onboardingNewTerminal")}</button>)}
        {row(2, "cli", t(locale, "onboardingStepCli"),
          t(locale, "onboardingCliFound").replace("{n}", String(found.length)).replace("{total}", String(AGENT_PROVIDERS.length)),
          <ul className="onboarding__clis">
            {AGENT_PROVIDERS.map((id) => (
              <li key={id} data-found={found.includes(id) ? "yes" : "no"}><ProviderIcon provider={id} size="small" />{PROVIDERS[id].label}</li>
            ))}
          </ul>,
          <>
            {found.length === 0 && <button type="button" onClick={() => void window.canvasTTY.external.openUrl(installUrl(locale))}>{t(locale, "howToInstall")}</button>}
            <button type="button" className="onboarding__quiet" onClick={check}>{t(locale, "onboardingRecheck")}</button>
          </>)}
        {row(3, "link", t(locale, "onboardingStepLink"), t(locale, "onboardingStepLinkHint"))}
      </ol>
      <footer>
        <span>{t(locale, "onboardingReturnHint")}</span>
        <button type="button" className="onboarding__quiet" onClick={onDismiss}>{t(locale, "onboardingHide")}</button>
      </footer>
    </section>
    </>
  );
}
