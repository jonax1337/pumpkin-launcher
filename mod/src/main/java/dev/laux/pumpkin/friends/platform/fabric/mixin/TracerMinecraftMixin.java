package dev.laux.pumpkin.friends.platform.fabric.mixin;

import net.minecraft.client.Minecraft;
import org.slf4j.LoggerFactory;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Tracer-Knoten 1.21.1-fabric: beweist, dass ein Mixin aus dem remappten Jar greift. Ziel ist eine Methode, deren
 * Name nur über die Refmap in den Intermediary-Namen der Produktion gefunden wird (INGAME A4).
 */
@Mixin(Minecraft.class)
public abstract class TracerMinecraftMixin {
	@Inject(method = "run", at = @At("HEAD"))
	private void logTracerMixin(CallbackInfo callback) {
		LoggerFactory.getLogger("pumpkin_friends").info("pumpkin_friends tracer 1.21.1 fabric mixin");
	}
}
