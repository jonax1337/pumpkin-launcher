package dev.laux.pumpkin.bridge.protocol;

/** The notices that may become a toast. The enum is the allow-list: any other kind from the launcher is dropped. */
public enum NotifyKind {
	REQUEST_RECEIVED,
	INVITE_RECEIVED,
	FRIEND_ONLINE,
	GUEST_JOINED,
	GUEST_LEFT,
	SESSION_ENDED,
	JOIN_ENDED,
	SCOPE_DENIED
}
