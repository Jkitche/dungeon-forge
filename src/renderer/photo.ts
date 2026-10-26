// Photographic textures for the Realistic look (CC0, from ambientCG; see assets/textures).
// They load once at startup. Until they arrive, or where images can't load at all (tests),
// photoTexture returns null and the renderer falls back to its hand-drawn painters.

export type PhotoKey = 'floor' | 'rock';

const FILES: Record<PhotoKey, string> = {
  floor: 'floor-cobbles.jpg',
  rock: 'rock-dark.jpg',
};

/** How many grid squares one copy of each texture spans, so stones come out about the right size. */
export const PHOTO_SQUARES: Record<PhotoKey, number> = { floor: 4, rock: 9 };

const loaded = new Map<PhotoKey, CanvasImageSource>();

export const photoTexture = (key: PhotoKey): CanvasImageSource | null => loaded.get(key) ?? null;

export type ImageLoader = (url: string) => Promise<CanvasImageSource>;

async function loadImage(url: string): Promise<CanvasImageSource> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/**
 * Loads every texture. One that fails to load is skipped, leaving the hand-drawn fallback,
 * so a missing file never stops the map from drawing.
 */
export async function loadPhotoTextures(base: URL | string, load: ImageLoader = loadImage): Promise<void> {
  await Promise.all(
    (Object.keys(FILES) as PhotoKey[]).map(async (key) => {
      try {
        loaded.set(key, await load(new URL(FILES[key], base).href));
      } catch {
        loaded.delete(key);
      }
    }),
  );
}

/** Forget loaded textures (for tests). */
export const clearPhotoTextures = (): void => loaded.clear();

export interface PhotoFill {
  /** Pixels per grid square. */
  ppg: number;
  /** Width plus height of the area to cover, in pixels. */
  extent: number;
  /** Grid squares per copy of the tile. */
  squares: number;
  /** Turn the tile by this many quarter turns. */
  turns?: number;
  /** Shift the tile by this many squares. */
  ox?: number;
  oy?: number;
  /** Darken the result by this much, 0–1. */
  shade?: number;
}

/**
 * Fills the current clip with `image`, tiled, turned and shifted as `fill` says. Turning and
 * shifting each room differently hides the repeat of a single tile.
 */
export function fillPhoto(ctx: CanvasRenderingContext2D, image: CanvasImageSource, fill: PhotoFill): void {
  const { ppg, extent, squares, turns = 0, ox = 0, oy = 0, shade = 0 } = fill;
  const pattern = ctx.createPattern(image, 'repeat');
  if (!pattern) return;
  const size = Number((image as { width?: unknown }).width) || 1024;
  const scale = (squares * ppg) / size;
  // The tile repeats forever, so any rectangle that covers the area after turning will do.
  const reach = extent / scale;
  ctx.save();
  ctx.translate(ox * ppg, oy * ppg);
  ctx.rotate((turns % 4) * (Math.PI / 2));
  ctx.scale(scale, scale);
  ctx.fillStyle = pattern;
  ctx.fillRect(-reach, -reach, reach * 2, reach * 2);
  if (shade > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${shade})`;
    ctx.fillRect(-reach, -reach, reach * 2, reach * 2);
  }
  ctx.restore();
}
