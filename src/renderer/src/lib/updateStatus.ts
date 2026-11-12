// What «Check for updates» last found (Settings → General and About read the same answer). The check itself is main's
// (updateCheck.ts); here: the state, the once-a-day rule of the automatic check, and a hook to read it.
import { useSyncExternalStore } from "react";
import type { UpdateCheckResult } from "../../../shared/contracts";

export type UpdateState = { status: "idle" } | { status: "checking" } | UpdateCheckResult;

export const UPDATE_CHECKED_KEY = "canvastty:update-checked";
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

let state: UpdateState = { status: "idle" };
const listeners = new Set<() => void>();
const set = (next: UpdateState): void => { state = next; for (const l of listeners) l(); };

export function useUpdateState(): UpdateState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state);
}

/** The person asked (or the daily check is due): one request, no download. */
export async function runUpdateCheck(): Promise<void> {
  if (state.status === "checking") return;
  set({ status: "checking" });
  try {
    set(await window.canvasTTY.updates.check());
  } catch {
    set({ status: "failed" });
  }
  try { localStorage.setItem(UPDATE_CHECKED_KEY, String(Date.now())); } catch { /* the next start asks again */ }
}

/** Pure: is the automatic check due (never checked, or the last one was a day ago or more)? */
export const updateCheckDue = (lastChecked: number | null, now: number): boolean =>
  lastChecked === null || !Number.isFinite(lastChecked) || now - lastChecked >= UPDATE_INTERVAL_MS || lastChecked > now;

export function runUpdateCheckIfDue(): void {
  let last: number | null = null;
  try { const raw = localStorage.getItem(UPDATE_CHECKED_KEY); last = raw === null ? null : Number(raw); } catch { /* treated as never */ }
  if (updateCheckDue(last, Date.now())) void runUpdateCheck();
}
