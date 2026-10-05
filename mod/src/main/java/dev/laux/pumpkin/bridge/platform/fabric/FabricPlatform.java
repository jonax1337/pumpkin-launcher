package dev.laux.pumpkin.bridge.platform.fabric;

import dev.laux.pumpkin.bridge.transport.HostPlatform;
import dev.laux.pumpkin.bridge.compat.MinecraftMainThread;
import dev.laux.pumpkin.bridge.protocol.GameInfo;
import dev.laux.pumpkin.bridge.runtime.MainThread;
import net.fabricmc.loader.api.FabricLoader;

/** What the core needs to know about this node: Fabric's mod versions, the Java version, and Minecraft's main thread. */
final class FabricPlatform implements HostPlatform {
	private static final String LOADER_NAME = "fabric";

	@Override
	public String modVersion() {
		return versionOf("pumpkin_bridge");
	}

	@Override
	public GameInfo game() {
		return new GameInfo(versionOf("minecraft"), LOADER_NAME, versionOf("fabricloader"), Runtime.version().feature());
	}

	@Override
	public MainThread mainThread() {
		return new MinecraftMainThread();
	}

	private static String versionOf(String modId) {
		return FabricLoader.getInstance().getModContainer(modId)
			.map(mod -> mod.getMetadata().getVersion().getFriendlyString())
			.orElse("unknown");
	}
}
