import { useSkinProfile } from "@/hooks/useSkins";
import { accountName, type ActiveAccount } from "@/store/settings";
import { Avatar } from "@/ui";

/**
 * Kopf eines Kontos: bei einem Microsoft-Konto der echte Skin, den Minecraft für es meldet; sonst, und solange er lädt
 * oder sich nicht holen lässt, das Pixelgesicht aus dem Namen. Offline-Namen haben keinen Skin.
 */
export function AccountAvatar({ account, box }: { account: ActiveAccount; box?: 28 | 32 }) {
  const profile = useSkinProfile(account.kind === "microsoft" ? account.id : null);
  return <Avatar name={accountName(account)} skin={profile.data?.skin?.url} box={box} />;
}
