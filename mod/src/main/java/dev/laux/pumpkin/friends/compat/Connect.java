package dev.laux.pumpkin.friends.compat;

import dev.laux.pumpkin.friends.ui.model.LoopbackAddress;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;

/** Connects the game to a server: only ever to a literal loopback address, never to a name (INGAME 7). */
public final class Connect {
	private static final String SERVER_NAME = "Pumpkin Friends";

	private Connect() {
	}

	/**
	 * Starts the connection screen to {@code host:port}; call it on the main thread. INGAME-API.md 3, "Connecting" and 3.2:
	 * {@code ConnectScreen#startConnecting} gets a sixth parameter {@code TransferState} from 1.20.5 (null here), and
	 * {@code ServerData(String, String, ServerData.Type)} exists from 1.20.2. Older eras arrive with the nodes that need them.
	 *
	 * @throws IllegalArgumentException if {@code host} is not a literal 127.x.y.z address
	 */
	public static void toLoopback(Screen parent, String host, int port) {
		if (!LoopbackAddress.isLiteral(host)) {
			throw new IllegalArgumentException("Pumpkin Friends connects only to a literal loopback address, got: " + host);
		}
		ServerData target = new ServerData(SERVER_NAME, host + ":" + port, ServerData.Type.OTHER);
		ConnectScreen.startConnecting(parent, Minecraft.getInstance(), new ServerAddress(host, port), target, false, null);
	}
}
