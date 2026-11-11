// Where a link's chip goes (UX audit PR 2, Н14): between the two cards it links, unless it would cover a card there —
// then under the pair, else above it. The chip is centred on the point (translate(-50%, -50%)). Pure: tested under node.
import { curvePoint, type LinkGeometry } from "./linkCurve.ts";

export interface Rect { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

const GAP = 10;
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const around = (c: Point, w: number, h: number): Rect => ({ x: c.x - w / 2, y: c.y - h / 2, width: w, height: h });

// ponytail: the chip's size is estimated from its label (the buttons beside it are about the same width in both
// languages); measure the element if a label ever outgrows the estimate.
export function chipSize(label: string, buttons: number, scale = 1): { width: number; height: number } {
  return { width: (label.length * 6.6 + buttons * 92 + 24) * scale, height: 26 * scale };
}

// from / to: the linked cards; cards: every card on the canvas (the two included); size: the chip's.
export function chipCenter(from: Rect, to: Rect, cards: readonly Rect[], size: { width: number; height: number }): Point {
  const mid = { x: (from.x + from.width + to.x) / 2, y: (from.y + from.height / 2 + to.y + to.height / 2) / 2 };
  const free = (c: Point) => !cards.some((r) => overlaps(around(c, size.width, size.height), r));
  if (free(mid)) return mid;
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x + from.width, to.x + to.width);
  const x = (left + right) / 2;
  const below = { x, y: Math.max(from.y + from.height, to.y + to.height) + GAP + size.height / 2 };
  if (free(below)) return below;
  const above = { x, y: Math.min(from.y, to.y) - GAP - size.height / 2 };
  return free(above) ? above : below;
}

// R2: the chip sits ON the curve, at the first of t = 0.5, 0.42, 0.58, ... that covers no card (Н14). With the link selected
// t=0.5 is the bend handle's: skipped. No free t: along the normal from the middle in big steps, else the middle.
const CHIP_T = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74];
// pair: the two linked cards. When the gap between them is too narrow for the chip (the chip is wider than it), it goes
// above the pair, 18px over the higher card's top edge, else under it (mock-up 19), not far off along the normal.
export function chipOnCurve(g: LinkGeometry, cards: readonly Rect[], size: { width: number; height: number }, selected = false, pair?: readonly [Rect, Rect]): Point {
  const free = (c: Point) => !cards.some((r) => overlaps(around(c, size.width, size.height), r));
  for (const t of selected ? CHIP_T.slice(1) : CHIP_T) {
    const c = curvePoint(g, t);
    if (free(c)) return c;
  }
  const { mid, normal } = g;
  if (pair) {
    const x = (Math.min(pair[0].x, pair[1].x) + Math.max(pair[0].x + pair[0].width, pair[1].x + pair[1].width)) / 2;
    const above = { x, y: Math.min(pair[0].y, pair[1].y) - 18 - size.height / 2 };
    if (free(above)) return above;
    const below = { x, y: Math.max(pair[0].y + pair[0].height, pair[1].y + pair[1].height) + 18 + size.height / 2 };
    if (free(below)) return below;
  }
  const step = Math.abs(normal.x) * size.width / 2 + Math.abs(normal.y) * size.height / 2 + GAP + 6;
  const at = (k: number): Point => ({ x: mid.x + normal.x * step * k, y: mid.y + normal.y * step * k });
  for (const k of [3, -3, 5, -5, 8, -8]) if (free(at(k))) return at(k);
  return selected ? at(3) : mid;
}
