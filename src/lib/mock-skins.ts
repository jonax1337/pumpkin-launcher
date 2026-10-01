// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { t } from "@/i18n";
import type { Cape, LibrarySkin, SkinProfile, SkinVariant } from "./types";

const DAY = 86_400_000;
const wait = (ms = 160) => new Promise((r) => setTimeout(r, ms));

type Look = { skin: string; hair: string; eyes: string; shirt: string; pants: string };

/** Einfache Skin-Textur (64×64): Gliedmaßen einfarbig, dazu Haare, Augen und Hände. */
function paintSkin(look: Look): string {
  const [ctx, canvas] = canvas2d(64, 64);
  const fill = (color: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  fill(look.skin, 0, 0, 32, 16);
  fill(look.hair, 8, 0, 16, 8);
  fill(look.hair, 0, 8, 32, 2);
  fill(look.eyes, 9, 12, 2, 1);
  fill(look.eyes, 13, 12, 2, 1);
  fill(look.shirt, 16, 16, 24, 16);
  fill(look.shirt, 40, 16, 16, 16);
  fill(look.shirt, 32, 48, 16, 16);
  fill(look.skin, 40, 28, 16, 4);
  fill(look.skin, 32, 60, 16, 4);
  fill(look.pants, 0, 16, 16, 16);
  fill(look.pants, 16, 48, 16, 16);
  return canvas.toDataURL();
}

/** Umhang (64×32) in einer Farbe mit Zeichen in der Mitte der Außenseite. */
function paintCape(color: string, sign: string): string {
  const [ctx, canvas] = canvas2d(64, 32);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 22, 17);
  ctx.fillStyle = sign;
  ctx.fillRect(4, 6, 4, 4);
  return canvas.toDataURL();
}

function canvas2d(w: number, h: number): [CanvasRenderingContext2D, HTMLCanvasElement] {
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  return [canvas.getContext("2d")!, canvas];
}

const LOOKS: [name: string, variant: SkinVariant, look: Look, days: number][] = [
  ["Kürbisbauer", "classic", { skin: "#E0A882", hair: "#B8763A", eyes: "#2E6A7A", shirt: "#D98A54", pants: "#4F6382" }, 2],
  ["Nachtwache", "slim", { skin: "#C98E6A", hair: "#1E1A18", eyes: "#6A4A8A", shirt: "#376A7C", pants: "#1C2536" }, 9],
  ["Schneeläufer", "classic", { skin: "#F2C4A0", hair: "#D8C080", eyes: "#3E5A9A", shirt: "#CFE2F3", pants: "#587594" }, 30],
];

/** Gleiche Formen wie die Skin-Commands: ein Beispielprofil und eine Bibliothek, alles nur im Speicher. */
export function createSkinMock() {
  const textures = new Map<string, string>();
  const library: LibrarySkin[] = LOOKS.map(([name, variant, look, days], i) => {
    textures.set(`mock-skin-${i}`, paintSkin(look));
    return { id: `mock-skin-${i}`, name, variant, addedAt: Date.now() - days * DAY };
  });
  const defaultSkin = { url: paintSkin({ skin: "#E0A882", hair: "#3B2A1E", eyes: "#3E5A9A", shirt: "#5C9DB3", pants: "#5F5888" }), variant: "classic" as const };
  let skin: SkinProfile["skin"] = defaultSkin;
  const capes: Cape[] = [
    { id: "mock-cape-migrator", alias: "Migrator", url: paintCape("#7F96B8", "#E5B85F"), active: true },
    { id: "mock-cape-pan", alias: "Pan", url: paintCape("#9CCBDB", "#5C9DB3"), active: false },
  ];
  const find = (id: string) => {
    const found = library.find((s) => s.id === id);
    if (!found) throw new Error(t("mock.skin.notFound", { id }));
    return found;
  };

  return {
    async profile(): Promise<SkinProfile> {
      await wait(400);
      return structuredClone({ skin, capes });
    },
    async library() {
      await wait();
      return structuredClone(library);
    },
    async texture(id: string) {
      return textures.get(find(id).id)!;
    },
    async update(id: string, name: string, variant: SkinVariant) {
      await wait();
      return structuredClone(Object.assign(find(id), { name: name.trim(), variant }));
    },
    async remove(id: string) {
      await wait();
      library.splice(library.indexOf(find(id)), 1);
    },
    async saveActive(name: string) {
      await wait(500);
      if (!skin) throw new Error(t("mock.skin.noneOnAccount"));
      const existing = library.find((s) => textures.get(s.id) === skin!.url);
      if (existing) throw new Error(t("mock.skin.alreadyInLibrary", { name: existing.name }));
      const saved: LibrarySkin = { id: `mock-skin-${crypto.randomUUID()}`, name, variant: skin.variant, addedAt: Date.now() };
      textures.set(saved.id, skin.url);
      library.push(saved);
      return structuredClone(saved);
    },
    async upload(skinId: string) {
      await wait(800);
      const chosen = find(skinId);
      skin = { url: textures.get(chosen.id)!, variant: chosen.variant };
    },
    async reset() {
      await wait(500);
      skin = defaultSkin;
    },
    async cape(capeId: string | null) {
      await wait(500);
      for (const c of capes) c.active = c.id === capeId;
    },
  };
}
