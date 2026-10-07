import type { ComponentProps } from "react";
import { JobProgress } from "@/ui";
import { progressShare, progressShortLabel } from "@/lib/progress";
import { useContentState } from "@/store/contentState";

type JobWidth = ComponentProps<typeof JobProgress>["width"];

/** Breite des laufenden Vorgangs im Projektkopf, in einer Katalogzeile und im Seitenpanel. */
export const HEAD_JOB_WIDTH = 230;
export const ROW_JOB_WIDTH = 120;
export const SIDE_JOB_WIDTH = 112;

/** Die Breite für Menüs und Aktionen, die als Kopf (`large`) oder als Zeile stehen. */
export const jobWidthOf = (large?: boolean) => (large ? HEAD_JOB_WIDTH : ROW_JOB_WIDTH);

/** Fortschritt des laufenden Vorgangs, wenn er `targetId` betrifft; sonst `null`. */
export function useJobProgressFor(targetId: string, width: JobWidth) {
  const { active, target, progress } = useContentState();
  return active && target === targetId ? <JobProgress label={progressShortLabel(progress)} p={progressShare(progress)} width={width} /> : null;
}
