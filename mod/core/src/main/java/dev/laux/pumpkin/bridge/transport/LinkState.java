package dev.laux.pumpkin.bridge.transport;

import java.util.Objects;

import dev.laux.pumpkin.bridge.protocol.RejectReason;
import dev.laux.pumpkin.bridge.protocol.Scopes;

/** Where the link to the launcher stands, as the main thread sees it. */
public interface LinkState {
	LinkState OFFLINE = new Offline();

	default boolean isConnected() {
		return false;
	}

	/** No connection; the client keeps trying with a growing pause. */
	public static final class Offline implements LinkState {
		public Offline() {
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Offline)) {
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
			return "Offline[]";
		}
	}

	public static final class Connected implements LinkState {
		private final String launcherVersion;
		private final Scopes scopes;

		public Connected(String launcherVersion, Scopes scopes) {
			this.launcherVersion = launcherVersion;
			this.scopes = scopes;
		}

		public String launcherVersion() {
			return launcherVersion;
		}

		public Scopes scopes() {
			return scopes;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Connected)) {
				return false;
			}
			Connected that = (Connected) other;
			return Objects.equals(launcherVersion, that.launcherVersion)
				&& Objects.equals(scopes, that.scopes);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(launcherVersion);
			hash = 31 * hash + Objects.hashCode(scopes);
			return hash;
		}

		@Override
		public String toString() {
			return "Connected[launcherVersion=" + launcherVersion + ", scopes=" + scopes + "]";
		}

		@Override
		public boolean isConnected() {
			return true;
		}
	}

	/** The launcher refused this game; the client tries again only once a minute. */
	public static final class Rejected implements LinkState {
		private final RejectReason reason;

		public Rejected(RejectReason reason) {
			this.reason = reason;
		}

		public RejectReason reason() {
			return reason;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Rejected)) {
				return false;
			}
			Rejected that = (Rejected) other;
			return Objects.equals(reason, that.reason);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(reason);
			return hash;
		}

		@Override
		public String toString() {
			return "Rejected[reason=" + reason + "]";
		}
	}
}
