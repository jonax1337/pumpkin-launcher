export type SeasonId = 'standard' | 'spring' | 'summer' | 'halloween' | 'winter';
export interface Season {
  id: SeasonId;
  name: string;
  label: string;
  start: string | null;
  end: string | null;
  period: string;
  note: string;
  accent: string;
}
export const SEASONS: Season[];
export function seasonForDate(isoDate: string): SeasonId;
