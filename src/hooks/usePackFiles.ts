import { useEffect, useEffectEvent } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { isMrpack } from "@/lib/mods";
import { newInstanceUrl } from "@/lib/routes";
import { toastError } from "@/lib/toast";
import { useFileDrop } from "./useFileDrop";

/**
 * Zeigt den Import-Dialog der Bibliothek für eine `.mrpack`-Datei, mit der der Launcher geöffnet wurde
 * (Doppelklick, „Öffnen mit“, zweiter Start): einmal beim Start und bei jeder weiteren Datei.
 */
export function useOpenedPack() {
  const navigate = useNavigate();
  const showWaitingPack = useEffectEvent(() => {
    api.takeOpenedPack().then((path) => path && navigate(newInstanceUrl({ type: "file", path }))).catch(toastError);
  });
  useEffect(() => {
    showWaitingPack();
    const unlisten = api.onPackOpened(showWaitingPack);
    return () => void unlisten.then((stop) => stop());
  }, []);
}

/** Eine aufs Fenster gezogene `.mrpack`-Datei führt zum Import-Dialog der Bibliothek (dort selbst nimmt ihn der Dialog an). */
export function useDropPackToImport() {
  const navigate = useNavigate();
  useFileDrop(true, (paths) => {
    const path = paths.find(isMrpack);
    if (path) navigate(newInstanceUrl({ type: "file", path }));
  });
}
