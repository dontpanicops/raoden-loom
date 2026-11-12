import type { Point, RadialLauncherItemId } from "../../../../shared/contracts";

// Mock 10-overlays: 60px items on a ring of radius 75 for 6; more items widen the ring so neighbours keep a 6px gap
export const RADIAL_LAUNCHER_ITEM = 60;
export function radialLauncherRadius(count: number): number {
  return count < 3 ? 75 : Math.max(75, Math.ceil((RADIAL_LAUNCHER_ITEM + 6) / (2 * Math.sin(Math.PI / count))));
}
export const RADIAL_LAUNCHER_DEAD_ZONE = 28;

export function radialItemOffset(index: number, count: number, radius = radialLauncherRadius(count)): Point {
  if (count <= 0) return { x: 0, y: 0 };
  const angle = -Math.PI / 2 + index * (Math.PI * 2 / count);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

export function radialItemAtPointer(
  anchor: Point,
  pointer: Point,
  count: number,
  deadZone = RADIAL_LAUNCHER_DEAD_ZONE
): number | null {
  if (count <= 0) return null;
  const dx = pointer.x - anchor.x;
  const dy = pointer.y - anchor.y;
  if (Math.hypot(dx, dy) < deadZone) return null;
  const pointerAngle = normalizeAngle(Math.atan2(dy, dx) + Math.PI / 2);
  return Math.round(pointerAngle / (Math.PI * 2 / count)) % count;
}

export function setRadialLauncherItemEnabled(
  current: readonly RadialLauncherItemId[],
  item: RadialLauncherItemId,
  enabled: boolean
): RadialLauncherItemId[] {
  if (!enabled) {
    const next = current.filter((candidate) => candidate !== item);
    return next.length > 0 ? next : [...current];
  }
  if (current.includes(item) || current.length >= 8) return [...current];
  return [...current, item];
}

function normalizeAngle(value: number): number {
  const fullCircle = Math.PI * 2;
  return ((value % fullCircle) + fullCircle) % fullCircle;
}
