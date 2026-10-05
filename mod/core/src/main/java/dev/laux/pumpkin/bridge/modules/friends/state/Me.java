package dev.laux.pumpkin.bridge.modules.friends.state;

import java.util.Optional;

/**
 * The player's own friends identity as the launcher reports it; {@code directory} is the state of adding friends by
 * name. Beyond the states it carries the three values of the read-only Optionen tab (INGAME 6.2, A27): the display name,
 * whether other players can find this player by Minecraft name, and the relay host while the network runs through one.
 */
public record Me(boolean enabled, Availability availability, Network network, Optional<String> fingerprint, Directory directory,
		String displayName, boolean findableByName, Optional<String> relayHost) {
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
