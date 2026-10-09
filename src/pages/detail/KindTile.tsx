import { cn } from "@/lib/utils";
import { Icon, ProjectIcon, Surface, type IconName } from "@/ui";

/**
 * Bildkachel einer Zeile (Inhalt, Welt, Server): das Projektbild, sonst `icon` als Symbol in einer eingelassenen Kachel
 * (Slot wie im Inventar). `box` 40 oder 52 px, wie die Boxen von `ProjectIcon`.
 */
export function KindTile({ url, seed, icon, box = 40, className }: { url?: string | null; seed: string; icon: IconName; box?: 40 | 52; className?: string }) {
  if (url) return <ProjectIcon url={url} seed={seed} box={box} className={className} />;
  return (
    <Surface
      kind="slot"
      as="span"
      className={cn("inline-grid flex-none place-items-center text-(--fg-2) group-hover/row:text-(color:--fg) group-focus-within/row:text-(color:--fg) group-data-[off]/row:opacity-45", box === 52 ? "size-[52px]" : "size-10", className)}
      aria-hidden
    >
      <Icon name={icon} size={box === 52 ? "xl" : "l"} />
    </Surface>
  );
}
