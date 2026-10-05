package dev.laux.pumpkin.bridge.transport;

import dev.laux.pumpkin.bridge.protocol.RejectReason;
import dev.laux.pumpkin.bridge.protocol.Scopes;

/** Where the link to the launcher stands, as the main thread sees it. */
public sealed interface LinkState {
	LinkState OFFLINE = new Offline();

	default boolean isConnected() {
		return false;
	}

	/** No connection; the client keeps trying with a growing pause. */
	record Offline() implements LinkState {
	}

	record Connected(String launcherVersion, Scopes scopes) implements LinkState {
		@Override
		public boolean isConnected() {
			return true;
		}
	}

	/** The launcher refused this game; the client tries again only once a minute. */
	record Rejected(RejectReason reason) implements LinkState {
	}
}
