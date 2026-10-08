// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { t } from "@/i18n";
import type { Backend } from "./backend";
import { pickedName, readPicked } from "./mock-files";
import { canvas2d, clone, wait } from "./mock-util";
import { DAY } from "./time";
import type { Cape, LibrarySkin, SkinProfile, SkinVariant } from "./types";

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

/** Umhang (64×32): Grundfarbe über Außen- und Innenseite, dazu ein Zeichen in der Mitte der Außenseite (Pixel 1,1 bis 11,17). */
function paintCape(color: string, marks: [color: string, x: number, y: number, w: number, h: number][]): string {
  const [ctx, canvas] = canvas2d(64, 32);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 22, 17);
  for (const [fill, x, y, w, h] of marks) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  return canvas.toDataURL();
}

const LOOKS: [name: string, variant: SkinVariant, look: Look, days: number][] = [
  ["Kürbisbauer", "classic", { skin: "#E0A882", hair: "#B8763A", eyes: "#2E6A7A", shirt: "#D98A54", pants: "#4F6382" }, 2],
  ["Nachtwache", "slim", { skin: "#C98E6A", hair: "#1E1A18", eyes: "#6A4A8A", shirt: "#376A7C", pants: "#1C2536" }, 9],
  ["Schneeläufer", "classic", { skin: "#F2C4A0", hair: "#D8C080", eyes: "#3E5A9A", shirt: "#CFE2F3", pants: "#587594" }, 30],
];

/** Aus einem Spielernamen eine Farbgebung ableiten: derselbe Name malt immer denselben Skin. */
function lookOf(name: string): Look {
  const seed = [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const color = (shift: number, lightness: number) => `hsl(${(seed + shift) % 360} 45% ${lightness}%)`;
  return { skin: "#E0A882", hair: color(0, 25), eyes: color(120, 45), shirt: color(200, 45), pants: color(40, 35) };
}

/** Gleiche Formen wie die Skin-Commands: ein Beispielprofil und eine Bibliothek, alles nur im Speicher. */
export function createSkinMock() {
  const textures = new Map<string, string>();
  const library: LibrarySkin[] = LOOKS.map(([name, variant, look, days], i) => {
    textures.set(`mock-skin-${i}`, paintSkin(look));
    return { id: `mock-skin-${i}`, name, variant, addedAt: Date.now() - days * DAY };
  });
  const defaultLook: Look = { skin: "#E0A882", hair: "#3B2A1E", eyes: "#3E5A9A", shirt: "#5C9DB3", pants: "#5F5888" };
  const defaultSkin = { url: paintSkin(defaultLook), variant: "classic" as const };
  let skin: SkinProfile["skin"] = defaultSkin;
  const capes: Cape[] = [
    {
      id: "mock-cape-pumpkin", alias: "Pumpkin-Umhang", active: true,
      url: paintCape("#E5702A", [["#CF5E20", 1, 1, 5, 16], ["#F2B34A", 3, 8, 6, 3], ["#1C2410", 4, 6, 1, 2], ["#1C1208", 7, 6, 1, 2]]),
    },
    {
      id: "mock-cape-mojang", alias: "Mojang", active: false,
      url: paintCape("#B7242C", [["#9E1D25", 1, 1, 10, 8], ["#E8E8E8", 3, 5, 6, 2], ["#E8E8E8", 4, 9, 4, 2]]),
    },
  ];
  const find = (id: string) => {
    const found = library.find((s) => s.id === id);
    if (!found) throw new Error(t("mock.skin.notFound", { id }));
    return found;
  };

  /** Wie `skins::add`: nur PNGs mit 64×64 oder 64×32 Pixeln, und jede Textur nur einmal. */
  async function readSkinFile(path: string) {
    const blob = await readPicked(path);
    if (blob.type !== "image/png") throw new Error(t("mock.skin.notAPng"));
    const url = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
    const image = await createImageBitmap(blob);
    const { width, height } = image;
    image.close();
    if (width !== 64 || ![32, 64].includes(height)) throw new Error(t("mock.skin.wrongSize", { width, height }));
    return url;
  }

  /** Nimmt eine Textur in die Bibliothek auf, jede nur einmal wie `skins::add`. */
  function remember(name: string, variant: SkinVariant, url: string) {
    const existing = library.find((s) => textures.get(s.id) === url);
    if (existing) throw new Error(t("mock.skin.alreadyInLibrary", { name: existing.name }));
    const added: LibrarySkin = { id: `mock-skin-${crypto.randomUUID()}`, name, variant, addedAt: Date.now() };
    textures.set(added.id, url);
    library.push(added);
    return clone(added);
  }

  return {
    async skinAdd(path: string) {
      await wait();
      return remember(pickedName(path).slice(0, 64) || "Skin", "classic", await readSkinFile(path));
    },
    /** Jeder gültige Name hat einen Skin: im Browser gibt es kein Mojang, also malt der Mock ihn aus dem Namen. */
    async skinAddPlayer(name: string) {
      await wait(500);
      const player = name.trim();
      if (!/^\w{1,16}$/.test(player)) throw new Error(t("errors.app.skin.invalidPlayerName"));
      return remember(player, "classic", paintSkin(lookOf(player)));
    },
    async skinProfile(): Promise<SkinProfile> {
      await wait(400);
      return clone({ skin, capes });
    },
    async skinLibrary() {
      await wait();
      return clone(library);
    },
    async skinTexture(id: string) {
      return textures.get(find(id).id)!;
    },
    async skinUpdate(id: string, name: string, variant: SkinVariant) {
      await wait();
      return clone(Object.assign(find(id), { name: name.trim(), variant }));
    },
    async skinDelete(id: string) {
      await wait();
      library.splice(library.indexOf(find(id)), 1);
    },
    async skinSaveActive(_accountId: string, name: string) {
      await wait(500);
      if (!skin) throw new Error(t("mock.skin.noneOnAccount"));
      return remember(name, skin.variant, skin.url);
    },
    async skinUpload(_accountId: string, skinId: string) {
      await wait(800);
      const chosen = find(skinId);
      skin = { url: textures.get(chosen.id)!, variant: chosen.variant };
    },
    async skinReset() {
      await wait(500);
      skin = defaultSkin;
    },
    async skinCape(_accountId: string, capeId: string | null) {
      await wait(500);
      for (const c of capes) c.active = c.id === capeId;
    },
  } satisfies Partial<Backend>;
}
