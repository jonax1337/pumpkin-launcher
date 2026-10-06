package dev.laux.pumpkin.bridge.modules.friends.state;

import java.util.Objects;

import java.util.Optional;

/**
 * The player's own friends identity as the launcher reports it; {@code directory} is the state of adding friends by
 * name. Beyond the states it carries the three values of the read-only Optionen tab (docs/bridge/README.md, "In-game navigation and world behavior", A27): the display name,
 * whether other players can find this player by Minecraft name, and the relay host while the network runs through one.
 */
public final class Me {
	private final boolean enabled;
	private final Availability availability;
	private final Network network;
	private final Optional<String> fingerprint;
	private final Directory directory;
	private final String displayName;
	private final boolean findableByName;
	private final Optional<String> relayHost;

	public Me(boolean enabled, Availability availability, Network network, Optional<String> fingerprint, Directory directory, String displayName, boolean findableByName, Optional<String> relayHost) {
		this.enabled = enabled;
		this.availability = availability;
		this.network = network;
		this.fingerprint = fingerprint;
		this.directory = directory;
		this.displayName = displayName;
		this.findableByName = findableByName;
		this.relayHost = relayHost;
	}

	public boolean enabled() {
		return enabled;
	}

	public Availability availability() {
		return availability;
	}

	public Network network() {
		return network;
	}

	public Optional<String> fingerprint() {
		return fingerprint;
	}

	public Directory directory() {
		return directory;
	}

	public String displayName() {
		return displayName;
	}

	public boolean findableByName() {
		return findableByName;
	}

	public Optional<String> relayHost() {
		return relayHost;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof Me)) {
			return false;
		}
		Me that = (Me) other;
		return enabled == that.enabled
			&& Objects.equals(availability, that.availability)
			&& Objects.equals(network, that.network)
			&& Objects.equals(fingerprint, that.fingerprint)
			&& Objects.equals(directory, that.directory)
			&& Objects.equals(displayName, that.displayName)
			&& findableByName == that.findableByName
			&& Objects.equals(relayHost, that.relayHost);
	}

	@Override
	public int hashCode() {
		int hash = Boolean.hashCode(enabled);
		hash = 31 * hash + Objects.hashCode(availability);
		hash = 31 * hash + Objects.hashCode(network);
		hash = 31 * hash + Objects.hashCode(fingerprint);
		hash = 31 * hash + Objects.hashCode(directory);
		hash = 31 * hash + Objects.hashCode(displayName);
		hash = 31 * hash + Boolean.hashCode(findableByName);
		hash = 31 * hash + Objects.hashCode(relayHost);
		return hash;
	}

	@Override
	public String toString() {
		return "Me[enabled=" + enabled + ", availability=" + availability + ", network=" + network + ", fingerprint=" + fingerprint + ", directory=" + directory + ", displayName=" + displayName + ", findableByName=" + findableByName + ", relayHost=" + relayHost + "]";
	}

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
