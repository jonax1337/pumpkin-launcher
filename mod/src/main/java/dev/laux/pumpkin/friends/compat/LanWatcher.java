package dev.laux.pumpkin.friends.compat;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import java.util.OptionalInt;
import net.minecraft.client.Minecraft;

/**
 * Meldet dem Launcher jede Änderung des LAN-Ports, egal ob über die Mod oder Vanillas Weltoptionen geöffnet
 * (SPEC 11.3). Der Launcher prüft jeden gemeldeten Port selbst; die Meldung ist nur ein Hinweis.
 */
public final class LanWatcher {
	private final BridgeClient client;
	private OptionalInt reportedPort = OptionalInt.empty();
	private boolean wasConnected;

	public LanWatcher(BridgeClient client) {
		this.client = client;
	}

	public void tick(Minecraft minecraft) {
		boolean connected = client.isConnected();
		if (connected && !wasConnected) {
			// Eine neue Verbindung kennt noch keinen Port: eine schon offene Welt wird erneut gemeldet.
			reportedPort = OptionalInt.empty();
		}
		wasConnected = connected;
		OptionalInt port = LanControl.publishedPort(minecraft);
		if (connected && !port.equals(reportedPort)) {
			report(port);
			reportedPort = port;
		}
	}

	private void report(OptionalInt port) {
		if (port.isPresent()) {
			client.lanOpened(port.getAsInt());
		} else {
			client.lanClosed();
		}
	}
}
