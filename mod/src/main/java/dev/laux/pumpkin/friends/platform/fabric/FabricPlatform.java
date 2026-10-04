package dev.laux.pumpkin.friends.platform.fabric;

import dev.laux.pumpkin.friends.bridge.HostPlatform;
import dev.laux.pumpkin.friends.protocol.GameInfo;
import dev.laux.pumpkin.friends.runtime.MainThread;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;

/** What the core needs to know about this node: Fabric's mod versions, the Java version, and Minecraft's main thread. */
final class FabricPlatform implements HostPlatform {
	private static final String LOADER_NAME = "fabric";

	@Override
	public String modVersion() {
		return versionOf("pumpkin_friends");
	}

	@Override
	public GameInfo game() {
		return new GameInfo(versionOf("minecraft"), LOADER_NAME, versionOf("fabricloader"), Runtime.version().feature());
	}

	@Override
	public MainThread mainThread() {
		return task -> Minecraft.getInstance().execute(task);
	}

	private static String versionOf(String modId) {
		return FabricLoader.getInstance().getModContainer(modId)
			.map(mod -> mod.getMetadata().getVersion().getFriendlyString())
			.orElse("unknown");
	}
}
