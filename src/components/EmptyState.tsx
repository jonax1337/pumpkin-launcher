/** Leerzustand der App: der Kit-`Empty` mit Buddy als Standardbild. `ill` ersetzt den Buddy, `ill={false}` lässt das Bild weg. */
import type { ComponentProps } from "react";
import { Buddy, type BuddyMood } from "@/branding/Brand";
import { Empty } from "@/ui";

export function EmptyState({ ill, mood = "idle", ...props }: ComponentProps<typeof Empty> & { mood?: BuddyMood }) {
  return <Empty ill={ill === undefined ? <Buddy size={96} mood={mood} /> : ill} {...props} />;
}
