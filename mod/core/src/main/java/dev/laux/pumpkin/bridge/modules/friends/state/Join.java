package dev.laux.pumpkin.bridge.modules.friends.state;

import java.util.Optional;
import java.util.OptionalInt;

/** The foreign world this game has joined. */
public record Join(String inviteId, String hostName, Phase phase, Optional<Path> path, OptionalInt rttMs) {
	public enum Phase {
		WAITING_FOR_GAME,
		CONNECTING,
		CONNECTED
	}

	public enum Path {
		DIRECT,
		RELAY
	}
}
