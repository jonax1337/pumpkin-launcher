package dev.laux.pumpkin.friends.state;

import java.util.List;
import java.util.Optional;

/** Friend requests in both directions. */
public record Requests(List<Incoming> incoming, List<Outgoing> outgoing) {
	public static final Requests NONE = new Requests(List.of(), List.of());

	public Requests {
		incoming = List.copyOf(incoming);
		outgoing = List.copyOf(outgoing);
	}

	public record Incoming(String id, String name, Optional<String> mcName, String fingerprint) {
	}

	public record Outgoing(String id, Optional<String> name, State state) {
	}

	public enum State {
		DELIVERING,
		AWAITING_ANSWER
	}
}
