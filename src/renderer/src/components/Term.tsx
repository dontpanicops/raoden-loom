// A jargon word explained in place (SPEC §11.4): dotted underline; the explanation is a tooltip (role="tooltip", read with the word
// through aria-describedby) under the word after 400 ms of hover and at once on keyboard focus; Esc, leaving the word or losing
// focus closes it. A button so it is reachable by Tab. The explanations are the i18n keys orchTerm_<id>.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LocaleId } from "../../../shared/contracts";
import { t } from "../lib/i18n";

const HOVER_MS = 400;
const GAP = 6;

export function Term({ locale, id, hint, plain = false, children }: { locale: LocaleId; id: string; hint?: string; plain?: boolean; children: React.ReactNode }): React.JSX.Element {
  const text = hint ?? t(locale, `orchTerm_${id}` as never);
  const tipId = useId();
  const word = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const show = (delay: number): void => { window.clearTimeout(timer.current); if (delay) timer.current = window.setTimeout(() => setOpen(true), delay); else setOpen(true); };
  const hide = (): void => { window.clearTimeout(timer.current); setOpen(false); setPos(null); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.stopPropagation(); hide(); } };
    document.addEventListener("keydown", esc, true);
    return () => document.removeEventListener("keydown", esc, true);
  }, [open]);
  // under the word; when the bottom has no room — over it (the word's own box is measured, so a scaled canvas is covered)
  useLayoutEffect(() => {
    if (!open || !word.current || !tip.current) return;
    const w = word.current.getBoundingClientRect();
    const h = tip.current.offsetHeight;
    const width = tip.current.offsetWidth;
    const above = w.bottom + GAP + h > window.innerHeight - 8 && w.top - GAP - h >= 8;
    setPos({ left: Math.max(8, Math.min(w.left, window.innerWidth - width - 8)), top: above ? w.top - GAP - h : w.bottom + GAP, above });
  }, [open]);
  const host = document.querySelector<HTMLElement>(".app") ?? document.body;
  return (
    <>
      <button ref={word} type="button" className={plain ? "orch-term orch-term--plain" : "orch-term"} aria-describedby={open ? tipId : undefined} data-term={id}
        onMouseEnter={() => show(HOVER_MS)} onMouseLeave={hide} onFocus={() => show(0)} onBlur={hide}>{children}</button>
      {open && createPortal(
        <span ref={tip} id={tipId} role="tooltip" className={`orch-tip${pos?.above ? " orch-tip--above" : ""}`} data-term-tip={id}
          style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}>{text}</span>, host)}
    </>
  );
}
