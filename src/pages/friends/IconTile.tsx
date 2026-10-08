import { Icon, type IconName } from "@/ui";

/** Kleine Kachel (Slot 32) mit Symbol statt Kopf: Codes, Aktivität im Spiel. */
export function IconTile({ icon }: { icon: IconName }) {
  return (
    <span className="vx-av vx-slot" data-box="32">
      <Icon name={icon} size="m" tone="neutral" />
    </span>
  );
}
