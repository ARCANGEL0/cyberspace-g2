// Pixel frame for the G2 card UI.
//
// The frame (bevelled outline, header rule, hatch strips, section icon) is drawn
// on a canvas and sent as four image tiles, because text containers can only
// draw a plain rectangle border. Image containers cap at 288 x 144, so the
// 576-wide card is split into a 2 x 2 grid. Text is not drawn here: it stays in
// firmware text containers layered above the tiles.
//
// Grey levels are 0-15. 0 is off (see-through on glass), 15 is brightest.

export const SCREEN_W = 576
export const SCREEN_H = 288

/** Card outline, outer edge inclusive. */
export const CARD = { x0: 2, y0: 3, x1: 573, y1: 226 }
/** y of the rule under the header row. */
export const HEADER_RULE_Y = 42

const TILE_W = 288
const TOP_H = 144
const BOTTOM_H = CARD.y1 + 4 - TOP_H   // covers the bottom outline and ticks

export interface Tile {
  id: number
  name: string
  x: number
  y: number
  width: number
  height: number
}

export const TILES: Tile[] = [
  { id: 2, name: 'frame-tl', x: 0, y: 0, width: TILE_W, height: TOP_H },
  { id: 3, name: 'frame-tr', x: TILE_W, y: 0, width: TILE_W, height: TOP_H },
  { id: 4, name: 'frame-bl', x: 0, y: TOP_H, width: TILE_W, height: BOTTOM_H },
  { id: 5, name: 'frame-br', x: TILE_W, y: TOP_H, width: TILE_W, height: BOTTOM_H },
]

/** Tile that holds the header icon; the only one resent after the first paint. */
export const HEADER_TILE = TILES[1]

export type IconKind = 'trace' | 'feed' | 'circ' | 'cmail' | 'inbox' | 'notes' | 'mic' | 'mic-live'

/** What the top-right header slot shows. */
export interface HeaderMarks {
  icon: IconKind
}

const BEVEL = 18          // top-right and bottom-right chamfer
const SMALL_BEVEL = 8     // top-left and bottom-left chamfer
const BRIGHT = 15
const MID = 9
const DIM = 6

type Ctx = CanvasRenderingContext2D

function grey(ctx: Ctx, level: number): void {
  const v = Math.round(Math.max(0, Math.min(15, level)) * 17)
  ctx.fillStyle = `rgb(${v},${v},${v})`
}

function dot(ctx: Ctx, x: number, y: number, level: number, size = 1): void {
  grey(ctx, level)
  ctx.fillRect(x, y, size, size)
}

/** Pixel line with a square brush, so diagonals stay crisp. */
function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, level: number, size = 1): void {
  grey(ctx, level)
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  let x = x0
  let y = y0
  for (;;) {
    ctx.fillRect(x, y, size, size)
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x += sx }
    if (e2 < dx) { err += dx; y += sy }
  }
}

function polyline(ctx: Ctx, points: [number, number][], level: number, size = 1): void {
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    line(ctx, ax, ay, bx, by, level, size)
  }
}

function ring(ctx: Ctx, cx: number, cy: number, r: number, level: number, filled: boolean): void {
  grey(ctx, level)
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y)
      if (filled ? d <= r + 0.3 : Math.abs(d - r) < 0.75) ctx.fillRect(cx + x, cy + y, 1, 1)
    }
  }
}

