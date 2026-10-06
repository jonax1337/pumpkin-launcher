package dev.laux.pumpkin.bridge.modules.friends.state;

import java.util.Objects;

import java.util.Optional;
import java.util.OptionalInt;

/** The foreign world this game has joined. */
public final class Join {
	private final String inviteId;
	private final String hostName;
	private final Phase phase;
	private final Optional<Path> path;
	private final OptionalInt rttMs;

	public Join(String inviteId, String hostName, Phase phase, Optional<Path> path, OptionalInt rttMs) {
		this.inviteId = inviteId;
		this.hostName = hostName;
		this.phase = phase;
		this.path = path;
		this.rttMs = rttMs;
	}

	public String inviteId() {
		return inviteId;
	}

	public String hostName() {
		return hostName;
	}

	public Phase phase() {
		return phase;
	}

	public Optional<Path> path() {
		return path;
	}

	public OptionalInt rttMs() {
		return rttMs;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof Join)) {
			return false;
		}
		Join that = (Join) other;
		return Objects.equals(inviteId, that.inviteId)
			&& Objects.equals(hostName, that.hostName)
			&& Objects.equals(phase, that.phase)
			&& Objects.equals(path, that.path)
			&& Objects.equals(rttMs, that.rttMs);
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(inviteId);
		hash = 31 * hash + Objects.hashCode(hostName);
		hash = 31 * hash + Objects.hashCode(phase);
		hash = 31 * hash + Objects.hashCode(path);
		hash = 31 * hash + Objects.hashCode(rttMs);
		return hash;
	}

	@Override
	public String toString() {
		return "Join[inviteId=" + inviteId + ", hostName=" + hostName + ", phase=" + phase + ", path=" + path + ", rttMs=" + rttMs + "]";
	}

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
