import type { Mod, ModKind } from "@/lib/types";

export type KindFilter = "all" | ModKind;

/** Hinweis zu einem Inhalt mit dem Weg, ihn zu beheben. `detail` erklärt mehr, als in den Chip passt (Tooltip, Vorleser). */
export type Warn = { text: string; detail?: string; actionLabel: string; fix: () => void };

export type Row = { type: "row"; mod: Mod; owners: string[] };

/**
 * Platzhalter für entfernte Inhalte; `at` ist die Stelle in der Liste, `main` ob der Inhalt selbst gewählt war
 * (statt nur Abhängigkeit), `by` wessen Abhängigkeit er war.
 */
export type Ghost = { type: "ghost"; mod: Mod; title: string; at: number; group: string; main: boolean; by?: string };

export type Entry = Row | Ghost;

/** Was ein Update oder Versionswechsel an der Inhaltsliste geändert hat; `text` sagt es dem Nutzer („3 Inhalte aktualisiert“). */
export type AppliedChange = { before: Mod[]; after: Mod[]; text: string };
