package dev.laux.pumpkin.bridge.platform.forge;

import dev.laux.pumpkin.bridge.platform.shared.BridgeBootstrap;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLClientSetupEvent;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import net.minecraftforge.fml.loading.FMLEnvironment;

@Mod("pumpkin_bridge")
public final class BridgeMod {
	//? if >=1.21.6 {
	public BridgeMod(FMLJavaModLoadingContext context) {
		if (FMLEnvironment.dist == Dist.CLIENT) {
			FMLClientSetupEvent.getBus(context.getModBusGroup()).addListener(BridgeMod::initializeClient);
		}
	}
	//?} else {
	/*public BridgeMod() {
		if (FMLEnvironment.dist == Dist.CLIENT) {
			FMLJavaModLoadingContext.get().getModEventBus().addListener(BridgeMod::initializeClient);
		}
	}
	*///?}

	private static void initializeClient(FMLClientSetupEvent event) {
		event.enqueueWork(() -> BridgeBootstrap.initialize(new ForgePlatform("forge"), !FMLEnvironment.production));
	}
}
