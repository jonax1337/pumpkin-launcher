package dev.laux.pumpkin.bridge.platform.neoforge;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.fml.common.Mod;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Tracer-Knoten <Version>-neoforge: beweist nur, dass NeoForge die Mod lädt und ihren Einstieg ruft (INGAME 11.2, S1). */
@Mod(value = "pumpkin_bridge", dist = Dist.CLIENT)
public final class TracerMod {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_bridge");
	// Die Minecraft-Version des Knotens setzt der Swap "minecraft_version" (gradle/node.gradle).
	//$ minecraft_version
	private static final String MINECRAFT = "1.21.1";

	public TracerMod() {
		LOG.info("pumpkin_bridge tracer {} neoforge", MINECRAFT);
	}
}
