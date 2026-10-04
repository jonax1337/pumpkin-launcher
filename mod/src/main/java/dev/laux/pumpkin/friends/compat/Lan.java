package dev.laux.pumpkin.friends.compat;

import java.util.Optional;
import java.util.OptionalInt;
import net.minecraft.client.Minecraft;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.HttpUtil;

/** Öffnet und schließt die Einzelspielerwelt für das LAN; nur auf dem Client-Thread aufrufen. */
public final class LanControl {
	private LanControl() {
	}

	public static boolean canPublish(Minecraft minecraft) {
		return server(minecraft).filter(server -> !server.isPublished()).isPresent();
	}

	public static OptionalInt publishedPort(Minecraft minecraft) {
		return server(minecraft).filter(IntegratedServer::isPublished)
			.map(server -> OptionalInt.of(server.getPort()))
			.orElse(OptionalInt.empty());
	}

	/** Gäste bekommen keine Befehle; der Port ist wie in Vanillas „Im LAN öffnen“ ein freier zufälliger. */
	public static boolean publish(Minecraft minecraft) {
		return server(minecraft)
			.map(server -> server.publishServer(MinecraftServer.MultiplayerScope.LAN, false, HttpUtil.getAvailablePort()))
			.orElse(false);
	}

	public static void unpublish(Minecraft minecraft) {
		server(minecraft).ifPresent(IntegratedServer::unpublishServer);
	}

	private static Optional<IntegratedServer> server(Minecraft minecraft) {
		return Optional.ofNullable(minecraft.getSingleplayerServer());
	}
}
