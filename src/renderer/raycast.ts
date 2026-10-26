// Line of sight for light sources: what a light can see, worked out by casting rays.
//
// A ray is cast toward every corner of every nearby wall (and just either side of it, to
// slip past the corner). Where each ray first hits something is a corner of the lit area,
// so joining the hits in angle order gives the exact shape the light reaches, with crisp
// shadows behind walls, doors and pillars. All in grid units.
//
// Clutter blocks light by its cover: full cover like a wall, half and three-quarters cover
// partly. See lightLayers for how partial shadows are built from whole ones.

import { computePillarOutlines, computeWalls } from "./walls.ts";
import type { Point, Segment } from "./walls.ts";
import type { Dungeon } from "./generator.ts";
import { PROP_SPECS, footprint } from "./clutter.ts";
import type { Cover } from "./clutter.ts";
import { PROP_RENDERERS } from "./props/index.ts";

export type BlockingCover = Exclude<Cover, "none">;

/** An edge that stops some or all light. */
export interface Occluder extends Segment {
  cover: BlockingCover;
  /** Index of the prop it belongs to, so a glowing prop doesn't shade its own light. */
  prop?: number;
}

/** How much light gets past each kind of cover. */
export const COVER_LIGHT: Record<Cover, number> = {
  full: 0,
  "three-quarters": 0.25,
  half: 0.5,
  none: 1,
};

/** Light-blocking cover from most to least blocking. */
const BLOCKING: readonly BlockingCover[] = ["full", "three-quarters", "half"];

/** How far inside its squares a prop's light-blocking outline sits. */
const PROP_INSET = 0.14;

function outline(
  points: readonly Point[],
  cover: BlockingCover,
  prop?: number,
): Occluder[] {
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length] as Point;
    return {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      cover,
      ...(prop === undefined ? {} : { prop }),
    };
  });
}

/** Everything that stops light: walls, doors (all drawn closed), pillars, and clutter with cover. */
export function lightOccluders(d: Dungeon): Occluder[] {
  const out: Occluder[] = computeWalls(d).map((s) => ({ ...s, cover: "full" }));
  for (const o of d.doors)
    out.push({ x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, cover: "full" });
  // Pillar outlines repeat their first point to close them.
  for (const poly of computePillarOutlines(d))
    out.push(...outline(poly.slice(0, -1), "full"));
  d.props.forEach((p, i) => {
    const cover = PROP_SPECS[p.kind].cover;
    if (cover === "none") return;
    const cells = footprint(p);
    const x0 = Math.min(...cells.map((c) => c.x)) + PROP_INSET;
    const y0 = Math.min(...cells.map((c) => c.y)) + PROP_INSET;
    const x1 = Math.max(...cells.map((c) => c.x)) + 1 - PROP_INSET;
    const y1 = Math.max(...cells.map((c) => c.y)) + 1 - PROP_INSET;
    if (PROP_RENDERERS[p.kind].round) {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const r = (x1 - x0) / 2;
      const ring = Array.from({ length: 8 }, (_, k) => ({
        x: cx + Math.cos((k / 8) * Math.PI * 2) * r,
        y: cy + Math.sin((k / 8) * Math.PI * 2) * r,
      }));
      out.push(...outline(ring, cover, i));
    } else {
      out.push(
        ...outline(
          [
            { x: x0, y: y0 },
            { x: x1, y: y0 },
            { x: x1, y: y1 },
            { x: x0, y: y1 },
          ],
          cover,
          i,
        ),
      );
    }
  });
  return out;
}

export interface LightLayer {
  /** Share of the light this layer carries; a light's layers add up to 1. */
  weight: number;
  /** What blocks this layer. */
  segments: Occluder[];
}

/**
 * Splits a light into layers so partial cover casts partial shadows. The first layer is
 * blocked only by full cover, the next also by three-quarters cover, the last by all
 * cover. Each carries the extra light that gets past the cover it adds, so open floor gets
 * every layer (all the light), a spot behind half cover only the first two (half), and one
 * behind three-quarters cover only the first (a quarter). Layers that would be identical
 * (no props with that cover) are merged. `prop` is left out so a glowing prop doesn't
 * shade its own light.
 */
export function lightLayers(
  occluders: readonly Occluder[],
  prop?: number,
): LightLayer[] {
  const own = occluders.filter((o) => prop === undefined || o.prop !== prop);
  const layers: LightLayer[] = [];
  BLOCKING.forEach((cover, k) => {
    const next = BLOCKING[k + 1];
    const weight =
      (next ? COVER_LIGHT[next] : COVER_LIGHT.none) - COVER_LIGHT[cover];
    const segments = own.filter((o) => BLOCKING.indexOf(o.cover) <= k);
    const last = layers.at(-1);
    if (last && last.segments.length === segments.length) last.weight += weight;
    else layers.push({ weight, segments });
  });
  return layers;
}

/** Turning a ray this far (radians) either side of a corner lets it slip past the corner. */
const NUDGE = 1e-4;

/** Distance along the ray (ox, oy) + t·(dx, dy) to where it crosses segment s, or Infinity. */
function hit(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  s: Segment,
): number {
  const sx = s.x2 - s.x1;
  const sy = s.y2 - s.y1;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-12) return Infinity; // parallel
  const ex = s.x1 - ox;
  const ey = s.y1 - oy;
  const t = (ex * sy - ey * sx) / denom;
  const u = (ex * dy - ey * dx) / denom;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
}

/**
 * The area a light at (ox, oy) can see within a square of half-size `radius`, as a polygon
 * in angle order. Only occluders that could reach that square are tested.
 */
export function visibilityPolygon(
  ox: number,
  oy: number,
  radius: number,
  occluders: readonly Segment[],
): Point[] {
  const x0 = ox - radius;
  const y0 = oy - radius;
  const x1 = ox + radius;
  const y1 = oy + radius;
  const near = occluders.filter(
    (s) =>
      Math.max(s.x1, s.x2) >= x0 &&
      Math.min(s.x1, s.x2) <= x1 &&
      Math.max(s.y1, s.y2) >= y0 &&
      Math.min(s.y1, s.y2) <= y1,
  );
  // The edges of the square stop rays that hit nothing else.
  const segs: Segment[] = [
    ...near,
    { x1: x0, y1: y0, x2: x1, y2: y0 },
    { x1: x1, y1: y0, x2: x1, y2: y1 },
    { x1: x1, y1: y1, x2: x0, y2: y1 },
    { x1: x0, y1: y1, x2: x0, y2: y0 },
  ];
  const angles: number[] = [];
  for (const s of segs) {
    for (const [px, py] of [
      [s.x1, s.y1],
      [s.x2, s.y2],
    ] as const) {
      const a = Math.atan2(py - oy, px - ox);
      angles.push(a - NUDGE, a, a + NUDGE);
    }
  }
  angles.sort((a, b) => a - b);
  const poly: Point[] = [];
  for (const a of angles) {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let t = Infinity;
    for (const s of segs) t = Math.min(t, hit(ox, oy, dx, dy, s));
    poly.push({ x: ox + dx * t, y: oy + dy * t });
  }
  return poly;
}
