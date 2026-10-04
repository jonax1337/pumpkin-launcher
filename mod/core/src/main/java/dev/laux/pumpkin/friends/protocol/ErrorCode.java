package dev.laux.pumpkin.friends.protocol;

import dev.laux.pumpkin.friends.json.WireNames;

/**
 * Why an operation failed. All but the last two are codes the launcher can answer (INGAME 5.3, 5.4).
 * {@link #DISCONNECTED} is the mod's own answer while the link is down, {@link #UNRECOGNIZED} stands for a code this mod does not know.
 */
public enum ErrorCode {
	NOT_ENABLED,
	PEER_OFFLINE,
	GUEST_LIMIT,
	LAN_PORT_UNKNOWN,
	PORT_NOT_GAME,
	DENIED,
	VERSION_UNSUPPORTED,
	MS_ACCOUNT_REQUIRED,
	BUSY,
	RATE_LIMITED,
	UNSUPPORTED_OP,
	BAD_REQUEST,
	UNKNOWN_FRIEND,
	NOT_FOUND,
	NAME_UNKNOWN,
	DIRECTORY_UNAVAILABLE,
	TIMEOUT,
	INTERNAL,
	DISCONNECTED,
	UNRECOGNIZED;

	public static ErrorCode fromWire(String wire) {
		return WireNames.parse(ErrorCode.class, wire).filter(ErrorCode::travels).orElse(UNRECOGNIZED);
	}

	public String wireName() {
		return WireNames.of(this);
	}

	/** Whether the launcher can send this code. */
	public boolean travels() {
		return this != DISCONNECTED && this != UNRECOGNIZED;
	}
}
