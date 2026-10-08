/**
 * Pixel-Icons des Kits: ein 8×8-Raster je Icon (Entwurf: docs/design/concepts/launcher/icons/set-a.mjs + set-b.mjs).
 * Zeichen: `X` = voll, `o` = zweiter Ton (50 % Deckkraft), `.` = leer.
 * Regel: 1 Icon-Pixel = 1 Zelle; die Zellgröße legt der Größen-Slot fest (ui/Icon, unit.ts), nie gebrochen skaliert.
 */
import { rowRuns } from "./rows.ts";

type Row8 = readonly [string, string, string, string, string, string, string, string];

const ICON_SET = {
  // Oberfläche und Aktionen
  home: ["...XX...", "..XXXX..", ".XXXXXX.", "XXXXXXXX", ".XX..XX.", ".XX..XX.", ".XX..XX.", ".XX..XX."],
  library: [".XXXXXX.", "XXXXXXXX", "XXXXXXXX", "........", "XXXXXXXX", "XXXooXXX", "XXXooXXX", "XXXXXXXX"],
  discover: [".XXXX...", "XXooXX..", "XooooX..", "XooooX..", "XXooXX..", ".XXXXXX.", "....XXXX", ".....XXX"],
  skins: [".XX..XX.", "XXXooXXX", "XXXXXXXX", "XXXXXXXX", "ooXXXXoo", "..XXXX..", "..XXXX..", "..oooo.."],
  friends: ["...ooooo", "...ooooo", "...o.o.o", "XXXXXooo", "XXXXXooo", "X.X.X...", "XXXXX...", "XXXXX..."],
  news: ["XX......", "oXXXX...", "oXXXXXXX", "oXXXXXXX", "oXXXXXXX", "oXXXXX..", "oXX.XXX.", "....XX.."],
  tasks: ["..XXXX..", "XXXXXXXX", "XoXXXXoX", "X......X", "XoXXXXoX", "X......X", "XoXXXXoX", "XXXXXXXX"],
  settings: [".X.XX.X.", "XXXXXXXX", ".XXXXXX.", "XXX..XXX", "XXX..XXX", ".XXXXXX.", "XXXXXXXX", ".X.XX.X."],
  play: ["XX......", "XXXX....", "XXXXXX..", "XXXXXXXX", "XXXXXXXX", "XXXXXX..", "XXXX....", "XX......"],
  stop: ["........", ".XXXXXo.", ".XXXXXo.", ".XXXXXo.", ".XXXXXo.", ".XXXXXo.", ".oooooo.", "........"],
  plus: ["........", "...XX...", "...XX...", ".XXXXXX.", ".XXXXXX.", "...XX...", "...XX...", "........"],
  minus: ["........", "........", "........", ".XXXXXX.", ".XXXXXX.", "........", "........", "........"],
  close: ["XX....XX", ".XX..XX.", "..XXXX..", "...XX...", "...XX...", "..XXXX..", ".XX..XX.", "XX....XX"],
  check: ["........", "......XX", ".....XXX", "XX..XXX.", "XXXXXX..", ".XXXX...", "..XX....", "........"],
  search: [".XXXX...", "XX..XX..", "X....X..", "X....X..", "XX..XX..", ".XXXXXX.", ".....XXX", "......XX"],
  download: ["...XX...", "...XX...", ".XXXXXX.", "..XXXX..", "...XX...", "........", "X......X", "XXXXXXXX"],
  upload: ["...XX...", "..XXXX..", ".XXXXXX.", "...XX...", "...XX...", "........", "X......X", "XXXXXXXX"],
  trash: ["..XXXX..", "XXXXXXXX", ".XXXXXX.", ".XoXXoX.", ".XoXXoX.", ".XoXXoX.", ".XoXXoX.", ".XXXXXX."],
  folder: ["XXXX....", "XXXXXXXX", "XooooooX", "XooooooX", "XooooooX", "XooooooX", "XooooooX", "XXXXXXXX"],
  "folder-open": ["XXXX....", "X..XXXX.", "X.....X.", "X..XXXXX", "X.XooooX", "XXoooooX", "XooooooX", "XXXXXXXX"],
  copy: ["XXXXX...", "X...X...", "X..XXXXX", "X..XoooX", "X..XoooX", "XXXXoooX", "...XoooX", "...XXXXX"],
  edit: [".....XX.", "....XXXX", "...XXXX.", "..XXXX..", ".XXXX...", ".XXX....", "XXX.....", "XX......"],
  refresh: ["..XXXX.X", ".X....XX", "X....XXX", "X.......", ".......X", "XXX....X", "XX....X.", "X.XXXX.."],
  undo: ["........", "..X.....", ".XX.....", "XXXXXXX.", ".XXXXXXX", "..X...XX", ".....XXX", "..XXXXX."],
  external: ["....XXXX", ".....XXX", "XXX.XX.X", "X..XX..X", "X.XX...X", "X......X", "X......X", "XXXXXXXX"],
  link: ["........", ".XXXX...", "XX..XX..", "X....XXX", "XXX....X", "..XX..XX", "...XXXX.", "........"],
  share: ["......XX", "......XX", "....XX..", "XX.XX...", "XX.XX...", "....XX..", "......XX", "......XX"],
  filter: ["XXXXXXXX", "XXXXXXXX", ".XXXXXX.", "..XXXX..", "...XX...", "...XX...", "...XX...", "...oo..."],
  sort: ["XXXX.XX.", "XXXX.XX.", ".....XX.", "XXX..XX.", "XXX..XX.", "....XXXX", "XX...XX.", "XX......"],
  list: ["XX.XXXXX", "XX.XXXXX", "........", "XX.XXXXX", "XX.XXXXX", "........", "XX.XXXXX", "XX.XXXXX"],
  grid: ["XXX..XXX", "XXX..XXX", "XXo..XXo", "........", "........", "XXX..XXX", "XXX..XXX", "XXo..XXo"],
  more: ["...XX...", "...Xo...", "........", "...XX...", "...Xo...", "........", "...XX...", "...Xo..."],
  "chev-down": ["........", "........", "XX....XX", ".XX..XX.", "..XXXX..", "...XX...", "........", "........"],
  "chev-up": ["........", "........", "...XX...", "..XXXX..", ".XX..XX.", "XX....XX", "........", "........"],
  "chev-left": [".....XX.", "....XX..", "...XX...", "..XX....", "..XX....", "...XX...", "....XX..", ".....XX."],
  "chev-right": [".XX.....", "..XX....", "...XX...", "....XX..", "....XX..", "...XX...", "..XX....", ".XX....."],
  "arrow-left": ["...X....", "..XX....", ".XXX....", "XXXXXXXX", "XXXXXXXX", ".XXX....", "..XX....", "...X...."],
  "arrow-up": ["...XX...", "..XXXX..", ".XXXXXX.", "XXXXXXXX", "...XX...", "...XX...", "...XX...", "...XX..."],
  menu: [".XXXXXX.", ".XXXXXX.", "........", ".XXXXXX.", ".XXXXXX.", "........", ".XXXXXX.", ".XXXXXX."],
  eye: ["........", "..XXXX..", ".XX..XX.", "XX.XX.XX", "XX.XX.XX", ".XX..XX.", "..XXXX..", "........"],
  "eye-off": ["......XX", "..oo.XX.", ".oo.XX..", "oo.XX.oo", "o.XX..oo", ".XX..oo.", "XX.ooo..", "X......."],
  lock: ["..XXXX..", ".XX..XX.", ".XX..XX.", ".XXXXXX.", ".XX..XX.", ".XXooXX.", ".XXXXXX.", ".oooooo."],
  key: ["........", ".XXX....", "XX.XX...", "XX.XXXXX", "XXXXXXXX", ".XXX.X.X", ".....X.X", "........"],
  user: ["..XXXX..", ".XXXXXX.", ".XXXXXX.", "..XXXX..", "........", ".XXXXXX.", "XXXXXXXX", "oooooooo"],
  logout: ["XXXXX...", "XX...X..", "XX...XX.", "XX.XXXXX", "XX.XXXXX", "XX...XX.", "XX...X..", "XXXXX..."],
  clock: ["..XXXX..", ".XXXXXX.", "XXoXooXX", "XXoXooXX", "XXoXXoXX", "XXooooXX", ".XXXXXX.", "..XXXX.."],
  power: ["...XX...", ".X.XX.X.", "XX.XX.XX", "X..XX..X", "X......X", "XX....XX", ".XX..XX.", "..XXXX.."],
  swap: ["....X...", "XXXXXX..", "XXXXXXX.", "....XX..", "..XX....", ".XXXXXXX", "..XXXXXX", "...X...."],
  "win-min": ["........", "........", "........", "........", "........", ".XXXXXX.", ".XXXXXX.", "........"],
  "win-max": ["........", ".XXXXXX.", ".XXXXXX.", ".XX..XX.", ".XX..XX.", ".XX..XX.", ".XXXXXX.", "........"],
  "win-close": ["........", ".XX..XX.", "..XXXX..", "...XX...", "...XX...", "..XXXX..", ".XX..XX.", "........"],
  terminal: ["XXXXXXXX", "X......X", "X.X....X", "X..X...X", "X.X.XX.X", "X......X", "X......X", "XXXXXXXX"],
  select: ["XXXXXXXX", "X......X", "X....X.X", "XX..XX.X", "X.XXX..X", "X..X...X", "X......X", "XXXXXXXX"],
  pin: ["..XXXX..", ".XXXXXX.", "XXX..XXX", "XXX..XXX", ".XXXXXX.", "..XXXX..", "...XX...", "...XX..."],
  // Inhalte, Spiel und Status
  box: ["..XXXXXX", ".XXXXXXo", "XXXXXXoo", "......oo", "XXXXXXoo", "XXXXXXoo", "XXXXXXo.", "XXXXXX.."],
  grass: ["XXXXXXXX", "XXXXXXXX", "XoXXoXoX", "oooXoooo", "ooooooXo", "oXooooo.", "ooooXooo", "oooooooo"],
  mod: ["...XX...", "..XXXX..", "...XX...", "XXXXXX..", "XXXXXXXX", "XXXXXXXX", "XXXXXX..", "XXXXXX.."],
  shader: ["..XXXX..", ".XXXXXo.", "XXXXXooo", "XXXXooo.", "XXXooo.o", "XXooo.o.", ".Xooo.o.", "..oo.o.."],
  resourcepack: ["XXXXXXXX", "XooXXooX", "XooXXooX", "XXXooXXX", "XXXooXXX", "XooXXooX", "XooXXooX", "XXXXXXXX"],
  datapack: [".XXXXXX.", "XXXXXXXX", ".XooooX.", ".XXXXXX.", ".XooooX.", ".XXXXXX.", ".XooXXXX", ".XXXXXXX"],
  modpack: [".oooooo.", ".o.XX.o.", "XXXXXXXX", "XooooooX", "XXXXXXXX", "XXXooXXX", "XXXooXXX", "XXXXXXXX"],
  world: ["..XXXX..", ".X.XX.X.", "X..XX..X", "XXXXXXXX", "XXXXXXXX", "X..XX..X", ".X.XX.X.", "..XXXX.."],
  server: ["XXXXXXXX", "XooooXoX", "XXXXXXXX", "........", "XXXXXXXX", "XooooXoX", "XXXXXXXX", "........"],
  screenshot: ["XXXXXXXX", "X...XX.X", "X...XX.X", "X.X....X", "XXXX..XX", "XXXXXXXX", "XXXXXXXX", "XXXXXXXX"],
  camera: ["..XXXX..", "XXXXXXXX", "XXX..XXX", "XX.XX.XX", "XX.XX.XX", "XXX..XXX", "XXXXXXXX", "oooooooo"],
  backup: ["XXooooX.", "XXooXoXX", "XXooooXX", "XXXXXXXX", "X......X", "X.oooo.X", "X......X", "XXXXXXXX"],
  cloud: ["........", "..XXX...", ".XXXXXX.", ".XXXXXXX", "XXXXXXXX", "XXXXXXXX", ".oooooo.", "........"],
  shield: ["XXXXXXXX", "XXXXoooX", "XXXXoooX", "XXXXoooX", ".XXXooo.", ".XXXooo.", "..XXoo..", "...XX..."],
  wifi: [".XXXXXX.", "XX....XX", "..XXXX..", ".XX..XX.", "...XX...", "........", "...XX...", "...XX..."],
  bolt: ["....XXXX", "...XXXX.", "..XXXX..", ".XXXXXXX", "....XXX.", "...XXX..", "..XXX...", "..XX...."],
  heart: ["........", ".XX..XX.", "XXXXXXXX", "XXXXXXXX", "XXXXXXXo", ".XXXXXo.", "..XXXo..", "...XX..."],
  star: ["...XX...", "...XX...", "XXXXXXXX", ".XXXXXX.", "..XXXX..", "..XXXXo.", ".XXo.XX.", ".X....X."],
  bell: ["...XX...", "..XXXX..", ".XXXXXX.", ".XXXXXo.", ".XXXXXo.", "XXXXXXXo", "........", "...XX..."],
  bug: [".X....X.", "..XXXX..", "X.XXXX.X", ".XXooXX.", "XXXooXXX", ".XXooXX.", "X.XXXX.X", "..XXXX.."],
  warn: ["...XX...", "..XXXX..", "..X..X..", ".XX..XX.", ".XX..XX.", "XXXXXXXX", "XXX..XXX", "XXXXXXXX"],
  info: ["..XXXX..", ".XXXXXX.", "XXX..XXX", "XXXXXXXX", "XXX..XXX", "XXX..XXX", ".XXXXXX.", "..XXXX.."],
  error: [".XXXXXX.", "X.XXXX.X", "XX.XX.XX", "XXX..XXX", "XXX..XXX", "XX.XX.XX", "X.XXXX.X", ".XXXXXX."],
  success: ["..XXXX..", ".XXXXXX.", "XXXXXX.X", "X.XXX.XX", "XX.X.XXX", "XXX.XXXX", ".XXXXXX.", "..XXXX.."],
  hourglass: ["XXXXXXXX", ".XooooX.", "..XooX..", "...XX...", "...XX...", "..XXXX..", ".XXXXXX.", "XXXXXXXX"],
  pickaxe: [".XXXXX..", "XXoooXX.", "X..XXoXX", "..XXX..X", ".XXX....", "XXX.....", "XX......", "........"],
  sword: ["......XX", ".....XXX", "....XXX.", "...XXX..", "..XXX...", ".XXXXX..", ".XX.....", "XX......"],
  potion: ["..XXXX..", "...XX...", "...XX...", "..XXXX..", ".XooooX.", "XXooooXX", "XoooooXX", ".XXXXXX."],
  map: ["...oo...", "XXXooXXX", "XoXooXXX", "XXXooXoX", "XXXooXXX", "XoXooXXX", "XXXooXXX", "XXX..XXX"],
  compass: ["..XXXX..", ".X...XX.", "X...XX.X", "X..XX..X", "X.oo...X", "Xoo....X", ".X....X.", "..XXXX.."],
  flag: ["XXXX....", "XXXXXX..", "XXXXXXXX", "XXXXXX..", "XXXX....", "XX......", "XX......", "XX......"],
  tag: ["........", "..XXXXXX", ".XXXXXXX", "XX..XXXX", "XX..XXXX", ".XXXXXXX", "..XXXXoo", "........"],
  file: [".XXXXX..", ".XXXXXX.", ".XooooX.", ".XXXXXX.", ".XooooX.", ".XXXXXX.", ".XooooX.", ".XXXXXX."],
  book: ["XXX..XXX", "XooXXooX", "XooXXooX", "XooXXooX", "XooXXooX", "XXXXXXXX", ".XXXXXX.", "........"],
  crown: ["X..XX..X", "XX.XX.XX", "XXXXXXXX", "XXXXXXXX", "XooXXooX", "XXXXXXXX", "XXXXXXXX", "oooooooo"],
  creeper: ["XXXXXXXX", "X..XX..X", "X..XX..X", "XXX..XXX", "XX....XX", "XX....XX", "XX.XX.XX", "XXXXXXXX"],
  pumpkin: ["...XXo..", ".XXXXXX.", "XXXXXXXX", "X..XX..X", "XX.XX.XX", "X.XXXX.X", "XX....XX", ".XXXXXoo"],
  microsoft: ["XXX.XXXo", "XXX.XXXo", "XXX.XXXo", "........", "XXX.XXXo", "XXX.XXXo", "XXX.XXXo", "ooooooo."],
  update: ["...XX...", "..XXXX..", ".XXXXXX.", "XXXXXXXX", "..XXXX..", "..XXXX..", "..XXXX..", "..XXXX.."],
  memory: ["........", "XXXXXXXX", "ooXooXoo", "ooXooXoo", "XXXXXXXX", "XX.XX.XX", "XX.XX.XX", "........"],
  java: ["..X..X..", "...X..X.", "XooooX..", "XXXXXXXX", "XXXXXX.X", "XXXXXXXX", ".XXXXX..", "XXXXXXX."],
  storage: [".XXXXXX.", "XXooooXX", "XXXXXXXX", ".oooooo.", "XXXXXXXX", "XXXXXXXX", ".oooooo.", ".XXXXXX."],
  palette: ["..XXXX..", ".XX..XX.", "XXXXXXXX", "XX.XXXX.", "XXXXXXXX", "XXXXX..X", ".XXXXXX.", "..XXXX.."],
  keyboard: ["XX.XX.XX", "XX.XX.XX", "........", "XX.XX.XX", "XX.XX.XX", "........", ".XXXXXX.", ".XXXXXX."],
  question: [".XXXXXX.", "XXX..XXX", "XX.XX.XX", "XXXX.XXX", "XXX..XXX", "XXXXXXXX", "XXX..XXX", ".XXXXXX."],
  sparkle: ["......X.", "...X.XXX", "...X..X.", "..XXX...", "XXXXXXX.", "..XXX...", "...X....", "...X...."],
  fire: ["...XX...", "...XXX..", "..XXXX..", ".XXXXXX.", "XXXooXXX", "XXooooXX", ".XXooXX.", "..XXXX.."],
  snow: ["...XX...", ".o.XX.o.", "..oXXo..", "XXXXXXXX", "XXXXXXXX", "..oXXo..", ".o.XX.o.", "...XX..."],
  leaf: ["....XXXX", "..XXXXXX", ".XXXXXoX", ".XXXXoXX", "XXXXoXX.", "XXXoXX..", "XXoXX...", "Xo......"],
  diamond: ["........", "..XXXX..", ".XooooX.", "XXXXXXXX", ".oXXXXo.", "..oXXo..", "...XX...", "........"],
  ender: ["..XXXX..", ".XooooX.", "XooooooX", "XooXXooX", "XooXXooX", "XooooooX", ".XooooX.", "..XXXX.."],
  brush: ["......XX", ".....XXX", "....XXX.", "...XXX..", "..ooo...", ".XXXo...", "XXXX....", "XXX....."],
  sun: ["...XX...", ".X....X.", "..XXXX..", "X.XXXX.X", "X.XXXX.X", "..XooX..", ".X....X.", "...XX..."],
  moon: ["..XXXX..", ".XXXX...", "XXXX....", "XXXX....", "XXXX....", "XXXXX...", ".XXXXXX.", "..XXXX.."],
  // Eigene Ergänzungen im selben Raster (Plattform-Logos stark vereinfacht; die Farbe trägt die Wiedererkennung)
  "arrow-down": ["...XX...", "...XX...", "...XX...", "...XX...", "XXXXXXXX", ".XXXXXX.", "..XXXX..", "...XX..."],
  dot: ["........", "........", "...XX...", "..XXXX..", "..XXXX..", "...XX...", "........", "........"],
  plug: ["..X..X..", "..X..X..", ".XXXXXX.", ".XXXXXX.", ".XXXXXX.", "..XXXX..", "...XX...", "...XX..."],
  save: ["XXXXXXX.", "X.XXXX.X", "X.XXXX.X", "X......X", "X.oooo.X", "X.oooo.X", "X.oooo.X", "XXXXXXXX"],
  modrinth: ["..XXXX..", ".X....X.", "X..XX..X", "X.XXXX.X", "X.XXXX.X", "X..XX..X", ".X....X.", "..XXXX.."],
  curseforge: ["XXXXXXXX", ".XXXXXXX", "..XXXXX.", "...XXX..", "...XXX..", "..XXXXX.", "..XXXXX.", ".XXXXXXX"],
  ftb: ["X......X", "XX....XX", ".XXXXXX.", "XXXXXXXX", "XX.XX.XX", "XXXXXXXX", ".XX..XX.", "..XXXX.."],
  technic: ["XXXXXXXX", "XXXXXXXX", "...XX...", "...XX...", "...XX...", "...XX...", "...XX...", "..XXXX.."],
} as const satisfies Record<string, Row8>;

