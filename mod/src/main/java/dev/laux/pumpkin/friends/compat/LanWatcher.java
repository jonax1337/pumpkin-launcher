package dev.laux.pumpkin.friends.compat;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.bridge.Messages.LanClosed;
import dev.laux.pumpkin.friends.bridge.Messages.LanOpened;
import dev.laux.pumpkin.friends.state.StateStore;
import java.util.OptionalInt;
import net.minecraft.client.Minecraft;

/**
 * Meldet dem Launcher jede Änderung des LAN-Ports, egal ob über die Mod oder Vanillas Weltoptionen geöffnet
 * (SPEC 11.3). Der Launcher prüft jeden gemeldeten Port selbst; die Meldung ist nur ein Hinweis.
 */
public final class LanWatcher {
	private final BridgeClient client;
	private final StateStore store;
	private OptionalInt reportedPort = OptionalInt.empty();
	private boolean wasConnected;

	public LanWatcher(BridgeClient client, StateStore store) {
		this.client = client;
		this.store = store;
	}

	public void tick(Minecraft minecraft) {
		boolean connected = store.isConnected();
		if (connected && !wasConnected) {
			// Eine neue Verbindung kennt noch keinen Port: eine schon offene Welt wird erneut gemeldet.
			reportedPort = OptionalInt.empty();
		}
		wasConnected = connected;
		OptionalInt port = LanControl.publishedPort(minecraft);
		if (connected && !port.equals(reportedPort)) {
			client.send(port.isPresent() ? new LanOpened(port.getAsInt()) : new LanClosed());
			reportedPort = port;
		}
	}
}
