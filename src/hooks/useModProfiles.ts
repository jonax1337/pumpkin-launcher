import { useIsMutating, useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { activeProfileOf, changeCount } from "@/lib/modProfiles";
import type { Instance, ModProfile } from "@/lib/types";
import { instanceKeys } from "./queryKeys";
import { instanceSaved } from "./useInstances";

/** Was die Oberfläche der Profile braucht; `save`, `rename` und `remove` sind die Mutationen, deren Zustand die Dialoge zeigen. */
export interface ModProfilesApi {
  save: UseMutationResult<Instance, Error, string>;
  rename: UseMutationResult<Instance, Error, { profile: ModProfile; name: string }>;
  remove: UseMutationResult<Instance, Error, ModProfile>;
  /** Schaltet die Inhalte auf den Stand des Profils; die Meldung nennt, wie viele es umschaltet. */
  apply: (profile: ModProfile) => void;
  /** Irgendeine Profiländerung oder ein Schalter der Inhaltsliste speichert noch. */
  pending: boolean;
}

/**
 * Profile der Inhalte einer Instanz: speichern, anwenden, umbenennen, löschen. Das Backend liefert jeweils die ganze
 * Instanz zurück. `pending` gilt auch, solange Schalter der Inhaltsliste noch speichern: das Backend lässt nur eine Änderung zu.
 */
export function useModProfiles(instance: Instance): ModProfilesApi {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toggling = useIsMutating({ mutationKey: instanceKeys.mods(instance.id) }) > 0;

  const save = useMutation({
    mutationFn: (name: string) => api.modProfileSave(instance.id, name),
    onSuccess: (next) => {
      toast.success(t("modProfiles.saved", { name: activeProfileOf(next)?.name ?? "" }));
      return instanceSaved(qc, next);
    },
  });

  const apply = useMutation({
    mutationFn: ({ profile }: { profile: ModProfile; switched: number }) => api.modProfileApply(instance.id, profile.id),
    onSuccess: (next, { profile, switched }) => {
      const text = switched
        ? t(switched === 1 ? "modProfiles.applied.one" : "modProfiles.applied.other", { name: profile.name, n: switched })
        : t("modProfiles.appliedNoChange", { name: profile.name });
      toast.success(text);
      return instanceSaved(qc, next);
    },
  });

  const rename = useMutation({
    mutationFn: ({ profile, name }: { profile: ModProfile; name: string }) => api.modProfileRename(instance.id, profile.id, name),
    onSuccess: (next, { name }) => {
      toast.success(t("modProfiles.renamed", { name }));
      return instanceSaved(qc, next);
    },
  });

  const remove = useMutation({
    mutationFn: (profile: ModProfile) => api.modProfileDelete(instance.id, profile.id),
    onSuccess: (next, profile) => {
      toast.success(t("modProfiles.deleted", { name: profile.name }));
      return instanceSaved(qc, next);
    },
  });

  return {
    save,
    rename,
    remove,
    apply: (profile: ModProfile) => apply.mutate({ profile, switched: changeCount(instance.mods, profile) }),
    pending: toggling || [save, apply, rename, remove].some((mutation) => mutation.isPending),
  };
}
