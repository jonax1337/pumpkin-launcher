package dev.laux.pumpkin.friends.ui.model;

import java.util.regex.Pattern;

/**
 * Decides whether a host string is a literal IPv4 loopback address ({@code 127.0.0.0/8}). The mod connects only to such
 * an address (INGAME 7) and never resolves a name, so a name like {@code localhost} is not accepted.
 */
public final class LoopbackAddress {
	private static final Pattern DOTTED_QUAD = Pattern.compile("127\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})");
	private static final int MAX_OCTET = 255;

	private LoopbackAddress() {
	}

	public static boolean isLiteral(String host) {
		var quad = DOTTED_QUAD.matcher(host);
		return quad.matches() && octetFits(quad.group(1)) && octetFits(quad.group(2)) && octetFits(quad.group(3));
	}

	private static boolean octetFits(String octet) {
		return Integer.parseInt(octet) <= MAX_OCTET;
	}
}
