package dev.laux.pumpkin.bridge.platform.neoforge;

import dev.laux.pumpkin.bridge.compat.MinecraftMainThread;
import dev.laux.pumpkin.bridge.platform.shared.JavaVersion;
import dev.laux.pumpkin.bridge.protocol.GameInfo;
import dev.laux.pumpkin.bridge.runtime.MainThread;
import dev.laux.pumpkin.bridge.transport.BuildId;
import dev.laux.pumpkin.bridge.transport.HostPlatform;
import net.neoforged.fml.ModList;

final class NeoForgePlatform implements HostPlatform {
	@Override
	public String modVersion() {
		return versionOf("pumpkin_bridge");
	}

	@Override
	public String buildId() {
		return BuildId.ofLocation(ModList.get().getModFileById("pumpkin_bridge").getFile().getFilePath());
	}

	@Override
	public GameInfo game() {
		return new GameInfo(versionOf("minecraft"), "neoforge", versionOf("neoforge"), JavaVersion.current());
	}

	@Override
	public MainThread mainThread() {
		return new MinecraftMainThread();
	}

	private static String versionOf(String modId) {
		return ModList.get().getMods().stream()
			.filter(mod -> modId.equals(mod.getModId())).map(mod -> mod.getVersion().toString())
			.findFirst().orElseThrow(() -> new IllegalStateException("Missing loader metadata: " + modId));
	}
}
