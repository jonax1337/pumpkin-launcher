import type { Mod, ModKind } from "@/lib/types";

export type KindFilter = "all" | ModKind;

/** Hinweis zu einem Inhalt mit dem Weg, ihn zu beheben. */
export type Warn = { text: string; actionLabel: string; fix: () => void };

export type Row = { type: "row"; mod: Mod; owners: string[] };

/**
 * Platzhalter für entfernte Inhalte; `at` ist die Stelle in der Liste, `main` ob der Inhalt selbst gewählt war
 * (statt nur Abhängigkeit), `by` wessen Abhängigkeit er war.
 */
export type Ghost = { type: "ghost"; mod: Mod; title: string; at: number; group: string; main: boolean; by?: string };

export type Entry = Row | Ghost;
