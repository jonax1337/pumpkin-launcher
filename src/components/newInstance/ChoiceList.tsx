import type { ComponentProps } from "react";
import { SkelList } from "@/components/SkelList";

/** Höhe einer Auswahlzeile (`Choice`), damit Platzhalter und Zeilen gleich hoch sind. */
const CHOICE_ROW_HEIGHT = 56;

/** Untereinander stehende Auswahlzeilen. */
export function ChoiceList(props: ComponentProps<"div">) {
  return <div className="ni-choices" {...props} />;
}

/** `n` Platzhalter für eine ladende Auswahlliste. */
export function ChoiceListSkeleton({ n }: { n: number }) {
  return (
    <ChoiceList>
      <SkelList n={n} h={CHOICE_ROW_HEIGHT} />
    </ChoiceList>
  );
}