/** Kantenlänge des Rasters (Zellen je Zeile und Spalte). */
export const ICON_CELLS = 8;

export type IconName = keyof typeof ICON_SET;
/** Alle Entwürfe des Satzes, z. B. für das Kit-Specimen. */
export const ICON_NAMES = Object.keys(ICON_SET) as IconName[];

/** Pixelform eines Icons: Pfade (voll, zweiter Ton) in Zellen-Einheiten und leere Spalten rechts. */
type IconShape = { solid: string; dim: string; blankEnd: number };

const SHAPES = new Map<IconName, IconShape>();

/** Je Lauf gleicher Zellen ein Rechteck (Zellen = viewBox-Einheiten). */
const cellsPath = (rows: readonly string[], cell: string) =>
  rowRuns(rows).filter((run) => run.cell === cell).map(({ x, y, length }) => `M${x} ${y}h${length}v1h${-length}z`).join("");

/** Pfade und rechter Leerraum eines Icons (gecacht). */
export function iconShape(name: IconName): IconShape {
  let shape = SHAPES.get(name);
  if (!shape) {
    const rows: readonly string[] = ICON_SET[name];
    const lastColumn = Math.max(...rows.map((row) => Math.max(row.lastIndexOf("X"), row.lastIndexOf("o"))));
    shape = { solid: cellsPath(rows, "X"), dim: cellsPath(rows, "o"), blankEnd: ICON_CELLS - 1 - lastColumn };
    SHAPES.set(name, shape);
  }
  return shape;
}
