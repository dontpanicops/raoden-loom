// First run (UX audit Н12): the steps are ticked by facts, never by clicks.
export interface OnboardingFacts {
  terminalOpened: boolean; // a terminal has been open in this window
  cliFound: number; // agent CLIs main finds on this machine
  linked: boolean; // an orchestration link exists
}

export type OnboardingStepId = "terminal" | "cli" | "link";
export interface OnboardingStep { id: OnboardingStepId; done: boolean }

export function onboardingSteps(f: OnboardingFacts): OnboardingStep[] {
  return [
    { id: "terminal", done: f.terminalOpened },
    { id: "cli", done: f.cliFound > 0 },
    { id: "link", done: f.linked }
  ];
}

// Shown until the user hides it or every step is done.
export function onboardingVisible(dismissed: boolean, steps: readonly OnboardingStep[]): boolean {
  return !dismissed && steps.some((s) => !s.done);
}

export interface Rect { left: number; top: number; right: number; bottom: number }
export const ONBOARDING_SIZE = { width: 400, height: 370 };

// The first-run card never covers HOME or the minimap: right of HOME (below the minimap's row) when there is room, else
// below HOME, else it is not shown (a small window, or a camera moved away from HOME: nothing is covered to show it).
export function onboardingPlacement(home: Rect, view: { width: number; height: number }): { left: number; top: number } | null {
  const { width, height } = ONBOARDING_SIZE;
  const gap = 24;
  // only at the home view: HOME wholly in sight (a camera moved away shows other work, which the card would cover)
  if (home.left < 0 || home.top < 0 || home.right > view.width || home.bottom > view.height) return null;
  const MINIMAP_ROW = 200; // the corner slots and the minimap end above this
  if (home.right + gap + width <= view.width - 18 && MINIMAP_ROW + height <= view.height - 18) return { left: home.right + gap, top: MINIMAP_ROW };
  if (home.bottom + gap + height <= view.height - 18) return { left: Math.max(18, home.left), top: home.bottom + gap };
  return null;
}
