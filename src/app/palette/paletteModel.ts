import type { IconName } from "@/ui/types";

/** Gruppen in fester Reihenfolge: ein Eintrag wandert beim Tippen nie in eine andere Gruppe. */
export const GROUP_ORDER = ["instances", "navigation", "actions", "search"] as const;
export type PaletteGroup = (typeof GROUP_ORDER)[number];

export interface PaletteItem {
  /** Stabil über Starts hinweg, denn danach merkt sich die Palette die zuletzt ausgeführten Befehle. */
  id: string;
  group: PaletteGroup;
  title: string;
  subtitle?: string;
  icon: IconName;
  /** Tastenkürzel des Befehls in der Schreibweise von `aria-keyshortcuts` (siehe shortcuts.ts); die Palette zeigt es rechts an. */
  shortcut?: string;
  /** Suchbegriffe, die nicht im Titel stehen (Synonyme, Name der Seite). */
  keywords: string[];
  /** Warum der Eintrag gerade nichts tut; er bleibt sichtbar, aber gedimmt. */
  disabledReason?: string;
  run: () => void;
}

/** „recent“ ist kein Befehlstyp, sondern der Abschnitt der zuletzt ausgeführten Befehle bei leerem Suchfeld. */
export type PaletteSectionId = PaletteGroup | "recent";
export interface PaletteSection {
  id: PaletteSectionId;
  items: PaletteItem[];
}

export type ActiveMove = "down" | "up" | "home" | "end";

// Die Stufen liegen weiter auseinander als alle Zuschläge, deshalb bestimmt allein die Art des Treffers die Stufe.
const TIER_PREFIX = 3000;
const TIER_WORD_PREFIX = 2000;
const TIER_SUBSEQUENCE = 1000;
// Innerhalb einer Stufe: Titel vor Suchbegriff vor Untertitel.
const KEYWORD_PENALTY = 100;
const SUBTITLE_PENALTY = 200;
// Kürzere Felder zuerst (ein genauer Treffer vor einem langen Titel), gedeckelt unter dem Abstand der Stufen.
const MAX_LENGTH_PENALTY = 99;

interface SearchField {
  text: string;
  penalty: number;
}

/** Ohne Groß-/Kleinschreibung und Akzente („Über“ → „uber“, „Café“ → „cafe“, „Straße“ → „strasse“). */
export const normalizeText = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/ß/g, "ss");

const tokensOf = (query: string) => normalizeText(query).split(/\s+/).filter(Boolean);

function subsequenceEnd(token: string, text: string, start: number): number | null {
  let at = start;
  for (let i = 1; i < token.length; i++) {
    at = text.indexOf(token[i], at + 1);
    if (at === -1) return null;
  }
  return at;
}

/** Die kürzeste Spanne von `text`, in der `token` als Teilfolge vorkommt; null, wenn es nirgends vorkommt. */
function shortestSubsequenceSpan(token: string, text: string): number | null {
  let shortest: number | null = null;
  for (let start = text.indexOf(token[0]); start !== -1; start = text.indexOf(token[0], start + 1)) {
    const end = subsequenceEnd(token, text, start);
    // Reicht der Rest ab hier nicht, reicht er ab einem späteren Anfang erst recht nicht.
    if (end === null) break;
    shortest = Math.min(shortest ?? Infinity, end - start + 1);
  }
  return shortest;
}

/** Präfix vor Wortanfang vor Teilfolge; null, wenn der Begriff nicht vorkommt. */
function fieldScore(token: string, text: string): number | null {
  const lengthPenalty = Math.min(text.length, MAX_LENGTH_PENALTY);
  const startsWord = [...text.matchAll(/[\p{L}\p{N}]+/gu)].some((word) => text.startsWith(token, word.index));
  if (text.startsWith(token)) return TIER_PREFIX - lengthPenalty;
  if (startsWord) return TIER_WORD_PREFIX - lengthPenalty;
  const span = shortestSubsequenceSpan(token, text);
  return span === null ? null : TIER_SUBSEQUENCE - Math.min(span, MAX_LENGTH_PENALTY);
}

