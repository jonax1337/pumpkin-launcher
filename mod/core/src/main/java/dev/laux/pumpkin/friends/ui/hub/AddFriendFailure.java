package dev.laux.pumpkin.friends.ui.hub;

import dev.laux.pumpkin.friends.json.WireNames;
import dev.laux.pumpkin.friends.protocol.ErrorCode;
import dev.laux.pumpkin.friends.protocol.OpError;
import java.util.List;

/**
 * Why {@code friend.addByName} failed, as the inline line under the field (INGAME 6.2, BYNAME 9.6): the launcher answers
 * with coarse codes whose exact cause travels in {@code reason} (launcher-side {@code mod_error} translation), and this
 * maps the five cases the tab has its own text for. {@code nameNotFindable} is a hint, not an error: the person exists
 * but is not findable by name. Everything else keeps the generic text of its code. The typed name never travels back
 * from the launcher; the line shows the name the player typed.
 */
public record AddFriendFailure(String key, List<String> arguments, boolean hint) {
	/** The cooldown of BYNAME 9.3, {@code NAME_COOLDOWN_DAYS}; the launcher sends the same number as {@code days}. */
	private static final int NAME_COOLDOWN_DAYS = 7;

	public AddFriendFailure {
		arguments = List.copyOf(arguments);
	}

	public static AddFriendFailure of(OpError error, String typedName) {
		String reason = error.reason().orElse("");
		if (error.code() == ErrorCode.NAME_UNKNOWN) {
			return reason.equals("nameNotFindable")
				? new AddFriendFailure("pumpkin_friends.add.error.nameNotFindable", List.of(typedName), true)
				: new AddFriendFailure("pumpkin_friends.add.error.nameUnknown", List.of(typedName), false);
		}
		if (error.code() == ErrorCode.DIRECTORY_UNAVAILABLE) {
			return reason.equals("directoryNotAllowed")
				? new AddFriendFailure("pumpkin_friends.add.error.directoryNotAllowed", List.of(), false)
				: new AddFriendFailure("pumpkin_friends.add.error.directoryUnavailable", List.of(), false);
		}
		if (error.code() == ErrorCode.RATE_LIMITED) {
			return reason.equals("nameCooldown")
				? new AddFriendFailure("pumpkin_friends.add.error.nameCooldown", List.of(typedName, days(error)), false)
				: genericFailure(ErrorCode.RATE_LIMITED);
		}
		if (error.code() == ErrorCode.BAD_REQUEST && reason.equals("nameInvalid")) {
			return new AddFriendFailure("pumpkin_friends.add.error.nameInvalid", List.of(), false);
		}
		return genericFailure(error.code());
	}

	private static String days(OpError error) {
		return Integer.toString(error.intParam("days").orElse(NAME_COOLDOWN_DAYS));
	}

	/** The generic text of a code, as the toast path uses it; an unknown code reads like an internal one. */
	private static AddFriendFailure genericFailure(ErrorCode code) {
		ErrorCode known = code == ErrorCode.UNRECOGNIZED ? ErrorCode.INTERNAL : code;
		return new AddFriendFailure("pumpkin_friends.error." + WireNames.of(known), List.of(), false);
	}
}
