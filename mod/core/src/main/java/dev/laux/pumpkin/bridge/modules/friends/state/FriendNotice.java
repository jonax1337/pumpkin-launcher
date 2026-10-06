package dev.laux.pumpkin.bridge.modules.friends.state;

import java.util.Objects;

/**
 * A hint the launcher attaches to a friend. The mod may acknowledge only {@link Renamed} ({@code friend.acknowledge});
 * {@link IdentityChanged} is reviewed by the player in the launcher, and the launcher answers {@code forbidden} when the mod tries.
 */
public interface FriendNotice {
	/** The friend changed the name shown for them; {@code previousName} is the name before. */
	public static final class Renamed implements FriendNotice {
		private final String previousName;

		public Renamed(String previousName) {
			this.previousName = previousName;
		}

		public String previousName() {
			return previousName;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Renamed)) {
				return false;
			}
			Renamed that = (Renamed) other;
			return Objects.equals(previousName, that.previousName);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(previousName);
			return hash;
		}

		@Override
		public String toString() {
			return "Renamed[previousName=" + previousName + "]";
		}
	}

	/** The friend's key changed: the player has to check the new fingerprint in the launcher. */
	public static final class IdentityChanged implements FriendNotice {
		public IdentityChanged() {
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof IdentityChanged)) {
				return false;
			}
			return true;
		}

		@Override
		public int hashCode() {
			return 0;
		}

		@Override
		public String toString() {
			return "IdentityChanged[]";
		}
	}
}
