package dev.laux.pumpkin.bridge.compat;

import dev.laux.pumpkin.bridge.runtime.MainThread;
import net.minecraft.client.Minecraft;

/** The game's main thread: docs/bridge/MINECRAFT-API.md, "Minecraft: screens, main thread, leaving a world", {@code Minecraft#execute(Runnable)}, the same in every era. */
public final class MinecraftMainThread implements MainThread {
	@Override
	public void execute(Runnable task) {
		Minecraft.getInstance().execute(task);
	}
}
