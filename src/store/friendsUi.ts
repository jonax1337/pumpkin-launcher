import { create } from "zustand";
import type { JoinSessionEvent } from "@/lib/types";
import {
  closeActive, dropInvite, emptyDialogQueue, enqueue, promote, type DialogQueue, type FriendDialog,
} from "./friendDialogQueue";

interface FriendsUiState {
  /** Ob Freunde eingeschaltet sind (`null` = noch nicht geladen). */
  friendsEnabled: boolean | null;
  /** Der Beitritt, der gerade läuft oder startet; `null`, wenn keiner läuft. Es gibt immer nur einen. */
  joinSession: JoinSessionEvent | null;
  /** Die globalen Dialoge für Einladungen und die Bitte der Mod: einer offen, die übrigen warten. */
  dialogs: DialogQueue;
}

/**
 * Zustand der Freunde, den Seiten und Dialoge teilen und der nicht aus einer Abfrage kommt.
 * `friendsEnabled` spiegelt die Abfrage `friendsState`; der Spielstart liest es außerhalb von React, um das Fenster beim
 * Schließen-Modus nicht zu beenden (lib/launcherWindow.ts).
 */
export const useFriendsUi = create<FriendsUiState>(() => ({ friendsEnabled: null, joinSession: null, dialogs: emptyDialogQueue }));

export const setFriendsEnabled = (enabled: boolean) => useFriendsUi.setState({ friendsEnabled: enabled });

/** Ein Ende zählt nur für den Beitritt, der gerade gilt: ein später Abschluss des vorigen löscht den neuen nicht. */
export function applyJoinSession(event: JoinSessionEvent) {
  useFriendsUi.setState(({ joinSession }) => {
    if (event.state.type !== "ended") return { joinSession: event };
    return joinSession?.joinId === event.joinId ? { joinSession: null } : {};
  });
}

const updateDialogs = (change: (queue: DialogQueue) => DialogQueue) =>
  useFriendsUi.setState(({ dialogs }) => ({ dialogs: change(dialogs) }));

export const queueFriendDialog = (dialog: FriendDialog) => updateDialogs((queue) => enqueue(queue, dialog));

/** Öffnet den nächsten wartenden Dialog, sobald nichts anderes mehr offen ist. */
export const openNextFriendDialog = () => updateDialogs(promote);

export const closeFriendDialog = () => updateDialogs(closeActive);

export const dropInviteDialog = (inviteId: string) => updateDialogs((queue) => dropInvite(queue, inviteId));
