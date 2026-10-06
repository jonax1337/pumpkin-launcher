package dev.laux.pumpkin.bridge.protocol;

import java.util.regex.Pattern;

/** The protocol number and the rule for request ids that both sides share (docs/bridge/README.md, "Protocol 2"). */
public final class Protocol {
	public static final int VERSION = 2;

	private static final Pattern REQUEST_ID = Pattern.compile("[a-z0-9]{1,12}");

	private Protocol() {
	}

	public static boolean isValidRequestId(String id) {
		return REQUEST_ID.matcher(id).matches();
	}
}
