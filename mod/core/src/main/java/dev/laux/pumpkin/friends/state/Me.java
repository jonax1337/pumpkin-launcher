package dev.laux.pumpkin.friends.state;

import java.util.Optional;

/** The player's own friends identity as the launcher reports it; {@code directory} is the state of adding friends by name. */
public record Me(boolean enabled, Availability availability, Network network, Optional<String> fingerprint, Directory directory) {
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

	/** The launcher's {@code DirectoryState}: whether friends can be added by Minecraft name right now. */
	public enum Directory {
		ACTIVE,
		OFF,
		UNREACHABLE,
		NOT_ALLOWED,
		UNAVAILABLE
	}
}
