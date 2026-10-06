package dev.laux.pumpkin.bridge.platform.fabric;

import dev.laux.pumpkin.bridge.transport.HostPlatform;
import dev.laux.pumpkin.bridge.transport.BuildId;
import java.nio.file.Path;
import java.util.List;
import dev.laux.pumpkin.bridge.compat.MinecraftMainThread;
import dev.laux.pumpkin.bridge.protocol.GameInfo;
import dev.laux.pumpkin.bridge.runtime.MainThread;
import dev.laux.pumpkin.bridge.platform.shared.JavaVersion;
import net.fabricmc.loader.api.FabricLoader;

/** What the core needs to know about this node: Fabric's mod versions, the Java version, and Minecraft's main thread. */
final class FabricPlatform implements HostPlatform {

	@Override
	public String modVersion() {
		return versionOf("pumpkin_bridge");
	}

	@Override
	public String buildId() {
		List<Path> origins = FabricLoader.getInstance().getModContainer("pumpkin_bridge")
			.orElseThrow(() -> new IllegalStateException("Missing bridge origin")).getOrigin().getPaths();
		return origins.size() == 1 ? BuildId.ofLocation(origins.get(0)) : BuildId.DEV;
	}

	@Override
	public GameInfo game() {
		boolean quilt = FabricLoader.getInstance().isModLoaded("quilt_loader");
		return new GameInfo(versionOf("minecraft"), quilt ? "quilt" : "fabric",
			versionOf(quilt ? "quilt_loader" : "fabricloader"), JavaVersion.current());
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
