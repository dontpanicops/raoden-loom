// The bend of a link (R2, stage-r-redesign.md): the curve's middle point P = M + along·(T−F) + across·|T−F|·n̂, where
// F is the lead's port, T the executor's, M the middle of FT and n̂ = (−d.y, d.x)/|d| in screen coordinates (y down).
// Pure, so main, the renderer and tests share one formula.
export interface LinkBend { along: number; across: number }
export interface BendPoint { x: number; y: number }
export interface BendCurve { p: BendPoint; c1: BendPoint; c2: BendPoint }

export const BEND_LIMIT = 2;
const MIN_LENGTH = 1; // below this many px the bend is not applied

export const isLinkBend = (v: unknown): v is LinkBend => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const b = v as Record<string, unknown>;
  return Object.keys(b).length === 2 && [b.along, b.across].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= BEND_LIMIT);
};

// null: no bend, or the ports are closer than 1px — the caller draws the straight / automatic curve.
export function bendCurve(f: BendPoint, t: BendPoint, bend: LinkBend | null | undefined): BendCurve | null {
  const dx = t.x - f.x, dy = t.y - f.y;
  if (!bend || Math.hypot(dx, dy) < MIN_LENGTH) return null;
  // across·|d|·n̂ = across·(−dy, dx): the length cancels
  const p = { x: (f.x + t.x) / 2 + bend.along * dx - bend.across * dy, y: (f.y + t.y) / 2 + bend.along * dy + bend.across * dx };
  return {
    p,
    c1: { x: f.x + (2 / 3) * (p.x - f.x), y: f.y + (2 / 3) * (p.y - f.y) },
    c2: { x: t.x + (2 / 3) * (p.x - t.x), y: t.y + (2 / 3) * (p.y - t.y) }
  };
}

// The pointer's point -> the bend that puts P there, each part clamped to [−2, 2]; null when the ports are under 1px apart.
export function bendFromPoint(f: BendPoint, t: BendPoint, point: BendPoint): LinkBend | null {
  const dx = t.x - f.x, dy = t.y - f.y, len2 = dx * dx + dy * dy;
  if (Math.sqrt(len2) < MIN_LENGTH) return null;
  const rx = point.x - (f.x + t.x) / 2, ry = point.y - (f.y + t.y) / 2;
  const clamp = (n: number) => Math.max(-BEND_LIMIT, Math.min(BEND_LIMIT, n));
  return { along: clamp((rx * dx + ry * dy) / len2), across: clamp((-rx * dy + ry * dx) / len2) };
}
