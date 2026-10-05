package dev.laux.pumpkin.bridge.modules.friends.state;

import java.util.List;
import java.util.Optional;

/**
 * Friend requests in both directions. {@code retryCooldownMillis} is the launcher's remaining block after "Jetzt
 * zustellen" ({@code friends.retry}); zero when pressing again would act now (A27). The value counts from the moment
 * this push arrived, so {@link TopicStore#retryCooldownMillis(long)} is the live countdown.
 */
public record Requests(List<Incoming> incoming, List<Outgoing> outgoing, long retryCooldownMillis) {
	public static final Requests NONE = new Requests(List.of(), List.of(), 0);

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
