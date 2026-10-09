import { useState } from "react";
import { useModProfiles } from "@/hooks/useModProfiles";
import { useI18n } from "@/i18n";
import { activeProfileOf, isModified } from "@/lib/modProfiles";
import type { Instance } from "@/lib/types";
import { Chip, IconButton, Menu, Select, type MenuEntry } from "@/ui";
import { ProfileDialog, type ProfileDialogTarget } from "./ProfileDialog";

/**
 * Profile der Inhalte in der Werkzeugleiste: ein Profil wählen schaltet die Inhalte darauf, das Menü speichert den
 * jetzigen Stand, setzt auf das aktive Profil zurück und benennt Profile um oder löscht sie. `busy` ist der Sperrgrund
 * aus `useInstanceBusyReason`.
 */
export function ProfileBar({ instance, busy }: { instance: Instance; busy: string | null }) {
  const { t } = useI18n();
  const profiles = useModProfiles(instance);
  const [dialog, setDialog] = useState<ProfileDialogTarget | null>(null);
  const locked = !!busy || profiles.pending;
  const active = activeProfileOf(instance);
  const modified = isModified(instance);

  const choose = (profileId: string) => {
    const profile = instance.modProfiles.find((p) => p.id === profileId);
    if (profile) profiles.apply(profile);
  };
  const perProfile = (type: "rename" | "delete"): MenuEntry[] =>
    instance.modProfiles.map((profile) => ({ id: profile.id, text: profile.name, onSelect: () => setDialog({ type, profile }) }));

  const reset: MenuEntry[] = active && modified
    ? [{ id: "reset", text: t("modProfiles.reset", { name: active.name }), icon: "undo", onSelect: () => profiles.apply(active) }]
    : [];
  const manage: MenuEntry[] = instance.modProfiles.length
    ? [
        "-",
        { id: "rename", text: t("common.rename"), icon: "edit", items: perProfile("rename") },
        { id: "delete", text: t("common.delete"), icon: "trash", items: perProfile("delete") },
      ]
    : [];
  const entries: MenuEntry[] = [...reset, { id: "save", text: t("modProfiles.saveAs"), icon: "save", onSelect: () => setDialog({ type: "save" }) }, ...manage];

  return (
    <>
      <Select
        size="s"
        labelClassName="le-1280:hidden"
        label={t("modProfiles.label")}
        placeholder={t("modProfiles.none")}
        value={active?.id ?? ""}
        disabled={locked}
        onChange={choose}
        options={instance.modProfiles.map((profile) => ({ value: profile.id, label: profile.name }))}
      />
      {modified && <Chip size="s" tone="warn">{t("modProfiles.modified")}</Chip>}
      <Menu items={entries} trigger={<IconButton icon="more" size="s" label={t("modProfiles.menuLabel")} disabled={locked} />} />
      {dialog && <ProfileDialog target={dialog} instance={instance} profiles={profiles} onClose={() => setDialog(null)} />}
    </>
  );
}
