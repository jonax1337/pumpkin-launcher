package dev.laux.pumpkin.bridge.platform.neoforgelegacy;

import dev.laux.pumpkin.bridge.platform.forge.ForgePlatform;
import dev.laux.pumpkin.bridge.platform.shared.BridgeBootstrap;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLClientSetupEvent;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import net.minecraftforge.fml.loading.FMLEnvironment;

/** NeoForge 47.x still uses Forge's packages and builtin mod id. */
@Mod("pumpkin_bridge")
public final class BridgeMod {
	public BridgeMod() {
		if (FMLEnvironment.dist == Dist.CLIENT) {
			FMLJavaModLoadingContext.get().getModEventBus().addListener(BridgeMod::initializeClient);
		}
	}

	private static void initializeClient(FMLClientSetupEvent event) {
		event.enqueueWork(() -> BridgeBootstrap.initialize(new ForgePlatform("neoforge"), !FMLEnvironment.production));
	}
}