function outline(ctx: Ctx): void {
  const { x0, y0, x1, y1 } = CARD
  // Outer edge, 2 px. Chamfered top-right and bottom-right, small cuts on the left.
  polyline(ctx, [
    [x0 + SMALL_BEVEL, y0],
    [x1 - BEVEL, y0],
    [x1 - 1, y0 + BEVEL - 1],
    [x1 - 1, y1 - BEVEL],
    [x1 - BEVEL, y1 - 1],
    [x0 + SMALL_BEVEL + 2, y1 - 1],
    [x0, y1 - SMALL_BEVEL - 3],
    [x0, y0 + SMALL_BEVEL],
    [x0 + SMALL_BEVEL, y0],
  ], BRIGHT, 2)

  // Inner second line around the top-right bevel: the "double bevel" ear.
  const inset = 6
  polyline(ctx, [
    [x1 - 120, y0 + inset],
    [x1 - BEVEL - 3, y0 + inset],
    [x1 - inset, y0 + BEVEL + 2],
    [x1 - inset, y0 + 70],
  ], BRIGHT, 1)
  line(ctx, x1 - inset - 1, y0 + 70, x1 - inset - 1, y0 + 74, BRIGHT, 2)

  // Inner second line along the bottom-right bevel, dimmer.
  polyline(ctx, [
    [x1 - inset, y1 - 64],
    [x1 - inset, y1 - BEVEL - 3],
    [x1 - BEVEL - 3, y1 - inset],
    [x1 - 90, y1 - inset],
  ], MID, 1)
}

function header(ctx: Ctx): void {
  const { x0, x1, y0 } = CARD
  // Title notch: a short bracket that drops from the top edge beside the title.
  line(ctx, x0 + 10, y0 + 8, x0 + 10, HEADER_RULE_Y - 8, BRIGHT, 1)
  line(ctx, x0 + 10, y0 + 8, x0 + 15, y0 + 8, BRIGHT, 1)
  // Header rule.
  line(ctx, x0 + 8, HEADER_RULE_Y, x1 - 8, HEADER_RULE_Y, BRIGHT, 2)
}

function edges(ctx: Ctx): void {
  const { x0, x1, y1 } = CARD
  // Left edge: dotted texture strip.
  for (let y = HEADER_RULE_Y + 14; y < y1 - 30; y += 2) {
    for (let x = x0 + 4; x <= x0 + 8; x += 2) dot(ctx, x + ((y >> 1) & 1), y, DIM)
  }
  // Right edge: diagonal hatch strip in the lower half.
  for (let y = 112; y < y1 - 40; y += 5) line(ctx, x1 - 12, y + 4, x1 - 8, y, MID, 1)
  // Bottom-left bracket tick.
  line(ctx, x0 + 5, y1 - 22, x0 + 5, y1 - 6, BRIGHT, 1)
  line(ctx, x0 + 5, y1 - 6, x0 + 16, y1 - 6, BRIGHT, 1)
}

