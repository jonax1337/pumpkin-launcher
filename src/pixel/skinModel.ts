import type { SkinVariant } from "@/lib/types";

/*
 * Gestalt der Spielerfigur für die 3D-Vorschau: Quader aus der Skin-Textur, wie Minecraft sie baut (Grundschicht, darüber
 * die zweite Schicht), dazu der Umhang. Raum in Texturpixeln: x nach rechts, y nach unten, z von der Kamera weg;
 * die Figur blickt bei 0° in die Kamera. `meshData` macht daraus Dreiecke für die Grafikkarte (y nach oben, Figurmitte im Ursprung).
 */

/** Größe der Zeichenfläche in Texturpixeln: Platz für Arme im Quereck, Umhang und die Neigung. */
export const FRAME = { w: 18, h: 34 } as const;
/** Die Figurmitte liegt auf halber Höhe der Figur (32 Texturpixel von Kopf bis Sohle). */
const CENTER_Y = 16;

/** Abstand der zweiten Schicht von der ersten: Kopf 0,5, alles andere 0,25 Texturpixel. */
const HEAD_GROW = 0.5;
const BODY_GROW = 0.25;
/** Der Umhang hängt oben fest und schwingt unten nach hinten, wie im Spiel. */
const CAPE_PIVOT = { y: 8, z: 2.5 } as const;
const CAPE_SWING = (7 * Math.PI) / 180;
/** Breite des Skin-Atlas in Texturpixeln; die Höhe (64 oder 32) hängt vom Skin ab. */
const ATLAS_WIDTH = 64;

type Vec3 = readonly [x: number, y: number, z: number];
type Point = readonly [x: number, y: number];
/** Bereich der Textur in Texturpixeln. */
type Area = readonly [x: number, y: number, w: number, h: number];

/** Eine Fläche: Ecken von außen gesehen (oben links, oben rechts, unten rechts, unten links), Außennormale und Ausschnitt der Textur. */
interface Quad {
  corners: readonly [Vec3, Vec3, Vec3, Vec3];
  normal: Vec3;
  source: Area;
  /** Das alte Format kennt keine linken Gliedmaßen: Minecraft spiegelt dann die rechten. */
  mirror: boolean;
}

/** Körperteil: Ecke, Maße (Breite, Höhe, Tiefe), Ursprung in der Textur und, falls es im alten Format fehlt, das gespiegelte Vorbild. */
type Part = {
  at: Vec3;
  size: Vec3;
  base: Point;
  layer: Point;
  grow: number;
  legacy?: Point;
};

/**
 * Quader mit den Texturen im Layout des Spiels (rechts | vorn | links | hinten unter der Oberseite).
 * Die Unterseite fehlt: die Figur wird nie von unten gezeigt.
 */
