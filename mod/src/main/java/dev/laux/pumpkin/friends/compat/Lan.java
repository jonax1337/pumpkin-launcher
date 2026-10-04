package dev.laux.pumpkin.friends.compat;

import java.util.Optional;
import java.util.OptionalInt;
import net.minecraft.client.Minecraft;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.HttpUtil;

/**
 * Opens the singleplayer world to the LAN and reports its port; only call it on the client thread. INGAME-API.md 3,
 * "Publish to LAN" (rows {@code IntegratedServer#isPublished}, {@code #getPort}, {@code #publishServer}) and 3.2.
 */
public final class Lan {
	private Lan() {
	}

	/** {@code Minecraft#getSingleplayerServer()} exists in every era ("Minecraft: screens, main thread, leaving a world"). */
	private static Optional<IntegratedServer> server() {
		return Optional.ofNullable(Minecraft.getInstance().getSingleplayerServer());
	}

	/**
	 * Whether the player is on a multiplayer server, the gate of the Teilen tab (INGAME 6.4, "Auf Servern nicht möglich").
	 * INGAME-API.md 3, "Minecraft: screens, main thread, leaving a world": {@code Minecraft#getCurrentServer()} in every
	 * era. A game that joined a friend counts as joined, not as "on a server" - the share model checks the join first.
	 */
	public static boolean onMultiplayerServer() {
		return Minecraft.getInstance().getCurrentServer() != null;
	}

	public static boolean canPublish() {
		return server().filter(server -> !server.isPublished()).isPresent();
	}

	public static OptionalInt publishedPort() {
		return server().filter(IntegratedServer::isPublished)
			.map(server -> OptionalInt.of(server.getPort()))
			.orElse(OptionalInt.empty());
	}

	/** Gäste bekommen keine Befehle; der Port ist wie in Vanillas „Im LAN öffnen“ ein freier zufälliger ({@code HttpUtil#getAvailablePort}). */
	public static boolean publish() {
		return server().map(server -> publishOn(server, HttpUtil.getAvailablePort())).orElse(false);
	}

	private static boolean publishOn(IntegratedServer server, int port) {
		//? if >=26.3 {
		// "Publish to LAN" table, column 26.3: publishServer(MultiplayerScope, boolean, int).
		return server.publishServer(MinecraftServer.MultiplayerScope.LAN, false, port);
		//?} else if >=26.2 {
		/*// Column 26.2: publishServer(MultiplayerScope, GameType, boolean, int); MultiplayerScope.LAN exists from 26.2.
		return server.publishServer(MinecraftServer.MultiplayerScope.LAN, server.getDefaultGameType(), false, port);
		*///?} else {
		/*// Column 1.20 to 26.1.2: publishServer(GameType, boolean, int), the call of vanilla's ShareToLanScreen (3.2).
		return server.publishServer(server.getDefaultGameType(), false, port);
		*///?}
	}

	/**
	 * A2: {@code IntegratedServer#unpublishServer()} exists only from 26.2. Before that a published world stays open to the
	 * LAN until the player leaves it, and ending the session happens in the launcher alone ({@code host.stop}).
	 */
	public static boolean canUnpublish() {
		//? if >=26.2 {
		return true;
		//?} else {
		/*return false;
		*///?}
	}

	/** Does nothing where {@link #canUnpublish()} is false. */
	public static void unpublish() {
		//? if >=26.2 {
		server().ifPresent(IntegratedServer::unpublishServer);
		//?}
	}
}
