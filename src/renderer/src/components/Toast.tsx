import { useEffect } from "react";
import { autoDismissMs, type ToastItem } from "../lib/toastQueue";
import { UiIcon, type UiIconName } from "./UiIcon";

interface ToastProps {
  toasts: readonly ToastItem[];
  closeLabel: string;
  onDismiss(id: number): void;
}

const ICON: Record<ToastItem["kind"], UiIconName> = { success: "done", info: "info", error: "error", waiting: "bell" };

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
      <UiIcon name={ICON[toast.kind]} size={16} />
      <span className="toast__message">{toast.message}</span>
      {toast.action && (
        <button type="button" className="toast__action" onClick={() => { toast.action?.run(); onDismiss(toast.id); }}>{toast.action.label}</button>
      )}
      <button type="button" className="toast__close" aria-label={closeLabel} onClick={() => onDismiss(toast.id)}><UiIcon name="close" size={14} /></button>
    </div>
  );
}

export function Toast({ toasts, closeLabel, onDismiss }: ToastProps): React.JSX.Element {
  return (
    <div className="toast-stack" data-interactive="true">
      {toasts.map((toast) => <ToastCard key={toast.id} toast={toast} closeLabel={closeLabel} onDismiss={onDismiss} />)}
    </div>
  );
}
