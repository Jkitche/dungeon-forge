// The prop renderer registry. To add a prop: add its kind to clutter.ts, write a
// PropRenderer for it, and list it here. The Record type makes a missing one a compile error.

import type { PropKind } from '../clutter.ts';
import { BarrelRenderer, ChestRenderer, CrateRenderer } from './containers.ts';
import { BedRenderer, RugRenderer, ShelfRenderer, TableRenderer } from './furniture.ts';
import { BonesRenderer, RubbleRenderer } from './debris.ts';
import { BrazierRenderer, CoffinRenderer, StatueRenderer } from './fixtures.ts';
import { ConsoleRenderer, CryoPodRenderer } from './tech.ts';
import type { PropRenderer } from './types.ts';

export const PROP_RENDERERS: Readonly<Record<PropKind, PropRenderer>> = {
  crate: new CrateRenderer(),
  barrel: new BarrelRenderer(),
  chest: new ChestRenderer(),
  table: new TableRenderer(),
  bed: new BedRenderer(),
  shelf: new ShelfRenderer(),
  rug: new RugRenderer(),
  rubble: new RubbleRenderer(),
  bones: new BonesRenderer(),
  statue: new StatueRenderer(),
  brazier: new BrazierRenderer(),
  console: new ConsoleRenderer(),
  coffin: new CoffinRenderer(),
  pod: new CryoPodRenderer(),
};

export type { PropBox, PropPaintContext, PropPalette, PropRenderer } from './types.ts';
