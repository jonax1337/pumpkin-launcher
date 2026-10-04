package dev.laux.pumpkin.friends.state;

import java.util.Optional;
import java.util.OptionalInt;

/** Whether this game can share its world, and the LAN port the launcher has verified, once there is one. */
public record Game(boolean hostable, Optional<Unhostable> reason, OptionalInt lanPort) {
	/** What is known before the launcher has pushed the topic. */
	public static final Game UNKNOWN = new Game(false, Optional.of(new Unhostable(Unhostable.Kind.NOT_READY, Optional.empty())),
		OptionalInt.empty());

	public record Unhostable(Kind kind, Optional<String> minVersion) {
		public enum Kind {
			VERSION_UNSUPPORTED,
			MS_ACCOUNT_REQUIRED,
			MANIFEST_INVALID,
			NOT_READY
		}
	}
}
