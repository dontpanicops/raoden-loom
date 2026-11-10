// Tab inside a modal dialog (R1): where focus goes on Tab / Shift+Tab among `count` focusable items.
// `index` is the focused item (-1 when focus is outside the list). null = leave it to the browser.
export function trapTarget(count: number, index: number, shift: boolean): number | null {
  if (count === 0) return -1;
  if (index < 0) return shift ? count - 1 : 0;
  if (shift && index === 0) return count - 1;
  if (!shift && index === count - 1) return 0;
  return null;
}

export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
