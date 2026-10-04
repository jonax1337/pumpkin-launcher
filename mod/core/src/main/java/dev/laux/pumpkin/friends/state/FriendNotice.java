package dev.laux.pumpkin.friends.state;

/**
 * A hint the launcher attaches to a friend. The mod may acknowledge only {@link Renamed} ({@code friend.acknowledge});
 * {@link IdentityChanged} is reviewed by the player in the launcher, and the launcher answers {@code forbidden} when the mod tries.
 */
public sealed interface FriendNotice {
	/** The friend changed the name shown for them; {@code previousName} is the name before. */
	record Renamed(String previousName) implements FriendNotice {
	}

	/** The friend's key changed: the player has to check the new fingerprint in the launcher. */
	record IdentityChanged() implements FriendNotice {
	}
}
