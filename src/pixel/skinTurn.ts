import type { SkinVariant } from "@/lib/types";
import { textureScale, type SkinSheet } from "./skin";

/*
 * Drehbare Spielerfigur aus der Skin-Textur, ohne WebGL: Quader, deren senkrechte Flächen als Streifen gezeichnet
 * werden. Gedreht wird nur um die Hochachse, den Blick richtet man waagerecht: Ober- und Unterseiten bleiben unsichtbar,
 * jede Fläche staucht sich nur in der Breite. Raum in Texturpixeln: x nach rechts, y nach unten, z von der Kamera weg;
 * die Figur blickt bei 0° in die Kamera. Gezeichnet wird in Viertelpixeln (SCALE), damit die zweite Schicht, die
 * 0,25 bzw. 0,5 Texturpixel absteht, ganzzahlig liegt.
 */

/** Größe der Zeichenfläche in Texturpixeln: breit genug für die Arme im Quereck und den Umhang. */
export const TURN = { w: 18, h: 32 } as const;
/** Bildpunkte der Zeichenfläche je Texturpixel. */
export const TURN_SCALE = 4;

/** Abstand der zweiten Schicht von der ersten: Kopf 0,5, alles andere 0,25 Texturpixel. */
const HEAD_GROW = 0.5;
const BODY_GROW = 0.25;
/** Eine Fläche, die nur noch auf der Kante steht, ist unsichtbar. */
const EDGE_ON = 0.01;

type Point = readonly [x: number, y: number];
/** Bereich der Textur in Texturpixeln. */
type Area = readonly [x: number, y: number, w: number, h: number];

/** Senkrechte Fläche: Strecke in der Draufsicht (x, z), Höhe, Richtung ihrer Außenseite und Ausschnitt der Textur. */
interface Face {
  from: Point;
  to: Point;
  top: number;
  bottom: number;
  normal: Point;
  source: Area;
  /** Das alte Format kennt keine linken Gliedmaßen: Minecraft spiegelt dann die rechten. */
  mirror: boolean;
  texture: "skin" | "cape";
}

/** Körperteil: Ecke, Maße (Breite, Höhe, Tiefe), Ursprung in der Textur und, falls es im alten Format fehlt, das gespiegelte Vorbild. */
type Part = {
  at: readonly [x: number, y: number, z: number];
  size: readonly [w: number, h: number, d: number];
  base: Point;
  layer: Point;
  grow: number;
  legacy?: Point;
};

/** Quader als vier Seitenflächen, Texturlayout wie im Spiel: rechts | vorn | links | hinten nebeneinander unter der Oberseite. */
function sides(part: Part, uv: Point, mirror: boolean, grow: number): Face[] {
  const [x, y, z] = part.at;
  const [w, h, d] = part.size;
  const [u, v] = uv;
  const [x0, x1, z0, z1] = [x - grow, x + w + grow, z - grow, z + d + grow];
  const [top, bottom] = [y - grow, y + h + grow];
  const area = (offset: number, width: number): Area => [u + offset, v + d, width, h];
  const [right, front, left, back] = [area(0, d), area(d, w), area(d + w, d), area(2 * d + w, w)];
  const face = (from: Point, to: Point, normal: Point, source: Area): Face => ({ from, to, top, bottom, normal, source, mirror, texture: "skin" });
  return [
    face([x0, z0], [x1, z0], [0, -1], front),
    face([x1, z1], [x0, z1], [0, 1], back),
    // Gespiegelt tauschen Außen- und Innenseite ihre Ausschnitte.
    face([x0, z0], [x0, z1], [-1, 0], mirror ? left : right),
    face([x1, z0], [x1, z1], [1, 0], mirror ? right : left),
  ];
}

function parts(variant: SkinVariant): Part[] {
  const arm = variant === "slim" ? 3 : 4;
  return [
    { at: [-4, 0, -4], size: [8, 8, 8], base: [0, 0], layer: [32, 0], grow: HEAD_GROW },
    { at: [-4, 8, -2], size: [8, 12, 4], base: [16, 16], layer: [16, 32], grow: BODY_GROW },
    { at: [-4 - arm, 8, -2], size: [arm, 12, 4], base: [40, 16], layer: [40, 32], grow: BODY_GROW },
    { at: [4, 8, -2], size: [arm, 12, 4], base: [32, 48], layer: [48, 48], grow: BODY_GROW, legacy: [40, 16] },
    { at: [-4, 20, -2], size: [4, 12, 4], base: [0, 16], layer: [0, 32], grow: BODY_GROW },
    { at: [0, 20, -2], size: [4, 12, 4], base: [16, 48], layer: [0, 48], grow: BODY_GROW, legacy: [0, 16] },
  ];
}

