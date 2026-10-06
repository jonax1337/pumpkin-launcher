package dev.laux.pumpkin.bridge.modules.friends.state;

import java.util.Objects;

import java.util.Optional;
import java.util.OptionalInt;

/**
 * Whether this game can share its world, the LAN port the launcher has verified once there is one, and whether another
 * game of the same launcher holds the shared world right now (A27); that game's session is not this game's business.
 */
public final class Game {
	private final boolean hostable;
	private final Optional<Unhostable> reason;
	private final OptionalInt lanPort;
	private final boolean sharedElsewhere;

	public Game(boolean hostable, Optional<Unhostable> reason, OptionalInt lanPort, boolean sharedElsewhere) {
		this.hostable = hostable;
		this.reason = reason;
		this.lanPort = lanPort;
		this.sharedElsewhere = sharedElsewhere;
	}

	public boolean hostable() {
		return hostable;
	}

	public Optional<Unhostable> reason() {
		return reason;
	}

	public OptionalInt lanPort() {
		return lanPort;
	}

	public boolean sharedElsewhere() {
		return sharedElsewhere;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof Game)) {
			return false;
		}
		Game that = (Game) other;
		return hostable == that.hostable
			&& Objects.equals(reason, that.reason)
			&& Objects.equals(lanPort, that.lanPort)
			&& sharedElsewhere == that.sharedElsewhere;
	}

	@Override
	public int hashCode() {
		int hash = Boolean.hashCode(hostable);
		hash = 31 * hash + Objects.hashCode(reason);
		hash = 31 * hash + Objects.hashCode(lanPort);
		hash = 31 * hash + Boolean.hashCode(sharedElsewhere);
		return hash;
	}

	@Override
	public String toString() {
		return "Game[hostable=" + hostable + ", reason=" + reason + ", lanPort=" + lanPort + ", sharedElsewhere=" + sharedElsewhere + "]";
	}

	/** What is known before the launcher has pushed the topic. */
	public static final Game UNKNOWN = new Game(false, Optional.of(new Unhostable(Unhostable.Kind.NOT_READY, Optional.empty())),
		OptionalInt.empty(), false);

	public static final class Unhostable {
		private final Kind kind;
		private final Optional<String> minVersion;

		public Unhostable(Kind kind, Optional<String> minVersion) {
			this.kind = kind;
			this.minVersion = minVersion;
		}

		public Kind kind() {
			return kind;
		}

		public Optional<String> minVersion() {
			return minVersion;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Unhostable)) {
				return false;
			}
			Unhostable that = (Unhostable) other;
			return Objects.equals(kind, that.kind)
				&& Objects.equals(minVersion, that.minVersion);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(kind);
			hash = 31 * hash + Objects.hashCode(minVersion);
			return hash;
		}

		@Override
		public String toString() {
			return "Unhostable[kind=" + kind + ", minVersion=" + minVersion + "]";
		}

		public enum Kind {
			VERSION_UNSUPPORTED,
			MS_ACCOUNT_REQUIRED,
			MANIFEST_INVALID,
			NOT_READY
		}
	}
}
