import type { ComponentProps } from "react";
import { Skel } from "@/ui";

/** `n` gleiche Platzhalter für eine ladende Liste oder ein Raster; `skel` sind die Eigenschaften je Platzhalter. */
export function SkelList({ n, ...skel }: { n: number } & ComponentProps<typeof Skel>) {
  return <>{Array.from({ length: n }, (_, k) => <Skel key={k} {...skel} />)}</>;
}