/** Flächen der Figur, Grundschicht vor der zweiten Schicht (bei gleicher Tiefe zeichnet die spätere über der früheren). */
function skinFaces(variant: SkinVariant, rows: number): Face[] {
  const inTexture = ({ source: [, y, , h] }: Face) => y + h <= rows;
  const bases = parts(variant).flatMap((part) => {
    const [, h, d] = part.size;
    const legacy = part.legacy && part.base[1] + d + h > rows ? part.legacy : null;
    return sides(part, legacy ?? part.base, legacy != null, 0);
  });
  const layers = parts(variant).flatMap((part) => sides(part, part.layer, false, part.grow));
  return [...bases, ...layers].filter(inTexture);
}

/** Der Umhang hängt hinter dem Körper: außen (zum Rücken hin sichtbar) und innen, dazu die schmalen Kanten. */
function capeFaces(): Face[] {
  const [x0, x1, z0, z1, top, bottom] = [-5, 5, 2, 3, 8, 24];
  const face = (from: Point, to: Point, normal: Point, source: Area): Face => ({ from, to, top, bottom, normal, source, mirror: false, texture: "cape" });
  return [
    face([x1, z1], [x0, z1], [0, 1], [1, 1, 10, 16]),
    face([x0, z0], [x1, z0], [0, -1], [12, 1, 10, 16]),
    face([x0, z0], [x0, z1], [-1, 0], [0, 1, 1, 16]),
    face([x1, z0], [x1, z1], [1, 0], [11, 1, 1, 16]),
  ];
}

/** Eine sichtbare Fläche nach der Drehung: Spanne auf der Bildschirm-x-Achse und Tiefe (kleiner = näher). */
interface Placed {
  face: Face;
  x0: number;
  x1: number;
  depth: number;
}

/** Dreht eine Fläche um die Hochachse; `null`, wenn ihre Außenseite von der Kamera wegzeigt. */
function place(face: Face, turn: number): Placed | null {
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  const [fromX, fromZ] = [face.from[0] * cos + face.from[1] * sin, -face.from[0] * sin + face.from[1] * cos];
  const [toX, toZ] = [face.to[0] * cos + face.to[1] * sin, -face.to[0] * sin + face.to[1] * cos];
  const facing = -face.normal[0] * sin + face.normal[1] * cos;
  if (facing > -EDGE_ON) return null;
  return { face, x0: Math.min(fromX, toX), x1: Math.max(fromX, toX), depth: (fromZ + toZ) / 2 };
}

/** Eine Fläche als Streifen auf die Zeichenfläche; Textur und Gespiegeltes wie in `Face`. */
function paint(ctx: CanvasRenderingContext2D, { face, x0, x1 }: Placed, source: { image: CanvasImageSource; unit: number }) {
  const [left, right] = [Math.round((x0 + TURN.w / 2) * TURN_SCALE), Math.round((x1 + TURN.w / 2) * TURN_SCALE)];
  if (right <= left) return;
  const [sx, sy, sw, sh] = face.source.map((n) => n * source.unit);
  const [top, height] = [face.top * TURN_SCALE, (face.bottom - face.top) * TURN_SCALE];
  ctx.save();
  if (face.mirror) {
    ctx.translate(left + right, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source.image, sx, sy, sw, sh, left, top, right - left, height);
  ctx.restore();
}

/**
 * Zeichnet die Figur um `turn` Grad gedreht (0 = von vorn, 180 = von hinten), mit Umhang, falls einer da ist.
 * `ctx` gehört einer Fläche von `TURN` mal `TURN_SCALE` Bildpunkten.
 */
export function drawTurned(ctx: CanvasRenderingContext2D, skin: SkinSheet, variant: SkinVariant, turn: number, cape: HTMLImageElement | null) {
  const radians = (turn * Math.PI) / 180;
  const faces = [...skinFaces(variant, skin.rows), ...(cape ? capeFaces() : [])];
  const visible = faces.map((face) => place(face, radians)).filter((placed): placed is Placed => placed != null);
  // Stabil sortiert: bei gleicher Tiefe bleibt die Reihenfolge der Liste (Grundschicht, dann zweite Schicht).
  visible.sort((a, b) => b.depth - a.depth);
  ctx.clearRect(0, 0, TURN.w * TURN_SCALE, TURN.h * TURN_SCALE);
  ctx.imageSmoothingEnabled = false;
  const sources = {
    skin: { image: skin.texture, unit: skin.unit },
    cape: cape && { image: cape, unit: textureScale(cape).unit },
  };
  for (const placed of visible) {
    const source = sources[placed.face.texture];
    if (source) paint(ctx, placed, source);
  }
}
