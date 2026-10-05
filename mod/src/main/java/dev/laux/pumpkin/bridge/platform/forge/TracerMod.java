package dev.laux.pumpkin.bridge.platform.forge;

import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.loading.FMLEnvironment;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Tracer-Knoten 1.20.1-forge: beweist nur, dass Forge die Mod lädt und ihren Einstieg ruft (INGAME 11.2, S1). */
@Mod("pumpkin_bridge")
public final class TracerMod {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_bridge");

	public TracerMod() {
		// Forge 1.20.1 kennt keine Dist-Angabe an @Mod; auf einem Server bleibt die Mod still.
		if (FMLEnvironment.dist == Dist.CLIENT) {
			LOG.info("pumpkin_bridge tracer 1.20.1 forge");
		}
	}
}
