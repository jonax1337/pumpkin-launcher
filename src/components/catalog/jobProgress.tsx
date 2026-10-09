import type { ComponentProps } from "react";
import { JobProgress } from "@/ui";
import { progressShare, progressShortLabel } from "@/lib/progress";
import { useContentState } from "@/store/contentState";

/** Breite (und Balkenstärke) des laufenden Vorgangs im Projektkopf, in einer Katalogzeile und im Seitenpanel. */
export const JOB = {
  head: { className: "w-[230px]", full: true },
  row: { className: "w-[120px]" },
  side: { className: "w-[112px]" },
} satisfies Record<string, Pick<ComponentProps<typeof JobProgress>, "className" | "full">>;

export type JobSize = keyof typeof JOB;

/** Die Größe für Menüs und Aktionen, die als Kopf (`large`) oder als Zeile stehen. */
export const jobSizeOf = (large?: boolean): JobSize => (large ? "head" : "row");

/** Fortschritt des laufenden Vorgangs, wenn er `targetId` betrifft; sonst `null`. */
export function useJobProgressFor(targetId: string, size: JobSize) {
  const { active, target, progress } = useContentState();
  return active && target === targetId ? <JobProgress label={progressShortLabel(progress)} p={progressShare(progress)} {...JOB[size]} /> : null;
}