// Icons as pixel bitmaps ('#' lit), drawn at native size so every pixel is deliberate.
const BITMAPS: Partial<Record<IconKind, string[]>> = {
  cmail: [
    '######################',
    '##..................##',
    '#.#................#.#',
    '#..#..............#..#',
    '#...#............#...#',
    '#....#..........#....#',
    '#.....#........#.....#',
    '#......#......#......#',
    '#.......#....#.......#',
    '#........####........#',
    '#....................#',
    '#....................#',
    '#....................#',
    '######################',
  ],
  inbox: [
    '......##......',
    '....######....',
    '...#......#...',
    '..#........#..',
    '..#........#..',
    '..#........#..',
    '..#........#..',
    '.#..........#.',
    '.#..........#.',
    '#............#',
    '##############',
    '.....#..#.....',
    '......##......',
  ],
  notes: [
    '##########....',
    '#........##...',
    '#........#.#..',
    '#........#..#.',
    '#........#####',
    '#............#',
    '#..########..#',
    '#............#',
    '#..########..#',
    '#............#',
    '#..######....#',
    '#............#',
    '##############',
  ],
  mic: [
    '....####....',
    '...#....#...',
    '...#....#...',
    '...#....#...',
    '...#....#...',
    '...#....#...',
    '.#.#....#.#.',
    '.#..####..#.',
    '..#......#..',
    '...######...',
    '.....##.....',
    '.....##.....',
    '...######...',
  ],
}
BITMAPS['mic-live'] = BITMAPS.mic!.map((r, y) => (y >= 1 && y <= 6 ? r.replace(/#\.{4}#/, '######') : r))

const ICON_H = 16

function bitmap(ctx: Ctx, rows: string[], x: number, y: number, level: number): void {
  grey(ctx, level)
  rows.forEach((r, dy) => {
    for (let dx = 0; dx < r.length; dx++) if (r[dx] === '#') ctx.fillRect(x + dx, y + dy, 1, 1)
  })
}

function box(ctx: Ctx, x: number, y: number, w: number, h: number, level: number): void {
  line(ctx, x + 1, y, x + w - 2, y, level)
  line(ctx, x + 1, y + h - 1, x + w - 2, y + h - 1, level)
  line(ctx, x, y + 1, x, y + h - 2, level)
  line(ctx, x + w - 1, y + 1, x + w - 1, y + h - 2, level)
}

/** Draw an icon with its right edge at `right`, vertically centred on cy. Returns its left edge. */
function icon(ctx: Ctx, kind: IconKind, right: number, cy: number): number {
  const top = cy - ICON_H / 2
  if (kind === 'trace') {
    polyline(ctx, [
      [right - 82, cy + 4], [right - 64, cy + 4], [right - 52, cy - 6],
      [right - 36, cy + 6], [right - 22, cy - 4], [right - 10, cy - 4], [right, cy - 10],
    ], BRIGHT, 1)
    for (const [x, y] of [[right - 52, cy - 6], [right - 22, cy - 4], [right, cy - 10]] as const) {
      ring(ctx, x, y, 2, BRIGHT, true)
    }
    return right - 82
  }
  if (kind === 'circ') {
    // Two chat bubbles: one behind on the right, one in front with typing dots.
    const x = right - 24
    box(ctx, x + 9, top - 1, 15, 11, BRIGHT)
    polyline(ctx, [[x + 19, top + 10], [x + 21, top + 13], [x + 21, top + 10]], BRIGHT)
    grey(ctx, 0)
    ctx.fillRect(x, top + 3, 14, 11)
    box(ctx, x, top + 3, 14, 11, BRIGHT)
    polyline(ctx, [[x + 3, top + 14], [x + 1, top + 17], [x + 6, top + 14]], BRIGHT)
    for (const dx of [3, 6, 9]) { grey(ctx, BRIGHT); ctx.fillRect(x + dx, top + 8, 2, 2) }
    return x
  }
  if (kind === 'feed') {
    // Broadcast mark: a dot and two arcs.
    const x = right - 16
    const cx = x + 1
    const by = top + 15
    grey(ctx, BRIGHT)
    ctx.fillRect(x, by - 2, 3, 3)
    for (let yy = -16; yy <= 0; yy++) {
      for (let xx = 0; xx <= 16; xx++) {
        const d = Math.sqrt(xx * xx + yy * yy)
        if (Math.abs(d - 8) < 0.9 || Math.abs(d - 14) < 0.9) ctx.fillRect(cx + xx, by + yy, 1, 1)
      }
    }
    return x
  }
  const rows = BITMAPS[kind]!
  const x = right - rows[0].length
  bitmap(ctx, rows, x, cy - Math.ceil(rows.length / 2), BRIGHT)
  return x
}

/** Section icon at the right of the header. */
function headerMarks(ctx: Ctx, m: HeaderMarks): void {
  icon(ctx, m.icon, CARD.x1 - 34, 22)
}

function makeCanvas(width: number, height: number): [HTMLCanvasElement, Ctx] {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  grey(ctx, 0)
  ctx.fillRect(0, 0, width, height)
  return [canvas, ctx]
}

/** Draw the whole card frame at screen coordinates. */
export function drawFrame(marks: HeaderMarks): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(SCREEN_W, TOP_H + BOTTOM_H)
  outline(ctx)
  header(ctx)
  edges(ctx)
  headerMarks(ctx, marks)
  return canvas
}

/** Cut one tile out of the full frame and encode it as PNG bytes. */
export async function tilePng(frame: HTMLCanvasElement, tile: Tile): Promise<number[]> {
  const [canvas, ctx] = makeCanvas(tile.width, tile.height)
  ctx.drawImage(frame, tile.x, tile.y, tile.width, tile.height, 0, 0, tile.width, tile.height)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('tile encode failed'))), 'image/png')
  })
  return Array.from(new Uint8Array(await blob.arrayBuffer()))
}
