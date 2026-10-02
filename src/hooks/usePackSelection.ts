import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PackSelection } from "@/lib/types";
import { contentKeys } from "./queryKeys";

/**
 * Gewählte Ressourcenpakete und Shader der Instanz (`options.txt`, Iris). Das Spiel schreibt die Dateien beim Beenden
 * selbst: nach einem Spiel (`busy` wird leer) liest die Liste neu. Änderungen erscheinen sofort und laufen der Reihe
 * nach ins Backend; bei einem Fehler springt die Anzeige zurück.
 */
export function usePackSelection(instanceId: string, busy: string | null) {
  const qc = useQueryClient();
  const key = contentKeys.packs(instanceId);
  const writeKey = [...key, "write"];
  const query = useQuery({ queryKey: key, queryFn: () => api.packSelection(instanceId), staleTime: 0, retry: false });

  const wasBusy = useRef(busy !== null);
  const { refetch } = query;
  useEffect(() => {
    if (wasBusy.current && busy === null) void refetch();
    wasBusy.current = busy !== null;
  }, [busy, refetch]);

  /** Eine Änderung, die sofort erscheint, der Reihe nach gespeichert wird und bei Fehler zurückspringt. */
  const useChange = <V>(write: (value: V) => Promise<PackSelection>, preview: (selection: PackSelection, value: V) => PackSelection) =>
    useMutation({
      mutationKey: writeKey,
      scope: { id: writeKey.join(":") },
      mutationFn: write,
      onMutate: (value: V) => {
        const previous = qc.getQueryData<PackSelection>(key);
        if (previous) qc.setQueryData(key, preview(previous, value));
        return { previous };
      },
      onError: (_, __, context) => context?.previous && qc.setQueryData(key, context.previous),
      onSuccess: (selection) => {
        if (qc.isMutating({ mutationKey: writeKey }) === 1) qc.setQueryData(key, selection);
      },
    });

  const resourcePacks = useChange((packs: string[]) => api.setResourcePacks(instanceId, packs), (selection, packs) => ({ ...selection, resourcePacks: packs }));
  const shaderPack = useChange((pack: string | null) => api.setShaderPack(instanceId, pack), (selection, pack) => ({ ...selection, shaderPack: pack }));

  return {
    /** `undefined`, solange sie noch nicht gelesen ist oder das Lesen scheiterte. */
    selection: query.data,
    failed: query.isError,
    setResourcePacks: resourcePacks.mutate,
    setShaderPack: shaderPack.mutate,
  };
}
