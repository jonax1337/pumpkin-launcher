import type { SkinVariant } from "@/lib/types";
import { textureScale, type SkinSheet } from "./skin";
import { capeMesh, FRAME, skinMesh, VERTEX_FLOATS } from "./skinModel";

/*
 * Beleuchtete 3D-Figur mit WebGL. Alle Vorschauen teilen sich eine einzige Zeichenfläche (Browser erlauben nur wenige
 * WebGL-Kontexte, eine Bibliothek hat viele Skins): `drawFigure` rendert dorthin und kopiert das Bild in das Canvas der Vorschau.
 * Das Licht steht fest zur Kamera, die Figur dreht sich darin; so wandert die Schattierung über die Flächen, wenn man sie dreht.
 */

/** Kamera: Tangens des halben Blickwinkels (kleines Bildfeld = kaum Verzerrung), Abstand so, dass `FRAME.h` genau ins Bild passt. */
const TAN_HALF_FOV = 0.2;
const CAMERA_DISTANCE = FRAME.h / 2 / TAN_HALF_FOV;
/** Wie viele Texturen auf der Grafikkarte bleiben, bevor die am längsten ungenutzte freigegeben wird. */
const MAX_TEXTURES = 32;

const VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform mat3 uRotation;
varying vec3 vNormal;
varying vec2 vUv;
varying float vHeight;
void main() {
  vec3 p = uRotation * aPosition;
  float depth = p.z + ${CAMERA_DISTANCE.toFixed(3)};
  // Perspektive mit w = Tiefe; Tiefenbereich 1…400.
  gl_Position = vec4(p.x / (${TAN_HALF_FOV} * ${(FRAME.w / FRAME.h).toFixed(5)}), p.y / ${TAN_HALF_FOV}, 1.005 * depth - 2.005, depth);
  vNormal = uRotation * aNormal;
  vUv = aUv;
  vHeight = aPosition.y;
}`;

/** Figur: Textur mit Durchsicht (zweite Schicht), Licht aus drei Richtungen und leicht abgedunkelte Füße. */
const FIGURE_FRAGMENT = `
precision mediump float;
uniform sampler2D uTexture;
varying vec3 vNormal;
varying vec2 vUv;
varying float vHeight;
const vec3 AMBIENT = vec3(0.38, 0.42, 0.52);
const vec3 KEY = vec3(0.84, 0.72, 0.52);
const vec3 FILL = vec3(0.17, 0.22, 0.36);
const vec3 RIM = vec3(0.26, 0.21, 0.20);
void main() {
  vec4 texel = texture2D(uTexture, vUv);
  if (texel.a < 0.5) discard;
  vec3 n = normalize(vNormal);
  vec3 light = AMBIENT
    + KEY * max(dot(n, normalize(vec3(-0.5, 0.75, -0.55))), 0.0)
    + FILL * max(dot(n, normalize(vec3(0.85, 0.15, -0.3))), 0.0)
    + RIM * max(dot(n, normalize(vec3(0.4, 0.3, 0.85))), 0.0);
  light *= mix(0.74, 1.0, smoothstep(-16.0, 16.0, vHeight));
  gl_FragColor = vec4(texel.rgb * light, 1.0);
}`;

interface Mesh {
  buffer: WebGLBuffer;
  vertices: number;
}

interface Program {
  handle: WebGLProgram;
  rotation: WebGLUniformLocation;
}

interface Gpu {
  gl: WebGLRenderingContext;
  figure: Program;
  meshes: Map<string, Mesh>;
  /** In Reihenfolge der letzten Benutzung: vorn die am längsten ungenutzte. */
  textures: Map<TexImageSource, WebGLTexture>;
}

/** Was die Figur trägt und wie sie steht (Grad: `turn` um die Hochachse, `tilt` nach vorn geneigt). */
export interface Look {
  sheet: SkinSheet;
  variant: SkinVariant;
  cape: HTMLImageElement | null;
  turn: number;
  tilt: number;
}

function required<T>(value: T | null, what: string): T {
  if (value == null) throw new Error(`WebGL: ${what} konnte nicht angelegt werden`);
  return value;
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = required(gl.createShader(type), "Shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`WebGL: ${gl.getShaderInfoLog(shader)}`);
  return shader;
}

/** Die Attribute liegen fest auf 0 (Ort), 1 (Normale) und 2 (Textur), in `drawMesh` gebunden. */
function link(gl: WebGLRenderingContext, vertex: string, fragment: string): Program {
  const handle = required(gl.createProgram(), "Programm");
  gl.attachShader(handle, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(handle, compile(gl, gl.FRAGMENT_SHADER, fragment));
  ["aPosition", "aNormal", "aUv"].forEach((name, slot) => gl.bindAttribLocation(handle, slot, name));
  gl.linkProgram(handle);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error(`WebGL: ${gl.getProgramInfoLog(handle)}`);
  return { handle, rotation: required(gl.getUniformLocation(handle, "uRotation"), "uRotation") };
}

function upload(gl: WebGLRenderingContext, data: Float32Array): Mesh {
  const buffer = required(gl.createBuffer(), "Puffer");
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return { buffer, vertices: data.length / VERTEX_FLOATS };
}

/** `null`, wo es kein WebGL gibt: dann bleibt die Vorschau leer. */
function createGpu(): Gpu | null {
  const gl = document.createElement("canvas").getContext("webgl", { antialias: true, powerPreference: "low-power" });
  if (!gl) return null;
  gl.enableVertexAttribArray(0);
  gl.enableVertexAttribArray(1);
  gl.enableVertexAttribArray(2);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.clearColor(0, 0, 0, 0);
  return {
    gl,
    figure: link(gl, VERTEX, FIGURE_FRAGMENT),
    meshes: new Map(),
    textures: new Map(),
  };
}

/** Der geteilte Zeichner; nach einem Verlust des Kontexts (Treiber, Energiesparen) wird er neu angelegt. */
let shared: Gpu | null | undefined;

function currentGpu(): Gpu | null {
  if (shared === undefined || (shared && shared.gl.isContextLost())) shared = createGpu();
  return shared;
}

function meshOf({ gl, meshes }: Gpu, key: string, build: () => Float32Array): Mesh {
  const known = meshes.get(key);
  if (known) return known;
  const mesh = upload(gl, build());
  meshes.set(key, mesh);
  return mesh;
}

function textureOf({ gl, textures }: Gpu, source: TexImageSource): WebGLTexture {
  const known = textures.get(source);
  if (known) {
    textures.delete(source);
    textures.set(source, known);
    return known;
  }
  const texture = required(gl.createTexture(), "Textur");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // Scharfe Texturpixel; ohne Mipmaps und mit Rand-Klemmung, weil Skins keine Zweierpotenz-Maße haben müssen.
  for (const filter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, filter, gl.NEAREST);
  for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, wrap, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  textures.set(source, texture);
  if (textures.size > MAX_TEXTURES) {
    const [oldest, stale] = textures.entries().next().value!;
    gl.deleteTexture(stale);
    textures.delete(oldest);
  }
  return texture;
}

/** Drehung um die Hochachse (`turn`), dann Neigung nach vorn (`tilt`), spaltenweise für WebGL. */
function rotation(turn: number, tilt: number): Float32Array {
  const [sy, cy, sp, cp] = [turn, tilt].flatMap((deg) => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)]);
  return new Float32Array([cy, -sp * sy, -cp * sy, 0, cp, -sp, sy, sp * cy, cp * cy]);
}

function drawMesh(gl: WebGLRenderingContext, mesh: Mesh) {
  const stride = VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 6 * Float32Array.BYTES_PER_ELEMENT);
  gl.drawArrays(gl.TRIANGLES, 0, mesh.vertices);
}

function drawTextured(gpu: Gpu, mesh: Mesh, source: TexImageSource) {
  gpu.gl.bindTexture(gpu.gl.TEXTURE_2D, textureOf(gpu, source));
  drawMesh(gpu.gl, mesh);
}

function drawScene(gpu: Gpu, { sheet, variant, cape, turn, tilt }: Look) {
  const { gl, figure } = gpu;
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(figure.handle);
  gl.uniformMatrix3fv(figure.rotation, false, rotation(turn, tilt));
  drawTextured(gpu, meshOf(gpu, `skin:${variant}:${sheet.rows}`, () => skinMesh(variant, sheet.rows)), sheet.texture);
  if (!cape) return;
  const { rows } = textureScale(cape);
  drawTextured(gpu, meshOf(gpu, `cape:${rows}`, () => capeMesh(rows)), cape);
}

/** Die Zeichenfläche wächst mit der größten Vorschau; gezeichnet wird in ihre untere linke Ecke. */
function fitCanvas({ gl }: Gpu, width: number, height: number) {
  const { canvas } = gl;
  if (canvas.width < width) canvas.width = width;
  if (canvas.height < height) canvas.height = height;
  gl.viewport(0, 0, width, height);
}

/**
 * Zeichnet die Figur in die Fläche von `target` (`FRAME` mal Auflösung). Ohne WebGL bleibt die Fläche unverändert.
 */
export function drawFigure(target: CanvasRenderingContext2D, look: Look) {
  const gpu = currentGpu();
  if (!gpu) return;
  const { width, height } = target.canvas;
  fitCanvas(gpu, width, height);
  drawScene(gpu, look);
  target.clearRect(0, 0, width, height);
  // WebGL zählt von unten: die Figur liegt in den untersten `height` Zeilen.
  target.drawImage(gpu.gl.canvas, 0, gpu.gl.canvas.height - height, width, height, 0, 0, width, height);
}
