package dev.laux.pumpkin.bridge.modules.friends.state;

import java.util.Optional;
import java.util.OptionalInt;

/**
 * Whether this game can share its world, the LAN port the launcher has verified once there is one, and whether another
 * game of the same launcher holds the shared world right now (A27); that game's session is not this game's business.
 */
public record Game(boolean hostable, Optional<Unhostable> reason, OptionalInt lanPort, boolean sharedElsewhere) {
	/** What is known before the launcher has pushed the topic. */
	public static final Game UNKNOWN = new Game(false, Optional.of(new Unhostable(Unhostable.Kind.NOT_READY, Optional.empty())),
		OptionalInt.empty(), false);

	public record Unhostable(Kind kind, Optional<String> minVersion) {
		public enum Kind {
			VERSION_UNSUPPORTED,
			MS_ACCOUNT_REQUIRED,
			MANIFEST_INVALID,
			NOT_READY
		}
	}
}
