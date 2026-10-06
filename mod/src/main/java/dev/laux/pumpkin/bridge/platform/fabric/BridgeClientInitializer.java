package dev.laux.pumpkin.bridge.platform.fabric;

import dev.laux.pumpkin.bridge.platform.shared.BridgeBootstrap;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;

public final class BridgeClientInitializer implements ClientModInitializer {
	@Override
	public void onInitializeClient() {
		BridgeBootstrap.initialize(new FabricPlatform(), FabricLoader.getInstance().isDevelopmentEnvironment());
	}
}