function searchFields({ title, keywords, subtitle }: PaletteItem): SearchField[] {
  return [
    { text: normalizeText(title), penalty: 0 },
    ...keywords.map((keyword) => ({ text: normalizeText(keyword), penalty: KEYWORD_PENALTY })),
    ...(subtitle ? [{ text: normalizeText(subtitle), penalty: SUBTITLE_PENALTY }] : []),
  ];
}

function bestScore(token: string, fields: SearchField[]): number | null {
  const scores = fields.flatMap(({ text, penalty }) => {
    const score = fieldScore(token, text);
    return score === null ? [] : [score - penalty];
  });
  return scores.length > 0 ? Math.max(...scores) : null;
}

/**
 * Wie gut `item` zur Eingabe passt (höher = besser); null, wenn es nicht passt. Jedes durch Leerzeichen getrennte Wort
 * muss irgendwo vorkommen, die Reihenfolge der Wörter spielt keine Rolle. Eine leere Eingabe passt zu allem.
 */
export function matchScore(query: string, item: PaletteItem): number | null {
  const fields = searchFields(item);
  let total = 0;
  for (const token of tokensOf(query)) {
    const score = bestScore(token, fields);
    if (score === null) return null;
    total += score;
  }
  return total;
}

const bySectionOrder = (items: PaletteItem[]): PaletteSection[] =>
  GROUP_ORDER.map((id) => ({ id, items: items.filter((item) => item.group === id) })).filter((section) => section.items.length > 0);

/** Leeres Suchfeld: zuerst die zuletzt ausgeführten Befehle (neueste zuerst), danach alles in Gruppen. */
function arrangeIdle(items: PaletteItem[], recentIds: readonly string[]): PaletteSection[] {
  const recent = recentIds.flatMap((id) => items.filter((item) => item.id === id));
  const rest = items.filter((item) => !recent.includes(item));
  return [...(recent.length > 0 ? [{ id: "recent" as const, items: recent }] : []), ...bySectionOrder(rest)];
}

/** Mit Eingabe: nur Treffer, je Gruppe nach Güte; bei gleicher Güte gewinnt der zuletzt benutzte, dann die Reihenfolge der Quelle. */
function arrangeSearch(items: PaletteItem[], query: string, recentIds: readonly string[]): PaletteSection[] {
  // Unbekannte Befehle hinter allen bekannten.
  const recency = (item: PaletteItem) => {
    const at = recentIds.indexOf(item.id);
    return at === -1 ? recentIds.length : at;
  };
  const hits = items.flatMap((item) => {
    const score = matchScore(query, item);
    return score === null ? [] : [{ item, score }];
  });
  hits.sort((a, b) => b.score - a.score || recency(a.item) - recency(b.item));
  return bySectionOrder(hits.map(({ item }) => item));
}

/** Die Abschnitte der Palette für die Eingabe; `recentIds` sind die zuletzt ausgeführten Befehle, neueste zuerst. */
export function arrangeItems(items: PaletteItem[], query: string, recentIds: readonly string[]): PaletteSection[] {
  return tokensOf(query).length === 0 ? arrangeIdle(items, recentIds) : arrangeSearch(items, query, recentIds);
}

export const flattenSections = (sections: PaletteSection[]): PaletteItem[] => sections.flatMap(({ items }) => items);

/** Der erste Eintrag, den Enter ausführen kann; ohne einen den ersten überhaupt (0 bei leerer Liste). */
export function firstRunnableIndex(items: PaletteItem[]): number {
  const runnable = items.findIndex((item) => !item.disabledReason);
  return Math.max(runnable, 0);
}

/** Pfeil- und Pos1/Ende-Tasten: Auf und Ab laufen im Kreis, Pos1 und Ende springen an die Enden. */
export function moveActive(index: number, count: number, move: ActiveMove): number {
  if (count === 0) return 0;
  switch (move) {
    case "down":
      return (index + 1) % count;
    case "up":
      return (index - 1 + count) % count;
    case "home":
      return 0;
    case "end":
      return count - 1;
  }
}
