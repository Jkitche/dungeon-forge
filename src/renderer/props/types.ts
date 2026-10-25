// The prop renderer contract.
//
// Each kind of clutter is drawn by one PropRenderer. Renderers see only what they need:
// the canvas, the size of a square, a seeded random source and the theme's prop palette,
// so they work with any theme and can be tested against a fake canvas.

import type { RNG } from '../rng.ts';
import type { PropKind } from '../clutter.ts';

/** Colours for room clutter. Light themes use pale fills with dark outlines, like a hand-drawn map. */
export interface PropPalette {
  wood: string;
  metal: string;
  cloth: string;
  stone: string;
  line: string;
  /** Fire, screens and other light sources. */
  glow: string;
  /** Pillows, pages, bone. */
  paper: string;
}

export interface PropPaintContext {
  ctx: CanvasRenderingContext2D;
  /** Pixels per grid square. */
  ppg: number;
  palette: PropPalette;
  /** For small variations (book colours, rubble); seeded, so a map always renders the same. */
  rng: RNG;
  /** Depth effect strength, 0–1; when above 0, outlined shapes get a lit top-left and shaded bottom-right. */
  depth?: number;
  /** The prop's footprint, which the depth highlight spans. */
  bounds?: PropBox;
}

/** A prop's footprint in pixels: one square, or two for long props. */
export interface PropBox {
  x: number;
  y: number;
  w: number;
  h: number;
  vertical: boolean;
}

export interface PropRenderer {
  readonly kind: PropKind;
  /** How tall the prop stands, for its shadow: 0 lies flat, 1 is crate height. */
  readonly height: number;
  /** Casts a round shadow rather than a square one. */
  readonly round: boolean;
  draw(c: PropPaintContext, box: PropBox): void;
}
