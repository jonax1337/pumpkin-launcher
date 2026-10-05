package dev.laux.pumpkin.bridge.compat;

import dev.laux.pumpkin.bridge.modules.friends.ui.model.LoopbackAddress;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;

/** Connects the game to a server: only ever to a literal loopback address, never to a name (INGAME 7). */
public final class Connect {
	private static final String SERVER_NAME = "Pumpkin Bridge";

	private Connect() {
	}

	/**
	 * Starts the connection screen to {@code host:port}; call it on the main thread. INGAME-API.md 3, "Connecting" and 3.2:
	 * {@code ConnectScreen#startConnecting} gets a sixth parameter {@code TransferState} from 1.20.5 (null here);
	 * {@code ServerData(String, String, ServerData.Type)} exists from 1.20.2, before that the third parameter is a
	 * {@code boolean}.
	 *
	 * @throws IllegalArgumentException if {@code host} is not a literal 127.x.y.z address
	 */
	public static void toLoopback(Screen parent, String host, int port) {
		if (!LoopbackAddress.isLiteral(host)) {
			throw new IllegalArgumentException("Pumpkin Bridge connects only to a literal loopback address, got: " + host);
		}
		//? if >=1.20.2 {
		ServerData target = new ServerData(SERVER_NAME, host + ":" + port, ServerData.Type.OTHER);
		//?} else {
		/*// Same table, 1.20 to 1.20.1: ServerData(String, String, boolean), false as vanilla's join screen.
		ServerData target = new ServerData(SERVER_NAME, host + ":" + port, false);
		*///?}
		//? if >=1.20.5 {
		ConnectScreen.startConnecting(parent, Minecraft.getInstance(), new ServerAddress(host, port), target, false, null);
		//?} else {
		/*// Same table, 1.20 to 1.20.4: five parameters, no TransferState.
		ConnectScreen.startConnecting(parent, Minecraft.getInstance(), new ServerAddress(host, port), target, false);
		*///?}
	}
}
