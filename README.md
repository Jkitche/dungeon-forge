# Dungeon Forge

A desktop app (Electron) that generates random D&D dungeon maps and exports them to Roll20, Foundry VTT, Universal VTT (`.dd2vtt`) and plain images.

## Run

```sh
npm install
npm start          # compiles TypeScript to dist/ and launches Electron
```

Other scripts:

- `npm run build` compiles to `dist/` without launching the app.
- `npm run typecheck` runs strict type checking over the source, tests and build script.
- `npm test` runs the unit tests. Node runs the `.ts` files directly, so there is no build step.
- `npm run test:coverage` runs them with coverage, and fails if line or function coverage drops below 98% or branch coverage below 93%.

The project is written entirely in TypeScript (strict mode, TypeScript 7), and Node 22.18 or newer is required.

## Features

- **Five settings.** Each one has its own room names, descriptions, encounters, traps, specials and loot, a matching art theme, and layout defaults that suit it. The same seed keeps the same floor plan in every setting.

  | Setting | Theme | Look | Layout defaults |
  |---|---|---|---|
  | Fantasy | Parchment | Hand-drawn crosshatching, classic stairs | Balanced |
  | Sci-Fi | Starship Deck | Glowing bulkheads, deck plates, sliding doors with status lights, hazard stripes, lifts | Few round rooms, nearly every entrance has a door, more locks |
  | Steampunk | Brass & Steam | Floorboards, brick, brass rivets, copper pipes, gears, porthole hatches, boilers | Lots of pillared halls |
  | Gothic Horror | Gothic Crypt | Checkerboard tiles, candlelight, bloodstains | Winding passages, many secret doors |
  | Post-Apocalyptic | Wasteland | Cracked concrete, rust, rubble, sheet-metal doors, ladders | Winding, few doors, many loops |

  Picking a setting switches the art and layout sliders to match. The Look switch can still swap in Blueprint or Dark Stone.
- **Two layouts.** *Rooms & corridors* gives rectangular, round and octagonal rooms, pillared halls, and straight or winding corridors with optional loops. *Caverns* gives organic caves built by cellular automata, with every pocket tunnelled together.
- **Doors.** Normal, locked and secret doors are placed only on 1-square entrances.
- **Stairs.** The entrance and the exit are placed as far apart as the layout allows. Rooms are numbered by walking distance from the entrance.
- **Room key.** Every room is stocked with a name, atmosphere, feature and contents (monster, trap, special or empty, plus treasure). Click a room on the map or in the key to highlight it.
- **Seeds.** Each seed always produces the same dungeon, so you can share a seed or tweak the sliders without losing the layout.
- **Depth.** The **Depth** switch (Off, Subtle, Strong) makes maps read as 3D while staying top-down for VTTs. It adds raised walls with a lit and a shaded edge, shadows that fall away from a top-left light, darker floor where it meets walls, and highlights on pillars and furniture. Tall props like shelves and statues cast longer shadows, and rugs cast none. Nothing moves, so walls and doors still match VTT line of sight. **Light sources** dims the floor and lights pools around braziers, consoles and cryo pods. Maps with no light sources are left as they are.
- **Look.** The art follows the setting. The **Look** switch in the Style section can swap any setting's art for **Blueprint** (old-school blue, good for print) or **Dark Stone** (flagstones and shadows, good for VTTs).
- **GM and player views.** The player view hides room numbers and draws secret doors as plain wall.
- **Save and open.** Maps save as `.dungeon.json` files.

## Clutter

The **Clutter** slider fills rooms with furniture and props. Each setting has its own set: barrels, crates, beds and bookshelves for fantasy, consoles and cryo pods for sci-fi, coffins and candelabra-lit braziers for gothic horror, and so on. Room names steer the choice, so a Library gets shelves, Barracks get beds and a Crypt gets coffins and bones. Shelves, beds and consoles stand against walls; tables, rugs and statues go mid-room. Doorways, corridor openings, stairs and room numbers are always kept clear.

Clutter is decoration only: it's drawn on the map image but doesn't block movement or sight in VTT exports. It uses its own random stream, so changing the slider never changes a seed's floor plan or room key.

## Drawing your own maps

