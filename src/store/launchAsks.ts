import { create } from "zustand";
import { quickPlayTarget, type Instance, type QuickPlay } from "@/lib/types";

/** Ein Link will `instance` starten (bei `quickPlay` gleich in eine Welt oder auf einen Server); der Nutzer muss es bestätigen. */
export interface LaunchAsk {
  instance: Instance;
  quickPlay: QuickPlay | null;
}

/** Die offenen Rückfragen; die erste zeigt `LaunchAskDialog` (components/DeepLinks.tsx), die übrigen warten. */
export const useLaunchAsks = create<{ queue: LaunchAsk[] }>(() => ({ queue: [] }));

const askKey = ({ instance, quickPlay }: LaunchAsk) => `${instance.id}|${quickPlay ? `${quickPlay.type}:${quickPlayTarget(quickPlay)}` : ""}`;

/** Hängt die Rückfrage an; dieselbe zweite Anfrage (ein Link, der mehrfach ankommt) wartet nicht noch einmal. */
export const askToLaunch = (ask: LaunchAsk) =>
  useLaunchAsks.setState((state) => (state.queue.some((queued) => askKey(queued) === askKey(ask)) ? state : { queue: [...state.queue, ask] }));

/** Die erste Rückfrage ist beantwortet. */
export const closeLaunchAsk = () => useLaunchAsks.setState((state) => ({ queue: state.queue.slice(1) }));
