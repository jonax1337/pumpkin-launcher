package dev.laux.pumpkin.friends.state;

import java.util.Optional;

/** A friend, addressed by the alias {@code id} of this link; {@code mcUuid} is 32 lowercase hex characters when known. */
public record Friend(String id, String name, Optional<String> mcUuid, Presence presence) {
	public enum Presence {
		OFFLINE,
		ONLINE,
		PLAYING
	}

	public boolean isOnline() {
		return presence != Presence.OFFLINE;
	}
}
