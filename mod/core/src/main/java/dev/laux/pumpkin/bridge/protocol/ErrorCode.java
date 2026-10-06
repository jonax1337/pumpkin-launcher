package dev.laux.pumpkin.bridge.protocol;

import dev.laux.pumpkin.bridge.protocol.json.WireNames;

/**
 * Why an operation failed. All but the last two are codes the launcher can answer (docs/bridge/README.md, "Protocol 2").
 * {@link #INSTANCE_MISMATCH} answers {@code invite.joinHere} while the running game does not fit the invite; {@link #FORBIDDEN}
 * answers {@code friend.acknowledge} of a notice only the player may review in the launcher.
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
	INSTANCE_MISMATCH,
	FORBIDDEN,
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
