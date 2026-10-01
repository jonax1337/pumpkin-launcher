// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { t } from "@/i18n";
import type { Backend } from "./backend";
import { canvas2d, clone, wait } from "./mock-util";
import { HOUR } from "./time";
import type { Screenshot } from "./types";

const BLOCK = 20;

/** Platzhalter im Format 16:9: Himmel, Sonne, Gelände in Blöcken. */
function paintShot(sky: string, ground: string, seed: number): string {
  const [ctx, canvas] = canvas2d(320, 180);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 320, 180);
  ctx.fillStyle = "#F6DA98";
  ctx.fillRect(240, 20, 2 * BLOCK, 2 * BLOCK);
  ctx.fillStyle = ground;
  for (let x = 0; x < 320; x += BLOCK) {
    const height = BLOCK * Math.round(3 + 1.5 * Math.sin((x / BLOCK + seed) / 2));
    ctx.fillRect(x, 180 - height, BLOCK, height);
  }
  return canvas.toDataURL();
}

/** Dateiname, wie Minecraft ihn vergibt: `2026-09-30_18.22.41.png`. */
function minecraftName(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.png`;
}

const SCENES: [sky: string, ground: string, hoursAgo: number][] = [
  ["#7FB3E0", "#5E8C3A", 1],
  ["#F0A868", "#8F7C56", 3],
  ["#1C2536", "#376A7C", 26],
  ["#9CCBDB", "#CFE2F3", 29],
  ["#7F96B8", "#4F6382", 24 * 6],
];

/** Gleiche Formen wie die Screenshot-Commands; im Mock ist `path` die Bilddaten-URL selbst. */
export function createScreenshotMock() {
  const byInstance = new Map<string, Screenshot[]>();
  const shotsOf = (instanceId: string) => {
    if (!byInstance.has(instanceId)) {
      const now = Date.now();
      byInstance.set(instanceId, SCENES.map(([sky, ground, hoursAgo], i) => {
        const takenAt = now - hoursAgo * HOUR;
        return { fileName: minecraftName(takenAt), path: paintShot(sky, ground, i * 3), takenAt, size: 2_400_000 + i * 310_000 };
      }));
    }
    return byInstance.get(instanceId)!;
  };

  return {
    async screenshots(instanceId: string) {
      await wait();
      return clone(shotsOf(instanceId));
    },
    async screenshotDelete(instanceId: string, fileName: string) {
      await wait();
      const shots = shotsOf(instanceId);
      const index = shots.findIndex((s) => s.fileName === fileName);
      if (index < 0) throw new Error(t("mock.screenshot.notFound", { datei: fileName }));
      shots.splice(index, 1);
    },
  } satisfies Partial<Backend>;
}
