package dev.laux.pumpkin.friends.platform.fabric;

import net.fabricmc.api.ClientModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Tracer-Knoten 1.21.1-fabric: beweist nur, dass Fabric das remappte Jar lädt und den Einstieg ruft (INGAME 11.2, S1). */
public final class TracerClient implements ClientModInitializer {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_friends");

	@Override
	public void onInitializeClient() {
		LOG.info("pumpkin_friends tracer 1.21.1 fabric");
	}
}
