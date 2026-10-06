package dev.laux.pumpkin.bridge.compat;

import dev.laux.pumpkin.bridge.modules.friends.ui.model.LoopbackAddress;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.multiplayer.ServerData;
//? if >=1.17 {
import net.minecraft.client.multiplayer.resolver.ServerAddress;
//?}

/** Connects the game to a server: only ever to a literal loopback address, never to a name (docs/bridge/README.md, "In-game navigation and world behavior"). */
public final class Connect {
	private static final String SERVER_NAME = "Pumpkin Bridge";

	private Connect() {
	}

	/**
	 * Starts the connection screen to {@code host:port}; call it on the main thread. docs/bridge/MINECRAFT-API.md, "Connecting":
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
		//?} else if >=1.20 {
		/*ConnectScreen.startConnecting(parent, Minecraft.getInstance(), new ServerAddress(host, port), target, false);
		*///?} else if >=1.17 {
		/*ConnectScreen.startConnecting(parent, Minecraft.getInstance(), new ServerAddress(host, port), target);
		*///?} else {
		/*GameScreens.show(new ConnectScreen(parent, Minecraft.getInstance(), target));
		*///?}
	}
}
