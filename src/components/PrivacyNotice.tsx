import { FormRow, FormSection, Hint } from "@/ui";
import { useFriendsState } from "@/hooks/useFriends";
import { useI18n, type TKey } from "@/i18n";
import { TRUSTED_IMAGE_HOSTS } from "@/lib/image-hosts";
import type { RelayInfo } from "@/lib/types";
import { REQUEST_TTL_DAYS } from "@/pages/friends/friendsModel";

interface Service {
  name: string;
  purpose: TKey;
  hosts: readonly string[];
}

/** Dienste, mit denen der Launcher spricht, samt Hosts und Zweck. */
const SERVICES: readonly Service[] = [
  { name: "Modrinth", purpose: "components.privacy.modrinth", hosts: ["api.modrinth.com", "cdn.modrinth.com"] },
  {
    name: "CurseForge",
    purpose: "components.privacy.curseforge",
    hosts: ["pumpkin-curseforge.jonas-laux.workers.dev", "edge.forgecdn.net", "mediafilez.forgecdn.net", "media.forgecdn.net"],
  },
  { name: "FTB", purpose: "components.privacy.ftb", hosts: ["api.feed-the-beast.com", "files.feed-the-beast.com", "cdn.feed-the-beast.com"] },
  { name: "Technic", purpose: "components.privacy.technic", hosts: ["api.technicpack.net", "www.technicpack.net", "cdn.technicpack.net"] },
  {
    name: "Mojang",
    purpose: "components.privacy.mojang",
    hosts: ["piston-meta.mojang.com", "piston-data.mojang.com", "launchermeta.mojang.com", "libraries.minecraft.net", "resources.download.minecraft.net", "textures.minecraft.net"],
  },
  {
    name: "Microsoft / Xbox",
    purpose: "components.privacy.microsoft",
    hosts: ["login.microsoftonline.com", "user.auth.xboxlive.com", "xsts.auth.xboxlive.com", "api.minecraftservices.com"],
  },
  {
    name: "Fabric, Quilt, Forge, NeoForge",
    purpose: "components.privacy.loaders",
    hosts: ["meta.fabricmc.net", "maven.fabricmc.net", "meta.quiltmc.org", "maven.quiltmc.org", "maven.minecraftforge.net", "files.minecraftforge.net", "maven.neoforged.net", "repo1.maven.org"],
  },
  { name: "GitHub", purpose: "components.privacy.github", hosts: ["github.com", "githubusercontent.com"] },
  { name: "mclo.gs", purpose: "components.privacy.mclogs", hosts: ["api.mclo.gs"] },
];

/** Hier fragt der Launcher (nicht die Oberfläche) die Skins der Freunde ab. */
const FRIEND_SKIN_HOST = "sessionserver.mojang.com";

/** Hier löst der Launcher einen Minecraft-Namen beim Senden einer Anfrage per Name in die UUID auf. */
const NAME_LOOKUP_HOST = "api.minecraftservices.com";
export const RELAY_OPERATOR_KEYS: Record<RelayInfo["operator"], TKey> = {
  pumpkin: "friendsSettings.operator.pumpkin",
  n0: "friendsSettings.operator.n0",
};

/** Hosts der Relay-Server je Betreiber, in der Reihenfolge der Liste. */
function hostsByOperator(relays: RelayInfo[]) {
  const groups = new Map<RelayInfo["operator"], string[]>();
  for (const { operator, host } of relays) groups.set(operator, [...(groups.get(operator) ?? []), host]);
  return [...groups];
}

function ServiceRow({ label, purpose, hosts }: { label: string; purpose: string; hosts: readonly string[] }) {
  return (
    <FormRow label={label}>
      <span>{purpose}</span>
      <span className="break-words font-mono text-[length:calc(13px*var(--tz))] text-fg-3">{hosts.join(", ")}</span>
    </FormRow>
  );
}

/** Die Dienste der Freunde: Relay-Server je Betreiber (aus dem Backend), der Sessionserver für Skins und Kontonachweis, bei einem Verzeichnis dieses und die Namenssuche. */
function FriendsServices() {
  const { t } = useI18n();
  const state = useFriendsState().data;
  const relays = state?.relays ?? [];
  const directoryHost = state?.directory.host;
  const sessionserverPurpose = t("friendsSettings.privacy.sessionserver") + (directoryHost ? ` ${t("friendsSettings.privacy.sessionserverProof")}` : "");
  return (
    <>
      {hostsByOperator(relays).map(([operator, hosts]) => (
        <ServiceRow
          key={operator}
          label={t("friendsSettings.privacy.relayName", { operator: t(RELAY_OPERATOR_KEYS[operator]) })}
          purpose={t("friendsSettings.privacy.relay")}
          hosts={hosts}
        />
      ))}
      {directoryHost && (
        <ServiceRow
          label={t("friendsSettings.privacy.directoryName")}
          purpose={t("friendsSettings.privacy.directory", { days: REQUEST_TTL_DAYS })}
          hosts={[directoryHost]}
        />
      )}
      <ServiceRow label={t("friendsSettings.privacy.sessionserverName")} purpose={sessionserverPurpose} hosts={[FRIEND_SKIN_HOST]} />
      {directoryHost && <ServiceRow label={t("friendsSettings.privacy.nameLookupName")} purpose={t("friendsSettings.privacy.nameLookup")} hosts={[NAME_LOOKUP_HOST]} />}
    </>
  );
}

/** Einstellungen › Über › Datenschutz: welche Hosts der Launcher kontaktiert und wofür. */
export function PrivacyNotice() {
  const { t } = useI18n();
  return (
    <FormSection title={t("components.privacy.title")} level={3}>
      <Hint icon="info">{t("components.privacy.intro")}</Hint>
      {SERVICES.map((service) => (
        <ServiceRow key={service.name} label={service.name} purpose={t(service.purpose)} hosts={service.hosts} />
      ))}
      <FriendsServices />
      <ServiceRow label="Discord" purpose={t("components.privacy.discord")} hosts={[t("components.privacy.discordWhere")]} />
      <ServiceRow label={t("components.privacy.imagesName")} purpose={t("components.privacy.images")} hosts={TRUSTED_IMAGE_HOSTS} />
      <Hint icon="info" className="mt-3.5">{t("components.security.noScan")}</Hint>
    </FormSection>
  );
}
