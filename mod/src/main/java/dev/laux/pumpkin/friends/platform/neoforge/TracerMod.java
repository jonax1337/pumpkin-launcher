package dev.laux.pumpkin.friends.platform.neoforge;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.fml.common.Mod;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Tracer-Knoten 1.21.1-neoforge: beweist nur, dass NeoForge die Mod lädt und ihren Einstieg ruft (INGAME 11.2, S1). */
@Mod(value = "pumpkin_friends", dist = Dist.CLIENT)
public final class TracerMod {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_friends");

	public TracerMod() {
		LOG.info("pumpkin_friends tracer 1.21.1 neoforge");
	}
}
