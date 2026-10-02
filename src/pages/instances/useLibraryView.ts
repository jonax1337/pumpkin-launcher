import { usePersistedState } from "@/hooks/usePersistedState";
import type { LibraryMode } from "./InstanceView";
import type { Sort } from "./libraryModel";

/** Schlüssel der gemerkten Ansicht (Poster oder Liste) und Sortierung. */
const MODE_STORAGE_KEY = "vx-libmode";
const SORT_STORAGE_KEY = "vx-libsort";

const MODES: readonly [LibraryMode, ...LibraryMode[]] = ["poster", "list"];
const SORTS: readonly [Sort, ...Sort[]] = ["recent", "name", "created", "playtime"];

/** Wie die Bibliothek ihre Instanzen zeigt: Ansicht und Sortierung, beide bleiben über den Neustart gewählt. */
export function useLibraryView() {
  const [mode, setMode] = usePersistedState(MODE_STORAGE_KEY, MODES);
  const [sort, setSort] = usePersistedState(SORT_STORAGE_KEY, SORTS);
  return { mode, setMode, sort, setSort };
}

export type LibraryView = ReturnType<typeof useLibraryView>;