function box({ at: [x, y, z], size: [w, h, d] }: Part, [u, v]: Point, grow: number, mirror: boolean): Quad[] {
  const [x0, x1, y0, y1, z0, z1] = [x - grow, x + w + grow, y - grow, y + h + grow, z - grow, z + d + grow];
  const [top, right, front, left, back]: Area[] = [[u + d, v, w, d], [u, v + d, d, h], [u + d, v + d, w, h], [u + d + w, v + d, d, h], [u + 2 * d + w, v + d, w, h]];
  // Gespiegelt tauschen Außen- und Innenseite ihre Ausschnitte.
  const [towardLeft, towardRight] = mirror ? [left, right] : [right, left];
  const quad = (corners: Quad["corners"], normal: Vec3, source: Area): Quad => ({ corners, normal, source, mirror });
  return [
    quad([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1], front),
    quad([[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]], [0, 0, 1], back),
    quad([[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]], [-1, 0, 0], towardLeft),
    quad([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0], towardRight),
    quad([[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], [0, -1, 0], top),
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

/** Flächen der Figur; `rows` ist die Höhe der Textur in Texturpixeln (64, bei alten Skins 32). */
function skinQuads(variant: SkinVariant, rows: number): Quad[] {
  const all = parts(variant);
  const bases = all.flatMap((part) => {
    const [, h, d] = part.size;
    const legacy = part.legacy && part.base[1] + d + h > rows ? part.legacy : null;
    return box(part, legacy ?? part.base, 0, legacy != null);
  });
  const layers = all
    .filter(({ layer, size: [, h, d] }) => layer[1] + d + h <= rows)
    .flatMap((part) => box(part, part.layer, part.grow, false));
  return [...bases, ...layers];
}

/** Dreht um die Querachse: was unterhalb der Achse liegt (y wächst nach unten), wandert nach hinten. */
function swingBack([x, y, z]: Vec3): Vec3 {
  const [sin, cos] = [Math.sin(CAPE_SWING), Math.cos(CAPE_SWING)];
  return [x, y * cos - z * sin, y * sin + z * cos];
}

/** Ein Punkt des Umhangs an seinem Aufhängepunkt vorbei nach hinten geschwungen. */
function hang(point: Vec3): Vec3 {
  const [x, y, z] = swingBack([point[0], point[1] - CAPE_PIVOT.y, point[2] - CAPE_PIVOT.z]);
  return [x, y + CAPE_PIVOT.y, z + CAPE_PIVOT.z];
}

/** Der Umhang hängt hinter dem Körper: außen (zum Rücken hin sichtbar) und innen, dazu die schmalen Kanten und die Oberseite. */
function capeQuads(): Quad[] {
  const [x0, x1, y0, y1, z0, z1] = [-5, 5, CAPE_PIVOT.y, 24, 2, 3];
  const quad = ([a, b, c, d]: Quad["corners"], normal: Vec3, source: Area): Quad => ({
    corners: [hang(a), hang(b), hang(c), hang(d)],
    normal: swingBack(normal),
    source,
    mirror: false,
  });
  return [
    quad([[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]], [0, 0, 1], [1, 1, 10, 16]),
    quad([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1], [12, 1, 10, 16]),
    quad([[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]], [-1, 0, 0], [0, 1, 1, 16]),
    quad([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0], [11, 1, 1, 16]),
    quad([[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], [0, -1, 0], [1, 0, 10, 1]),
  ];
}

/** Die vier Texturkoordinaten einer Fläche in derselben Reihenfolge wie ihre Ecken, gespiegelt, wenn die Fläche es verlangt. */
function cornerUvs({ source: [x, y, w, h], mirror }: Quad): Point[] {
  const [left, right] = mirror ? [x + w, x] : [x, x + w];
  return [[left, y], [right, y], [right, y + h], [left, y + h]];
}

/** Floats je Ecke: Ort (3), Normale (3), Textur (2). */
export const VERTEX_FLOATS = 8;

/**
 * Dreiecke für die Grafikkarte, Ecke für Ecke Ort, Normale und Textur (0…1). Aus „y nach unten“ wird „y nach oben“ um die Figurmitte;
 * `rows` ist die Höhe der Textur in Texturpixeln.
 */
function meshData(quads: Quad[], rows: number): Float32Array {
  const vertex = ([x, y, z]: Vec3, [nx, ny, nz]: Vec3, [u, v]: Point) => [x, CENTER_Y - y, z, nx, -ny, nz, u / ATLAS_WIDTH, v / rows];
  // Gegen den Uhrzeigersinn von außen gesehen: oben links, unten links, unten rechts, dann oben links, unten rechts, oben rechts.
  const triangles = [0, 3, 2, 0, 2, 1];
  return new Float32Array(
    quads.flatMap((quad) => {
      const uvs = cornerUvs(quad);
      return triangles.flatMap((i) => vertex(quad.corners[i], quad.normal, uvs[i]));
    }),
  );
}

export const skinMesh = (variant: SkinVariant, rows: number) => meshData(skinQuads(variant, rows), rows);
export const capeMesh = (rows: number) => meshData(capeQuads(), rows);
