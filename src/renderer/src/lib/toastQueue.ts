export type ToastKind = "success" | "info" | "error" | "waiting";

export interface ToastAction {
  label: string;
  run(): void;
}

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

export type ToastEvent =
  | { type: "push"; toast: ToastItem }
  | { type: "dismiss"; id: number };

export const MAX_TOASTS = 3;
export const AUTO_DISMISS_MS = 4_000;

/** Success and info go away on their own; an error or a "waiting for you" stays until the person acts or closes it. */
export function autoDismissMs(kind: ToastKind): number | null {
  return kind === "success" || kind === "info" ? AUTO_DISMISS_MS : null;
}

/** The queue is oldest first, at most MAX_TOASTS; a repeat of a visible toast replaces it, a full queue drops the oldest. */
export function toastReducer(queue: readonly ToastItem[], event: ToastEvent): ToastItem[] {
  if (event.type === "dismiss") return queue.filter((toast) => toast.id !== event.id);
  const rest = queue.filter((toast) => toast.kind !== event.toast.kind || toast.message !== event.toast.message);
  return [...rest, event.toast].slice(-MAX_TOASTS);
}
