// The one modal dialog (stage R1.3): level 4, focus trap, Esc, focus back to the opener, a pinned footer by the caller.
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { LocaleId } from "../../../shared/contracts";
import { FOCUSABLE, trapTarget } from "../lib/focusTrap";
import { t } from "../lib/i18n";
import { UiIcon } from "./UiIcon";

// Open dialogs, the last one on top: Esc closes only the top one (a settings dialog inside the goal dialog).
const stack: symbol[] = [];

const focusables = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);

// `anchor` makes it a popover (mock 14): the same card, no scrim, beside the opener; focus trap and Esc are the same.
// `lead` and `sub` are the mark and the caption of a card header; without them the header is the plain title.
const POPOVER_TOP = 56; // the title bar (44px) and a gap: a popover's title and close cross stay below it
function popoverStyle(anchor: DOMRect, width: number): React.CSSProperties {
  const left = Math.min(Math.max(12, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - 12);
  // a tall card keeps its place and may cover the opener row: it never climbs under the title bar (the effect slides it down)
  return anchor.top > window.innerHeight / 2
    ? { left, width, bottom: window.innerHeight - anchor.top + 10, maxHeight: window.innerHeight - POPOVER_TOP - 12, overflowY: "auto" }
    : { left, width, top: anchor.bottom + 10, maxHeight: window.innerHeight - POPOVER_TOP - 12, overflowY: "auto" };
}

export function Dialog({ label, onClose, children, locale, className = "", backdropClassName = "", anchor = null, width = 420, lead, sub }: {
  label: string; onClose(): void; children: React.ReactNode; locale: LocaleId; className?: string; backdropClassName?: string;
  anchor?: DOMRect | null; width?: number; lead?: React.ReactNode; sub?: string;
}): React.JSX.Element {
  const titleId = useId();
  const root = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // taken during the first render: a child's autoFocus has already moved focus by the time effects run
  const opener = useRef<HTMLElement | null | undefined>(undefined);
  if (opener.current === undefined) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  useLayoutEffect(() => {
    const node = root.current;
    if (node && !node.contains(document.activeElement)) {
      // the first field, else the main button, else the first control that is not the close cross
      const items = focusables(node);
      (node.querySelector<HTMLElement>("[data-autofocus]") ?? items.find((el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) ?? node.querySelector<HTMLElement>(".orch-primary") ?? items.find((el) => !el.classList.contains("dialog__close")) ?? node)
        .focus({ preventScroll: true });
    }
    const back = opener.current;
    return () => { if (back?.isConnected) back.focus({ preventScroll: true }); };
  }, []);

  // a popover that grows (the YOLO note) slides up (opened below the opener) or down (opened above it) so it stays inside the window
  useLayoutEffect(() => {
    const node = root.current;
    if (!anchor || !node) return;
    const below = node.style.top !== "";
    const base = parseFloat(below ? node.style.top : node.style.bottom);
    if (Number.isNaN(base)) return;
    const fit = (): void => {
      const edge = below ? "top" : "bottom";
      node.style[edge] = `${base}px`;
      const rect = node.getBoundingClientRect();
      const over = below ? rect.bottom - (window.innerHeight - 12) : POPOVER_TOP - rect.top;
      if (over > 0) node.style[edge] = `${Math.max(below ? POPOVER_TOP : 12, base - over)}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [anchor]);

  useEffect(() => {
    const me = Symbol("dialog");
    stack.push(me);
    const onKey = (event: KeyboardEvent): void => {
      if (stack[stack.length - 1] !== me) return;
      if (event.key === "Escape") { if (!event.defaultPrevented && !event.isComposing) close.current(); return; }
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

  // a popover has no scrim to click: a press outside it (not on the opener's row of buttons) closes it
  useEffect(() => {
    if (!anchor) return;
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Element | null;
      if (root.current?.contains(target) || target?.closest(".launcher-button")) return;
      close.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [anchor]);

  const title = <strong id={titleId} className="orch-dialog__title">{label}</strong>;
  const card = (
    <section ref={root} className={`launch-dialog orch-dialog surface-4 ${anchor ? "launch-popover" : ""} ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
      {...(anchor ? { style: popoverStyle(anchor, width), "data-interactive": "true", "data-wheel-owner": "local", "data-canvas-wheel-priority": "local" } : {})}>
      <div className="launch-dialog__toolbar">
        {lead || sub ? <>{lead}<div className="launch-dialog__titles">{title}{sub && <small>{sub}</small>}</div></> : title}
        <button className="launch-dialog__close dialog__close" type="button" onClick={onClose} aria-label={t(locale, "orchClose")}><UiIcon name="close" size={18} /></button>
      </div>
      {children}
    </section>
  );
  // in the app root (it carries the theme tokens), not in the opener's tree: a canvas card is scaled and transformed, and a fixed dialog inside it would shrink with the scene
  const host = document.querySelector<HTMLElement>(".app") ?? document.body;
  if (anchor) return createPortal(card, host);
  return createPortal(
    <div className={`dialog-backdrop ${backdropClassName}`.trim()} role="presentation" data-interactive="true" data-wheel-owner="local" data-canvas-wheel-priority="local" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      {card}
    </div>,
    host,
  );
}
