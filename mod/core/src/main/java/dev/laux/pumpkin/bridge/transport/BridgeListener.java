package dev.laux.pumpkin.bridge.transport;

import dev.laux.pumpkin.bridge.protocol.ClosingReason;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.State;
import dev.laux.pumpkin.bridge.protocol.NotifyKind;
import java.util.Optional;

/** Called on the main thread. Text fields are untrusted; modules sanitise them before display. */
public interface BridgeListener {
	default void linkChanged(LinkState state) {
	}

	default void stateReceived(State state) {
	}

	default void notice(NotifyKind kind, Optional<String> name) {
	}

	default void closing(ClosingReason reason) {
	}
}
