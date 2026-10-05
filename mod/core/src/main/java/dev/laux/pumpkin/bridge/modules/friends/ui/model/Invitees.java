package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import dev.laux.pumpkin.bridge.modules.friends.state.Friend;
import dev.laux.pumpkin.bridge.modules.friends.state.Session;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The friends the Teilen tab may invite (INGAME 6.4, rows "published, no session" and "session here"): online friends
 * that are not guests of the running session, at most as many as the guest limit leaves open.
 */
public final class Invitees {
	public static final int GUEST_LIMIT = 7;

	private Invitees() {
	}

	public static List<Friend> of(List<Friend> friends, Optional<Session> session) {
		Set<String> guestIds = session.stream().flatMap(current -> current.guests().stream())
			.map(Session.Guest::id).collect(Collectors.toUnmodifiableSet());
		return friends.stream()
			.filter(Friend::isOnline)
			.filter(friend -> !guestIds.contains(friend.id()))
			.limit(Math.max(0, GUEST_LIMIT - guestIds.size()))
			.toList();
	}
}
