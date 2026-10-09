import type { ReactNode } from "react";
import { useFriendSkin } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { Avatar, Tip, type AvatarBox } from "@/ui";
import { cn } from "@/lib/utils";

/** Name und Kopf eines Freundes sind selbst angegeben: der Tooltip sagt das, wo sie stehen. `className` platziert den Wirt in der Umgebung. */
export function SelfAsserted({ children, className }: { children: ReactNode; className?: string }) {
  const { t } = useI18n();
  return (
    <Tip label={t("friends.selfAsserted")}>
      <span className={cn("fr-self", className)}>{children}</span>
    </Tip>
  );
}

/**
 * Kopf eines Freundes: der Skin, den das Backend für ihn holt und zwischenspeichert (die Oberfläche fragt Mojang nie selbst);
 * solange er lädt oder es keinen gibt, das Pixelgesicht aus dem Namen. `box`: Kantenlänge; `className` platziert den Kopf in der Umgebung.
 */
export function FriendAvatar({ friendId, name, box, className }: { friendId: string; name: string; box?: AvatarBox; className?: string }) {
  const skin = useFriendSkin(friendId);
  return (
    <SelfAsserted className={className}>
      <Avatar name={name} skin={skin} box={box} />
    </SelfAsserted>
  );
}
