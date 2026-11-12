import { useEffect, useState } from "react";

// Mock 18 (card resize): while a card's edge or corner is dragged, its size in canvas pixels shows under the card's
// bottom right corner. Only during the gesture. Reads the card's own box, so it holds for every card kind.
export function ResizeSizeBadge(): React.JSX.Element | null {
  const [badge, setBadge] = useState<{ text: string; right: number; top: number } | null>(null);

  useEffect(() => {
    let card: HTMLElement | null = null;
    let pointerId = -1;
    const show = (): void => {
      if (!card) return;
      const box = card.getBoundingClientRect();
      setBadge({ text: `${card.offsetWidth} × ${card.offsetHeight}`, right: box.right, top: box.bottom + 8 });
    };
    const down = (event: PointerEvent): void => {
      if (!(event.target instanceof Element)) return;
      const handle = event.target.closest(".terminal-card__resize-handle");
      card = handle?.closest<HTMLElement>("[data-canvas-layer-id]") ?? null;
      pointerId = event.pointerId;
    };
    const move = (event: PointerEvent): void => {
      if (card && event.pointerId === pointerId && event.buttons !== 0) show();
    };
    const end = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      card = null;
      setBadge(null);
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
    };
  }, []);

  return badge ? <output className="resize-size-badge" aria-hidden="true" style={{ left: badge.right, top: badge.top, transform: "translateX(-100%)" }}>{badge.text}</output> : null;
}
