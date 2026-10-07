import { usePersistedState } from "@/hooks/usePersistedState";
import type { Sort } from "./libraryModel";

const SORT_STORAGE_KEY = "vx-libsort";

const SORTS: readonly [Sort, ...Sort[]] = ["recent", "name", "created", "playtime"];

/** Die Sortierung der Bibliothek bleibt über den Neustart gewählt. */
export function useLibrarySort() {
  return usePersistedState(SORT_STORAGE_KEY, SORTS);
}

