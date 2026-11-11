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
// Mock 04: 560 wide (700 at --ui-scale 1.25). The card gives way to the room HOME leaves, down to 400, then goes below HOME.
export const ONBOARDING_WIDTH = 560;
const ONBOARDING_MIN = { width: 400, height: 300 };
export interface OnboardingPlace { left: number; top: number; width: number; maxHeight: number; guide: { left: number; top: number } | null }

// The first-run card never covers HOME or the minimap: right of HOME (below the minimap's row) when there is room, else
// below HOME, else it is not shown (a small window, or a camera moved away from HOME: nothing is covered to show it).
// The "canvas controls" block (mock 04) sits under HOME, on the left, when the card is on its right.
function guideBelow(home: Rect, view: { width: number; height: number }): { left: number; top: number } | null {
  const top = home.bottom + 24;
  return top + 160 <= view.height - 18 ? { left: Math.max(18, home.left), top } : null;
}

// Taller than the room: the card scrolls (maxHeight).
export function onboardingPlacement(home: Rect, view: { width: number; height: number }, uiScale = 1): OnboardingPlace | null {
  const width = Math.round(ONBOARDING_WIDTH * (uiScale >= 1.25 ? 1.25 : 1));
  const gap = 24;
  // only at the home view: HOME wholly in sight (a camera moved away shows other work, which the card would cover)
  if (home.left < 0 || home.top < 0 || home.right > view.width || home.bottom > view.height) return null;
  const MINIMAP_ROW = 200; // the corner slots and the minimap end above this
  const room = view.width - 18 - (home.right + gap);
  if (room >= ONBOARDING_MIN.width && MINIMAP_ROW + ONBOARDING_MIN.height <= view.height - 18) {
    return { left: home.right + gap, top: MINIMAP_ROW, width: Math.min(width, room), maxHeight: view.height - 18 - MINIMAP_ROW, guide: guideBelow(home, view) };
  }
  const left = Math.max(18, home.left);
  const top = home.bottom + gap;
  if (top + ONBOARDING_MIN.height <= view.height - 18 && view.width - 18 - left >= ONBOARDING_MIN.width) {
    return { left, top, width: Math.min(width, view.width - 18 - left), maxHeight: view.height - 18 - top, guide: null };
  }
  return null;
}
