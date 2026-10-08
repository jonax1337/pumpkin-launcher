import { useState } from "react";
import { NameDialog } from "@/components/NameDialog";
import type { ModProfilesApi } from "@/hooks/useModProfiles";
import { useI18n } from "@/i18n";
import { MAX_PROFILE_NAME_LENGTH, profileNamed } from "@/lib/modProfiles";
import type { Instance, ModProfile } from "@/lib/types";
import { ConfirmDialog } from "@/ui";

/** Welcher Dialog der Profile offen ist. */
export type ProfileDialogTarget = { type: "save" } | { type: "rename"; profile: ModProfile } | { type: "delete"; profile: ModProfile };

interface DialogProps {
  profiles: ModProfilesApi;
  onClose: () => void;
}

/** Dialoge der Profile: Speichern (mit Rückfrage vor dem Überschreiben), Umbenennen und Löschen. */
export function ProfileDialog({ target, instance, profiles, onClose }: DialogProps & { target: ProfileDialogTarget; instance: Instance }) {
  switch (target.type) {
    case "save":
      return <SaveDialog instance={instance} profiles={profiles} onClose={onClose} />;
    case "rename":
      return <RenameDialog key={target.profile.id} profile={target.profile} profiles={profiles} onClose={onClose} />;
    case "delete":
      return <DeleteDialog profile={target.profile} profiles={profiles} onClose={onClose} />;
  }
}

function SaveDialog({ instance, profiles, onClose }: DialogProps & { instance: Instance }) {
  const { t } = useI18n();
  const [overwriting, setOverwriting] = useState<string | null>(null);
  const save = (name: string) => profiles.save.mutate(name, { onSuccess: onClose });
  const submit = (name: string) => (profileNamed(instance.modProfiles, name) ? setOverwriting(name) : save(name));
  return (
    <>
      <NameDialog
        title={t("modProfiles.saveTitle")}
        label={t("modProfiles.nameLabel")}
        help={t("modProfiles.saveHelp")}
        initial=""
        maxLength={MAX_PROFILE_NAME_LENGTH}
        pending={profiles.save.isPending}
        onSubmit={submit}
        onClose={onClose}
      />
      <ConfirmDialog
        open={overwriting !== null}
        onOpenChange={(open) => !open && setOverwriting(null)}
        danger={false}
        title={t("modProfiles.overwriteTitle")}
        text={t("modProfiles.overwriteText", { name: overwriting ?? "" })}
        confirmLabel={t("modProfiles.overwrite")}
        pending={profiles.save.isPending}
        onConfirm={() => overwriting !== null && save(overwriting)}
      />
    </>
  );
}

function RenameDialog({ profile, profiles, onClose }: DialogProps & { profile: ModProfile }) {
  const { t } = useI18n();
  const submit = (name: string) => (name === profile.name ? onClose() : profiles.rename.mutate({ profile, name }, { onSuccess: onClose }));
  return (
    <NameDialog
      title={t("modProfiles.renameTitle")}
      label={t("modProfiles.nameLabel")}
      initial={profile.name}
      maxLength={MAX_PROFILE_NAME_LENGTH}
      pending={profiles.rename.isPending}
      onSubmit={submit}
      onClose={onClose}
    />
  );
}

function DeleteDialog({ profile, profiles, onClose }: DialogProps & { profile: ModProfile }) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("modProfiles.deleteTitle", { name: profile.name })}
      text={t("modProfiles.deleteText")}
      pending={profiles.remove.isPending}
      onConfirm={() => profiles.remove.mutate(profile, { onSuccess: onClose })}
    />
  );
}
