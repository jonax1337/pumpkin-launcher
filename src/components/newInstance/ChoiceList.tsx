import type { ComponentProps } from "react";
import { SkelList } from "@/components/SkelList";
import { cn } from "@/lib/utils";

/** Höhe einer Auswahlzeile (`Choice`), damit Platzhalter und Zeilen gleich hoch sind. */
const CHOICE_ROW_HEIGHT = "h-14";

/** Untereinander stehende Auswahlzeilen. */
export function ChoiceList({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-u2", className)} {...props} />;
}

/** `n` Platzhalter für eine ladende Auswahlliste. */
export function ChoiceListSkeleton({ n }: { n: number }) {
  return (
    <ChoiceList>
      <SkelList n={n} className={CHOICE_ROW_HEIGHT} />
    </ChoiceList>
  );
}
