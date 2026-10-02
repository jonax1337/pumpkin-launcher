import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { pixelSignature } from "@/lib/pixelSignature";
import type { Cape, LibrarySkin, SkinVariant } from "@/lib/types";
import { skinKeys } from "./queryKeys";
import { SKIN_PROFILE_STALE_MS } from "./staleTimes";

export function useSkinLibrary() {
  return useQuery({ queryKey: skinKeys.library, queryFn: api.skinLibrary });
}

/** Textur eines Bibliotheks-Skins; die ID ist ihr SHA-1, die Datei ändert sich also nie. */
export function useSkinTexture(id: string) {
  return useQuery({ queryKey: skinKeys.texture(id), queryFn: () => api.skinTexture(id), staleTime: Infinity }).data;
}

/**
 * Pixel-Fingerabdruck einer Textur: so erkennt die Seite, welcher Skin der Bibliothek gerade getragen wird, obwohl
 * Minecraft die Datei neu packt. `key` benennt die Textur (ändert sich nie), `src` ist ihre Adresse.
 */
export function useSkinSignature(key: string | undefined, src: string | undefined) {
  return useQuery({
    queryKey: skinKeys.signature(key ?? ""),
    queryFn: () => pixelSignature(src!),
    enabled: key != null && src != null,
    staleTime: Infinity,
    retry: false,
  }).data;
}

/** Aktueller Skin und Umhänge eines Microsoft-Kontos; ohne Konto keine Anfrage. */
export function useSkinProfile(accountId: string | null) {
  return useQuery({
    queryKey: skinKeys.profile(accountId ?? ""),
    queryFn: () => api.skinProfile(accountId!),
    enabled: accountId != null,
    staleTime: SKIN_PROFILE_STALE_MS,
    retry: false,
  });
}

function useLibraryChange<V, R>(change: (v: V) => Promise<R>, done?: (result: R) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: (result) => {
      if (done) toast.success(done(result));
      return qc.invalidateQueries({ queryKey: skinKeys.library, exact: true });
    },
  });
}

const inLibrary = (skin: LibrarySkin) => t("hooks.skin.inLibrary", { name: skin.name });

export const useAddSkin = () => useLibraryChange(api.skinAdd, inLibrary);

export const useAddPlayerSkin = () => useLibraryChange(api.skinAddPlayer, inLibrary);

export const useUpdateSkin = () =>
  useLibraryChange(({ id, name, variant }: { id: string; name: string; variant: SkinVariant }) => api.skinUpdate(id, name, variant));

export const useDeleteSkin = () => useLibraryChange(api.skinDelete);

export const useSaveActiveSkin = () =>
  useLibraryChange(({ accountId, name }: { accountId: string; name: string }) => api.skinSaveActive(accountId, name), inLibrary);

/** Änderung am Profil bei Minecraft; danach zeigt die Seite den neuen Stand des Kontos. */
function useProfileChange<V extends { accountId: string }>(change: (v: V) => Promise<void>, done: (v: V) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: (_, v) => {
      toast.success(done(v));
      return qc.invalidateQueries({ queryKey: skinKeys.profile(v.accountId) });
    },
  });
}

export const useUploadSkin = () =>
  useProfileChange(
    ({ accountId, skin }: { accountId: string; skin: LibrarySkin }) => api.skinUpload(accountId, skin.id),
    ({ skin }) => t("hooks.skin.nowWearing", { name: skin.name }),
  );

export const useResetSkin = () =>
  useProfileChange(({ accountId }: { accountId: string }) => api.skinReset(accountId), () => t("hooks.skin.wearingDefault"));

export const useSetCape = () =>
  useProfileChange(
    ({ accountId, cape }: { accountId: string; cape: Cape | null }) => api.skinCape(accountId, cape?.id ?? null),
    ({ cape }) => (cape ? t("hooks.skin.nowWearingCape", { name: cape.alias }) : t("hooks.skin.capeRemoved")),
  );
