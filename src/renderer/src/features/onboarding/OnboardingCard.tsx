import { useCallback, useEffect, useRef, useState } from "react";
import { PROVIDER_LABELS, type AgentProviderId, type LocaleId } from "../../../../shared/contracts";
import { UiIcon } from "../../components/UiIcon";
import { t } from "../../lib/i18n";
import { onboardingSteps, onboardingVisible } from "./onboardingSteps";

// The 9 agent CLIs: every provider but the plain terminal (contracts.ts).
const CLI_TOTAL = Object.keys(PROVIDER_LABELS).length - 1;

interface Props {
  locale: LocaleId;
  dismissed: boolean;
  hasTerminal: boolean;
  linked: boolean;
  place: { left: number; top: number } | null;
  onNewTerminal(): void;
  onDismiss(): void;
}

// "Getting started": a level-3 card in the canvas overlays, placed clear of HOME and the minimap (onboardingPlacement).
export function OnboardingCard({ locale, dismissed, hasTerminal, linked, place, onNewTerminal, onDismiss }: Props): React.JSX.Element | null {
  const [cliFound, setCliFound] = useState(0);
  const opened = useRef(false);
  if (hasTerminal) opened.current = true; // closing the terminal again does not untick the step
  const check = useCallback(() => {
    window.canvasTTY.providers.available().then((list: AgentProviderId[]) => setCliFound(list.length)).catch(() => setCliFound(0));
  }, []);
  useEffect(check, [check]);
  const steps = onboardingSteps({ terminalOpened: opened.current, cliFound, linked });
  if (!place || !onboardingVisible(dismissed, steps)) return null;
  const done = (id: string): boolean => steps.find((s) => s.id === id)?.done ?? false;
  const row = (id: "terminal" | "cli" | "link", title: string, hint: string, action?: React.ReactNode): React.JSX.Element => (
    <li className={`onboarding__step ${done(id) ? "onboarding__step--done" : ""}`} data-onboarding-step={id} data-done={done(id) ? "yes" : "no"}>
      <UiIcon name={done(id) ? "status-done" : "status-idle"} size={18} />
      <span className="onboarding__text">
        <strong>{title}{done(id) ? <span className="onboarding__state">{t(locale, "onboardingStepDone")}</span> : <span className="sr-only"> ({t(locale, "onboardingStepTodo")})</span>}</strong>
        <small>{hint}</small>
      </span>
      {action}
    </li>
  );
  return (
    <section className="onboarding surface-3" style={{ left: place.left, top: place.top }} data-interactive="true" aria-label={t(locale, "onboardingTitle")} data-onboarding>
      <h2>{t(locale, "onboardingTitle")}</h2>
      <p>{t(locale, "onboardingIntro")}</p>
      <ol>
        {row("terminal", t(locale, "onboardingStepTerminal"), t(locale, "onboardingStepTerminalHint"),
          !done("terminal") && <button type="button" onClick={onNewTerminal}>{t(locale, "onboardingNewTerminal")}</button>)}
        {row("cli", t(locale, "onboardingStepCli"), t(locale, "onboardingCliFound").replace("{n}", String(cliFound)).replace("{total}", String(CLI_TOTAL)),
          <button type="button" onClick={check}>{t(locale, "onboardingRecheck")}</button>)}
        {row("link", t(locale, "onboardingStepLink"), t(locale, "onboardingStepLinkHint"))}
      </ol>
      <footer><button type="button" onClick={onDismiss}>{t(locale, "onboardingHide")}</button></footer>
    </section>
  );
}
