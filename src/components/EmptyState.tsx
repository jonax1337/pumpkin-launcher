/** Leerzustand mit Pumpkin Block. ill ersetzt das Zeichen, ill={false} lässt es weg. */
import type { ComponentProps } from "react";
import { BrandMark } from "@/branding/Brand";
import { Empty } from "@/ui";

export function EmptyState({ ill, ...props }: ComponentProps<typeof Empty>) {
  return <Empty ill={ill === undefined ? <BrandMark size={96} /> : ill} {...props} />;
}
