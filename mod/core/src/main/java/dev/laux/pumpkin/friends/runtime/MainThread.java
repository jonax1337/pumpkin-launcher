package dev.laux.pumpkin.friends.runtime;

/** The game's main thread. The platform supplies it ({@code Minecraft.execute}); {@code core/} imports no Minecraft class. */
@FunctionalInterface
public interface MainThread {
	void execute(Runnable task);
}
