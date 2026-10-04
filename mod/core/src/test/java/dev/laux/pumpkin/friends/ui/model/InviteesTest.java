package dev.laux.pumpkin.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.laux.pumpkin.friends.state.Friend;
import dev.laux.pumpkin.friends.state.Session;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

/** Who the Teilen tab may invite: online friends that are not guests, as many as the guest limit leaves open. */
class InviteesTest {
	@Test
	void onlyOnlineFriendsThatAreNotGuests() {
		List<Friend> friends = List.of(online("f1", "Alex"), offline("f2", "Bea"), online("f3", "Cleo"));
		Session session = new Session(List.of(new Session.Guest("f1", "Alex", Session.State.CONNECTED)));

		assertEquals(List.of("Cleo"), names(Invitees.of(friends, Optional.of(session))));
	}

	@Test
	void withoutASessionEveryOnlineFriendIsInvitable() {
		List<Friend> friends = List.of(online("f1", "Alex"), offline("f2", "Bea"));

		assertEquals(List.of("Alex"), names(Invitees.of(friends, Optional.empty())));
	}

	@Test
	void atMostSevenGuestsInTotal() {
		assertEquals(Invitees.GUEST_LIMIT, Invitees.of(nineOnlineFriends(), Optional.empty()).size());
	}

	@Test
	void aFullSessionLeavesNothingToInvite() {
		Session full = new Session(IntStream.rangeClosed(1, Invitees.GUEST_LIMIT)
			.mapToObj(InviteesTest::invited).toList());

		assertEquals(List.of(), names(Invitees.of(nineOnlineFriends(), Optional.of(full))));
	}

	private static List<Friend> nineOnlineFriends() {
		List<Friend> friends = new ArrayList<>();
		for (int number = 1; number <= 9; number++) {
			friends.add(online("f" + number, "Friend " + number));
		}
		return friends;
	}

	private static Session.Guest invited(int number) {
		return new Session.Guest("f" + number, "Friend " + number, Session.State.INVITED);
	}

	private static List<String> names(List<Friend> friends) {
		return friends.stream().map(Friend::name).toList();
	}

	private static Friend online(String id, String name) {
		return new Friend(id, name, Optional.empty(), Friend.Presence.ONLINE, Optional.empty());
	}

	private static Friend offline(String id, String name) {
		return new Friend(id, name, Optional.empty(), Friend.Presence.OFFLINE, Optional.empty());
	}
}
