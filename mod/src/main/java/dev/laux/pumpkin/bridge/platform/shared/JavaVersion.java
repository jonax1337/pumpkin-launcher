package dev.laux.pumpkin.bridge.platform.shared;

public final class JavaVersion {
	private JavaVersion() {
	}

	public static int current() {
		String version = System.getProperty("java.specification.version");
		return Integer.parseInt(version.startsWith("1.") ? version.substring(2) : version);
	}
}
