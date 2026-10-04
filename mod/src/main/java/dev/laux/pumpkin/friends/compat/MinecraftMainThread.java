package dev.laux.pumpkin.friends.compat;

import dev.laux.pumpkin.friends.runtime.MainThread;
import net.minecraft.client.Minecraft;

/** The game's main thread: INGAME-API.md 3, "Minecraft: screens, main thread, leaving a world", {@code Minecraft#execute(Runnable)}, the same in every era. */
public final class MinecraftMainThread implements MainThread {
	@Override
	public void execute(Runnable task) {
		Minecraft.getInstance().execute(task);
	}
}
