package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import java.util.Objects;
import dev.laux.pumpkin.bridge.runtime.Immutable;

import dev.laux.pumpkin.bridge.protocol.json.WireNames;
import dev.laux.pumpkin.bridge.protocol.ErrorCode;
import dev.laux.pumpkin.bridge.protocol.OpError;
import java.util.List;

/**
 * Why {@code friend.addByName} failed, as the inline line under the field (docs/bridge/README.md, "In-game navigation and world behavior", BYNAME 9.6): the launcher answers
 * with coarse codes whose exact cause travels in {@code reason} (launcher-side {@code mod_error} translation), and this
 * maps the five cases the tab has its own text for. {@code nameNotFindable} is a hint, not an error: the person exists
 * but is not findable by name. Everything else keeps the generic text of its code. The typed name never travels back
 * from the launcher; the line shows the name the player typed.
 */
public final class AddFriendFailure {
	private final String key;
	private final List<String> arguments;
	private final boolean hint;

	public AddFriendFailure(String key, List<String> arguments, boolean hint) {
		arguments = Immutable.copyList(arguments);
		this.key = key;
		this.arguments = arguments;
		this.hint = hint;
	}

	public String key() {
		return key;
	}

	public List<String> arguments() {
		return arguments;
	}

	public boolean hint() {
		return hint;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof AddFriendFailure)) {
			return false;
		}
		AddFriendFailure that = (AddFriendFailure) other;
		return Objects.equals(key, that.key)
			&& Objects.equals(arguments, that.arguments)
			&& hint == that.hint;
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(key);
		hash = 31 * hash + Objects.hashCode(arguments);
		hash = 31 * hash + Boolean.hashCode(hint);
		return hash;
	}

	@Override
	public String toString() {
		return "AddFriendFailure[key=" + key + ", arguments=" + arguments + ", hint=" + hint + "]";
	}

	/** The cooldown of BYNAME 9.3, {@code NAME_COOLDOWN_DAYS}; the launcher sends the same number as {@code days}. */
	private static final int NAME_COOLDOWN_DAYS = 7;


	public static AddFriendFailure of(OpError error, String typedName) {
		String reason = error.reason().orElse("");
		if (error.code() == ErrorCode.NAME_UNKNOWN) {
			return reason.equals("nameNotFindable")
				? new AddFriendFailure("pumpkin_bridge.add.error.nameNotFindable", Immutable.list(typedName), true)
				: new AddFriendFailure("pumpkin_bridge.add.error.nameUnknown", Immutable.list(typedName), false);
		}
		if (error.code() == ErrorCode.DIRECTORY_UNAVAILABLE) {
			return reason.equals("directoryNotAllowed")
				? new AddFriendFailure("pumpkin_bridge.add.error.directoryNotAllowed", Immutable.list(), false)
				: new AddFriendFailure("pumpkin_bridge.add.error.directoryUnavailable", Immutable.list(), false);
		}
		if (error.code() == ErrorCode.RATE_LIMITED) {
			return reason.equals("nameCooldown")
				? new AddFriendFailure("pumpkin_bridge.add.error.nameCooldown", Immutable.list(typedName, days(error)), false)
				: genericFailure(ErrorCode.RATE_LIMITED);
		}
		if (error.code() == ErrorCode.BAD_REQUEST && reason.equals("nameInvalid")) {
			return new AddFriendFailure("pumpkin_bridge.add.error.nameInvalid", Immutable.list(), false);
		}
		return genericFailure(error.code());
	}

	private static String days(OpError error) {
		return Integer.toString(error.intParam("days").orElse(NAME_COOLDOWN_DAYS));
	}

	/** The generic text of a code, as the toast path uses it; an unknown code reads like an internal one. */
	private static AddFriendFailure genericFailure(ErrorCode code) {
		ErrorCode known = code == ErrorCode.UNRECOGNIZED ? ErrorCode.INTERNAL : code;
		return new AddFriendFailure("pumpkin_bridge.error." + WireNames.of(known), Immutable.list(), false);
	}
}
