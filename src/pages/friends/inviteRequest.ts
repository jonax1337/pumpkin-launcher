import { create } from "zustand";

/**
 * „Beitreten“ in der Freundesliste bittet den Einladungsdialog, genau diese Einladung zu zeigen.
 * Der Dialog gehört zu den globalen Freunde-Dialogen (components/friends/FriendDialogs.tsx); er liest die Bitte und setzt sie zurück.
 */
export const useInviteRequest = create<{ inviteId: string | null }>(() => ({ inviteId: null }));

export const requestInviteDialog = (inviteId: string) => useInviteRequest.setState({ inviteId });
