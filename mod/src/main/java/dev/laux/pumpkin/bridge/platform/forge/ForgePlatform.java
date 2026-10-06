package dev.laux.pumpkin.bridge.platform.forge;

import dev.laux.pumpkin.bridge.compat.MinecraftMainThread;
import dev.laux.pumpkin.bridge.platform.shared.JavaVersion;
import dev.laux.pumpkin.bridge.protocol.GameInfo;
import dev.laux.pumpkin.bridge.runtime.MainThread;
import dev.laux.pumpkin.bridge.transport.BuildId;
import dev.laux.pumpkin.bridge.transport.HostPlatform;
import net.minecraftforge.fml.ModList;

public final class ForgePlatform implements HostPlatform {
	private final String loader;

	public ForgePlatform(String loader) {
		this.loader = loader;
	}

	@Override
	public String modVersion() {
		return versionOf("pumpkin_bridge");
	}

	@Override
	public String buildId() {
		//? if >=26.1 {
		return BuildId.ofLocation(ModList.getModFileById("pumpkin_bridge").getFile().getFilePath());
		//?} else {
		/*return BuildId.ofLocation(ModList.get().getModFileById("pumpkin_bridge").getFile().getFilePath());
		*///?}
	}

	@Override
	public GameInfo game() {
		return new GameInfo(versionOf("minecraft"), loader, versionOf("forge"), JavaVersion.current());
	}

	@Override
	public MainThread mainThread() {
		return new MinecraftMainThread();
	}

	private static String versionOf(String modId) {
		//? if >=26.1 {
		return ModList.getMods().stream()
		//?} else {
		/*return ModList.get().getMods().stream()
		*///?}
			.filter(mod -> modId.equals(mod.getModId())).map(mod -> mod.getVersion().toString())
			.findFirst().orElseThrow(() -> new IllegalStateException("Missing loader metadata: " + modId));
	}
}
