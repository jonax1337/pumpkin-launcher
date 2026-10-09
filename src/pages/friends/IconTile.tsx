import { Icon, Surface, type IconName } from "@/ui";

/** Kleine Kachel (Slot 32) mit Symbol statt Kopf: Codes, Aktivität im Spiel. */
export function IconTile({ icon }: { icon: IconName }) {
  return (
    <Surface kind="slot" as="span" className="inline-grid size-8 flex-none place-items-center">
      <Icon name={icon} size="m" tone="neutral" />
    </Surface>
  );
}
