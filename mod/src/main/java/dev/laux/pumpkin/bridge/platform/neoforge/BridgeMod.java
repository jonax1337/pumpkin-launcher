package dev.laux.pumpkin.bridge.platform.neoforge;

import dev.laux.pumpkin.bridge.platform.shared.BridgeBootstrap;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import net.neoforged.fml.loading.FMLEnvironment;

//? if >=1.21 {
@Mod(value = "pumpkin_bridge", dist = Dist.CLIENT)
//?} else {
/*@Mod("pumpkin_bridge")
*///?}
public final class BridgeMod {
	public BridgeMod(IEventBus modEventBus) {
		//? if >=1.21.9 {
		if (FMLEnvironment.getDist() == Dist.CLIENT) {
		//?} else {
		/*if (FMLEnvironment.dist == Dist.CLIENT) {
		*///?}
			modEventBus.addListener(BridgeMod::initializeClient);
		}
	}

	private static void initializeClient(FMLClientSetupEvent event) {
		//? if >=1.21.9 {
		event.enqueueWork(() -> BridgeBootstrap.initialize(new NeoForgePlatform(), !FMLEnvironment.isProduction()));
		//?} else {
		/*event.enqueueWork(() -> BridgeBootstrap.initialize(new NeoForgePlatform(), !FMLEnvironment.production));
		*///?}
	}
}