Click **Edit map** (Ctrl+Shift+E) to edit the current map and choose a tool from the **Tool** list (or press its key), or use **File › New Blank Map** (Ctrl+Shift+N) to start from solid rock.

| Tool | Key | What it does |
|---|---|---|
| Room | R | Drag a rectangle. Drawing over another room takes those squares. |
| Corridor | C | Drag to paint corridor through rock; hold Shift for a rectangle. |
| Erase | E | Drag to turn squares back into rock; hold Shift for a rectangle. |
| Door | D | Click an edge between two floor squares: door, then locked, then secret, then none. |
| Window | W | Click a wall between floor and rock to add or remove a window. |
| Pillar | P | Click a floor square to add or remove a pillar. |
| Clutter | F | Pick a prop from the **Prop** list (the setting's own props come first), then click floor to place it. Click a prop to remove it, Shift-click to turn it. |
| Stairs | S | Click a floor square: stairs up, then down, then none. |

Undo with Ctrl+Z and redo with Ctrl+Shift+Z. In edit mode, right-drag or hold Space to pan. New rooms are stocked from the current setting's tables and appear in the room key straight away. Walls are worked out from the floor, so every export works on hand-drawn maps too. Once a map has been edited, the seed no longer reproduces it, so the app asks before anything would regenerate over your work. Save it with **Save** to keep it.

## Export targets (Ctrl+E)

| Format | What you get | How to use it |
|---|---|---|
| **Roll20** | PNG at 70 px/square plus `name.roll20.txt` with page setup steps and the room key | Set the page to W×H units, drop the image on the Map layer, then use Advanced › Set Dimensions. For dynamic lighting walls, Pro accounts can import the `.dd2vtt` with the **UniversalVTTImporter** mod. |
| **Foundry VTT** | `name.foundry.json` scene (walls, doors, locked/secret states, grid) plus `name.png` | Put the PNG in `Data/dungeons/`, then right-click a scene and choose **Import Data** with the JSON. |
| **Fantasy Grounds Unity** | `name.mod`, a module with the map image, its line-of-sight XML (walls, pillars, doors) and grid, plus a thumbnail. Also `name.fantasygrounds.txt` with setup steps, secret and locked door locations, and the room key | Copy the `.mod` into FG's `modules` folder, load it from the Modules list, then drag the image from Assets › Images into Images. Needs FGU 4.1+. |
| **Fantasy Grounds Classic** | `name.mod`, a module with a Player map, a GM map (numbers, secret doors marked) and the room key as Story entries (one per room, plus an overview with door locations). Defaults to 50 px per square with the grid drawn on | Copy the `.mod` into FG's `modules` folder and load it. The maps appear under Images and the key under Story. Classic has no line of sight, so use the image mask to reveal rooms. |
| **Universal VTT** | `.dd2vtt` containing the image, walls, pillars and doors | Foundry (Universal Battlemap Importer), Arkenforge, EncounterPlus, Roll20 (UniversalVTTImporter), and others. |
| **Image (PNG)** | A PNG at any resolution, with an optional baked-in grid | Owlbear Rodeo, Shard, Let's Role, printing, and so on. Set the VTT's grid to the pixels per square you exported. |
| **Room key** | Markdown | Notes apps, handouts, journals. |

Windows block movement but not sight. Foundry gets a wall that blocks movement but not sight or light, with sound muffled. Fantasy Grounds Unity gets a window occluder (`allow_vision`). Universal VTT gets an open portal, which is how Roll20's UniversalVTTImporter and uvtt2fgu recognise windows; other importers may treat it as an open door.

Universal VTT has no secret-door flag, and Fantasy Grounds' secret-door flag isn't documented, so both exports bring secret doors in as ordinary closed doors. The Fantasy Grounds notes file lists where they are so you can switch them to secret in FG's line-of-sight editor. The Foundry export keeps them secret.

## Testing

Tests use Node's built-in `node:test`, one file per source module. The logic modules are pure data, so they're tested directly. Drawing code is tested against a recording fake canvas from `test/helpers.ts`, which logs every call and colour. That covers the map renderer, the prop renderers and the editor's previews. The export strategies run against a fake export context.

Some tests check invariants over many random inputs rather than single examples. For instance, every generated map must be fully connected, and thousands of random edits must leave a map consistent. `app.ts` and `main.ts` are DOM and Electron glue and aren't unit-tested; check those by running the app.

## Adding an export format

Exports use the strategy pattern. Each format is a class implementing `ExportStrategy` (`src/renderer/export/types.ts`):

```ts
export class MyVttExporter implements ExportStrategy {
  readonly id = 'myvtt';
  readonly label = 'My VTT';
  readonly description = 'Shown in the export dialog.';
  readonly extension = '.myvtt';
  readonly fileType = 'My VTT map';
  readonly image = { defaultPpg: 100, defaultGrid: false, viewSelectable: true }; // or null

  async run(ctx: ExportContext, target: ExportTarget): Promise<ExportResult> {
    const png = await ctx.renderPng();            // rendered in the current theme
    return {
      files: [{ path: target.path(this.extension), data: png }],
      summary: html`<p>Import <code>${target.name(this.extension)}</code> into My VTT.</p>`,
    };
  }
}
```

Then add it to `EXPORTERS` in `src/renderer/export/index.ts`. Strategies never touch the DOM, dialogs or the file system. The app supplies the context, asks where to save, and writes the returned files. That keeps every format testable in Node with a fake `renderPng`, and the registry tests automatically cover a new strategy: files land next to the save location, summaries escape file names, and default file names don't collide.

## Adding a prop

Props follow the same pattern as exports. Add the kind and its placement rules to `PROP_SPECS` in `src/renderer/clutter.ts`, write a class implementing `PropRenderer` (`src/renderer/props/types.ts`), and add it to `PROP_RENDERERS` in `src/renderer/props/index.ts`. Leaving it out of the registry is a compile error. A renderer gets the canvas, the square size, a seeded random source and the theme's prop palette, so it works in every theme. The tests draw every renderer onto a recording fake canvas to check it stays inside its footprint, uses only palette colours and draws the same way every time.

## Layout

```
src/
  main/main.ts          Electron main process (ESM): window, menu, file dialogs
  main/preload.cts      Narrow IPC bridge; CommonJS because sandboxed preloads require it
  shared/ipc.ts         IPC types shared by main, preload and renderer
  renderer/
    index.html, styles.css
    app.ts              UI wiring
    generator.ts        Dungeon generation (pure, no DOM)
    editor.ts           Hand-editing operations and the consistency pass (pure, no DOM)
    editor-ui.ts        Edit mode: tools, undo history and drawing previews
    clutter.ts          Room furniture: prop types, per-setting pools, room-name hints, placement
    props/
      types.ts          PropRenderer, PropPaintContext, PropPalette
      index.ts          Registry: one renderer per prop kind
      containers.ts, furniture.ts, debris.ts, fixtures.ts, tech.ts
      draw.ts           Shared drawing helpers
    cells.ts            Cell types and grid directions shared across modules
    genres.ts           Settings: content tables, vocabulary, default theme and layout
    contents.ts         Room stocking (d6 monster / trap / special / empty)
    walls.ts            Wall and pillar geometry derived from the grid
    renderer.ts         Canvas drawing; themes are data that pick rock/floor/door/stair/pillar/decor painters
    depth.ts            Depth and lighting: shadows, ambient occlusion, wall bevels, light pools
    text.ts             slugify, base64, and an escaping `html` template for export summaries
    export/
      types.ts          ExportStrategy, ExportContext, ExportTarget, ExportResult
      index.ts          Registry: the list of strategies shown in the export dialog
      roll20.ts, foundry.ts, uvtt.ts, image.ts, roomkey.ts
      fantasygrounds.ts Unity (line-of-sight XML) and Classic (images + story entries) modules
    zip.ts              Minimal zip writer (used for .mod files)
    rng.ts              Seeded RNG
test/                   Unit tests, one file per module (export tests under test/export/)
  helpers.ts            Shared invariants and fakes: a recording canvas, an export context, a zip reader
scripts/build.ts        Clean build: tsc for main and renderer, then copy static files
tsconfig.*.json         base / main (NodeNext) / renderer (DOM, ES modules) / root (typecheck everything)
```

Imports in the source use `.ts` extensions. With `rewriteRelativeImportExtensions`, `tsc` rewrites them to `.js` in the output, and Node can also run the source directly. This is why the tests need no build.

To ship installers, add [electron-builder](https://www.electron.build/) and run `npx electron-builder`.
