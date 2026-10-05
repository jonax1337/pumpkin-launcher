package dev.laux.pumpkin.bridge.modules.friends.state;

import java.util.Optional;

/**
 * A friend, addressed by the alias {@code id} of this link; {@code mcUuid} is 32 lowercase hex characters when known and
 * {@code notice} is the hint the launcher attached to the friend, if any.
 */
public record Friend(String id, String name, Optional<String> mcUuid, Presence presence, Optional<FriendNotice> notice) {
	public enum Presence {
		OFFLINE,
		ONLINE,
		PLAYING
	}

	public boolean isOnline() {
		return presence != Presence.OFFLINE;
	}
}
