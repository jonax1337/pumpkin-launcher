package dev.laux.pumpkin.friends.state;

import java.util.Optional;

/** The player's own friends identity as the launcher reports it. */
public record Me(boolean enabled, Availability availability, Network network, Optional<String> fingerprint) {
	public enum Availability {
		AVAILABLE,
		NO_SECRET_STORE,
		IDENTITY_LOST
	}

	public enum Network {
		OFF,
		STARTING,
		ONLINE,
		DEGRADED
	}
}
