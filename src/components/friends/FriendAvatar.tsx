import type { ReactNode } from "react";
import { useFriendSkin } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { Avatar, Tip } from "@/ui";

/** Name und Kopf eines Freundes sind selbst angegeben: der Tooltip sagt das, wo sie stehen. */
export function SelfAsserted({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Tip label={t("friends.selfAsserted")}>
      <span className="fr-self">{children}</span>
    </Tip>
  );
}

/**
 * Kopf eines Freundes: der Skin, den das Backend für ihn holt und zwischenspeichert (die Oberfläche fragt Mojang nie selbst);
 * solange er lädt oder es keinen gibt, das Pixelgesicht aus dem Namen.
 */
export function FriendAvatar({ friendId, name, box }: { friendId: string; name: string; box?: 28 | 32 }) {
  const skin = useFriendSkin(friendId);
  return (
    <SelfAsserted>
      <Avatar name={name} skin={skin} box={box} />
    </SelfAsserted>
  );
}
