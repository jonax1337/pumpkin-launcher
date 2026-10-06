package dev.laux.pumpkin.bridge.protocol;

import java.util.Objects;

/** Diagnostics for the {@code hello}; the launcher knows the truth and only logs a mismatch. */
public final class GameInfo {
	private final String minecraft;
	private final String loader;
	private final String loaderVersion;
	private final int java;

	public GameInfo(String minecraft, String loader, String loaderVersion, int java) {
		this.minecraft = minecraft;
		this.loader = loader;
		this.loaderVersion = loaderVersion;
		this.java = java;
	}

	public String minecraft() {
		return minecraft;
	}

	public String loader() {
		return loader;
	}

	public String loaderVersion() {
		return loaderVersion;
	}

	public int java() {
		return java;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof GameInfo)) {
			return false;
		}
		GameInfo that = (GameInfo) other;
		return Objects.equals(minecraft, that.minecraft)
			&& Objects.equals(loader, that.loader)
			&& Objects.equals(loaderVersion, that.loaderVersion)
			&& java == that.java;
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(minecraft);
		hash = 31 * hash + Objects.hashCode(loader);
		hash = 31 * hash + Objects.hashCode(loaderVersion);
		hash = 31 * hash + Integer.hashCode(java);
		return hash;
	}

	@Override
	public String toString() {
		return "GameInfo[minecraft=" + minecraft + ", loader=" + loader + ", loaderVersion=" + loaderVersion + ", java=" + java + "]";
	}
}
