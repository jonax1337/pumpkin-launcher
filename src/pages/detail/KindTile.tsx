import { Icon, ProjectIcon, type IconName } from "@/ui";

/**
 * Bildkachel einer Zeile (Inhalt, Welt, Server): das Projektbild, sonst `icon` als Symbol in einer eingelassenen Kachel
 * (Slot wie im Inventar). `box` 40 oder 52 px, wie die Boxen von `ProjectIcon`.
 */
export function KindTile({ url, seed, icon, box = 40 }: { url?: string | null; seed: string; icon: IconName; box?: 40 | 52 }) {
  if (url) return <ProjectIcon url={url} seed={seed} box={box} />;
  return (
    <span className="kind-tile vx-slot" data-box={box} aria-hidden>
      <Icon name={icon} size={box === 52 ? "xl" : "l"} />
    </span>
  );
}
