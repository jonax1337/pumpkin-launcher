package dev.laux.pumpkin.friends.bridge;

import dev.laux.pumpkin.friends.protocol.GameInfo;
import dev.laux.pumpkin.friends.runtime.MainThread;

/** What only the platform layer (loader and Minecraft version) can tell the core. */
public interface HostPlatform {
	String modVersion();

	GameInfo game();

	MainThread mainThread();

	/** Announced in {@code hello}; computed from the running jar unless a platform or test knows better. */
	default String buildId() {
		return BuildId.ofOwnJar();
	}
}
