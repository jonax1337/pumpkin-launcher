package dev.laux.pumpkin.friends.bridge;

import dev.laux.pumpkin.friends.protocol.ClosingReason;
import dev.laux.pumpkin.friends.protocol.NotifyKind;
import java.util.Optional;

/** Called on the main thread. {@code name} of a notice is already sanitised and never empty. */
public interface BridgeListener {
	default void linkChanged(LinkState state) {
	}

	default void notice(NotifyKind kind, Optional<String> name) {
	}

	default void closing(ClosingReason reason) {
	}
}
