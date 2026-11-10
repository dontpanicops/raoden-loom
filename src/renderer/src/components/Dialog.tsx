// The one modal dialog (stage R1.3): level 4, focus trap, Esc, focus back to the opener, a pinned footer by the caller.
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import type { LocaleId } from "../../../shared/contracts";
import { FOCUSABLE, trapTarget } from "../lib/focusTrap";
import { t } from "../lib/i18n";
import { UiIcon } from "./UiIcon";

// Open dialogs, the last one on top: Esc closes only the top one (a settings dialog inside the goal dialog).
const stack: symbol[] = [];

const focusables = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);

export function Dialog({ label, onClose, children, locale, className = "", backdropClassName = "" }: {
  label: string; onClose(): void; children: React.ReactNode; locale: LocaleId; className?: string; backdropClassName?: string;
}): React.JSX.Element {
  const titleId = useId();
  const root = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = root.current;
    if (node && !node.contains(document.activeElement)) {
      // the first field, else the main button, else the first control that is not the close cross
      const items = focusables(node);
      (items.find((el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) ?? node.querySelector<HTMLElement>(".orch-primary") ?? items.find((el) => !el.classList.contains("dialog__close")) ?? node)
        .focus({ preventScroll: true });
    }
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    const me = Symbol("dialog");
    stack.push(me);
    const onKey = (event: KeyboardEvent): void => {
      if (stack[stack.length - 1] !== me) return;
      if (event.key === "Escape") { close.current(); return; }
      if (event.key !== "Tab" || !root.current) return;
      const items = focusables(root.current);
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = trapTarget(items.length, at, event.shiftKey);
      if (next === null) return;
      event.preventDefault();
      items[next]?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); stack.splice(stack.indexOf(me), 1); };
  }, []);

  return (
    <div className={`dialog-backdrop ${backdropClassName}`.trim()} role="presentation" data-interactive="true" data-wheel-owner="local" data-canvas-wheel-priority="local" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={root} className={`launch-dialog orch-dialog surface-4 ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="launch-dialog__toolbar">
          <strong id={titleId} className="orch-dialog__title">{label}</strong>
          <button className="launch-dialog__close dialog__close" type="button" onClick={onClose} aria-label={t(locale, "orchClose")}><UiIcon name="close" size={18} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}
