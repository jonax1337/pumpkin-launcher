import { create } from "zustand";

/**
 * Ob Freunde eingeschaltet sind, gespiegelt aus der Abfrage `friendsState` (`null` = noch nicht geladen).
 * Der Spielstart liest es außerhalb von React, um das Fenster beim Schließen-Modus nicht zu beenden (lib/launcherWindow.ts).
 */
export const useFriendsUi = create<{ friendsEnabled: boolean | null }>(() => ({ friendsEnabled: null }));

export const setFriendsEnabled = (enabled: boolean) => useFriendsUi.setState({ friendsEnabled: enabled });
