// The drawn curve of a link (R2): cubic F -> T. With a user bend it is shared/linkBend.ts; without one an "automatic"
// curve: a gentle horizontal S between the ports, or — when the executor sits left of the lead — a loop through the
// corridor between the cards. Pure: tested under node.
import { bendCurve, bendFromPoint, type BendPoint, type LinkBend } from "../../../../shared/linkBend.ts";

export interface LinkGeometry { f: BendPoint; c1: BendPoint; c2: BendPoint; t: BendPoint; mid: BendPoint; normal: BendPoint; arrow: BendPoint }

const END_RUN = 40; // min horizontal run of the end tangents, world px
const pt = (x: number, y: number): BendPoint => ({ x, y });

export function linkGeometry(f: BendPoint, t: BendPoint, bend?: LinkBend | null): LinkGeometry {
  const bent = bendCurve(f, t, bend);
  let c1: BendPoint, c2: BendPoint;
  if (bent) {
    // A strong bend can put a control point behind its port, so the curve would arrive from above/below and the arrow hide under the
    // card. Keep both ends heading right (leave F rightwards, enter T from the left) at no steeper than ~63 degrees (rise <= 2x run).
    // ponytail: the handle (t=0.5 of the clamped curve) only approximates the pointer inside the clamped zone; it is continuous, no jumps.
    ({ c1, c2 } = bent);
    c1 = pt(Math.max(c1.x, f.x + Math.max(END_RUN, Math.abs(c1.y - f.y) / 2)), c1.y);
    c2 = pt(Math.min(c2.x, t.x - Math.max(END_RUN, Math.abs(c2.y - t.y) / 2)), c2.y);
  } else {
    const dx = t.x - f.x, dy = t.y - f.y;
    if (dx >= 0) { // S: leave right, arrive from the left
      const k = Math.max(40, Math.min(dx / 2, 220));
      c1 = pt(f.x + k, f.y); c2 = pt(t.x - k, t.y);
    } else { // behind the lead: out to the right, across through the corridor between the cards, in from the left
      const k = 100 + Math.min(-dx / 2, 200);
      const s = (dy >= 0 ? 1 : -1) * Math.max(90, Math.abs(dy) / 2 + 60);
      c1 = pt(f.x + k, f.y + s); c2 = pt(t.x - k, t.y - s);
    }
  }
  const mid = pt((f.x + 3 * c1.x + 3 * c2.x + t.x) / 8, (f.y + 3 * c1.y + 3 * c2.y + t.y) / 8);
  const tan = pt(c2.x - c1.x + t.x - f.x, c2.y - c1.y + t.y - f.y); // direction of B'(0.5)
  const m = Math.hypot(tan.x, tan.y) || 1;
  const a = pt(t.x - c2.x, t.y - c2.y), am = Math.hypot(a.x, a.y) || 1;
  return { f, c1, c2, t, mid, normal: pt(-tan.y / m, tan.x / m), arrow: pt(a.x / am, a.y / am) };
}

// the curve's point at parameter t (0..1)
export function curvePoint(g: LinkGeometry, t: number): BendPoint {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return pt(a * g.f.x + b * g.c1.x + c * g.c2.x + d * g.t.x, a * g.f.y + b * g.c1.y + c * g.c2.y + d * g.t.y);
}

export const linkPath = (g: LinkGeometry): string => `M ${g.f.x} ${g.f.y} C ${g.c1.x} ${g.c1.y} ${g.c2.x} ${g.c2.y} ${g.t.x} ${g.t.y}`;

// Arrowhead at T pointing along the end tangent; size in world px (the caller divides by zoom for a constant screen size).
export function arrowPath(g: LinkGeometry, size: number): string {
  const { t, arrow: a } = g;
  const bx = t.x - a.x * size, by = t.y - a.y * size, w = size * 0.5;
  return `M ${t.x} ${t.y} L ${bx - a.y * w} ${by + a.x * w} L ${bx + a.y * w} ${by - a.x * w} Z`;
}

// The pointer on the handle (drawn at the curve's t=0.5, which is (M+P)/2) -> the bend: P = 2·pointer − M.
export function bendFromHandle(f: BendPoint, t: BendPoint, pointer: BendPoint): LinkBend | null {
  const m = pt((f.x + t.x) / 2, (f.y + t.y) / 2);
  return bendFromPoint(f, t, pt(2 * pointer.x - m.x, 2 * pointer.y - m.y));
}
