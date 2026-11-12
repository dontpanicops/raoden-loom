import { useEffect, useLayoutEffect, useRef } from "react";
import { autoDismissMs, type ToastItem } from "../lib/toastQueue";
import { UiIcon, type UiIconName } from "./UiIcon";

interface ToastProps {
  toasts: readonly ToastItem[];
  closeLabel: string;
  onDismiss(id: number): void;
}

const ICON: Record<ToastItem["kind"], UiIconName> = { success: "status-done", info: "info", error: "status-failed", waiting: "bell" };

function ToastCard({ toast, closeLabel, onDismiss }: { toast: ToastItem; closeLabel: string; onDismiss(id: number): void }): React.JSX.Element {
  useEffect(() => {
    const ms = autoDismissMs(toast.kind);
    if (ms === null) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), ms);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.kind, onDismiss]);

  const urgent = toast.kind === "error" || toast.kind === "waiting";
  return (
    <div className={`toast toast--${toast.kind} surface-3`} role={urgent ? "alert" : "status"}>
      <UiIcon name={ICON[toast.kind]} size={20} />
      <span className="toast__body">
        {toast.title && <strong className="toast__title">{toast.title}</strong>}
        <span className="toast__message">{toast.message}</span>
      </span>
      {toast.action ? (
        <button type="button" className="toast__action" onClick={() => { toast.action?.run(); onDismiss(toast.id); }}>{toast.action.label}</button>
      ) : (
        <button type="button" className="toast__close" aria-label={closeLabel} onClick={() => onDismiss(toast.id)}><UiIcon name="close" size={14} /></button>
      )}
    </div>
  );
}

// The stack stands in the bottom right corner; the canvas overlays (hints, minimap, zoom) can stand there too: the stack
// rises above whichever of them sits in its column (the bottom half of the window), so a toast never covers them.
function liftAbove(stack: HTMLElement): void {
  const own = stack.getBoundingClientRect();
  let bottom = 20;
  for (const slot of document.querySelectorAll<HTMLElement>(".canvas-overlay-slot")) {
    const r = slot.getBoundingClientRect();
    if (r.height === 0 || r.bottom < window.innerHeight / 2 || r.right < own.left || r.left > own.right) continue;
    bottom = Math.max(bottom, window.innerHeight - r.top + 12);
  }
  stack.style.bottom = `${bottom}px`;
}

export function Toast({ toasts, closeLabel, onDismiss }: ToastProps): React.JSX.Element {
  const stack = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new or removed toast is the trigger; the overlays are measured, not props
  useLayoutEffect(() => {
    const node = stack.current;
    if (!node) return;
    const lift = (): void => liftAbove(node);
    lift();
    window.addEventListener("resize", lift);
    return () => window.removeEventListener("resize", lift);
  }, [toasts.length]);
  return (
    <div ref={stack} className="toast-stack" data-interactive="true">
      {toasts.map((toast) => <ToastCard key={toast.id} toast={toast} closeLabel={closeLabel} onDismiss={onDismiss} />)}
    </div>
  );
}
