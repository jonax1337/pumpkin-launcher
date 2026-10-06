package dev.laux.pumpkin.bridge.modules.friends.state;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonParser;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.State;
import dev.laux.pumpkin.bridge.protocol.Topic;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class TopicStoreTest {
	private static final String ONE_FRIEND = "[{\"id\":\"f1\",\"name\":\"Alex\",\"mcUuid\":null,\"presence\":\"online\"}]";
	private static final String OTHER_FRIEND = "[{\"id\":\"f9\",\"name\":\"Zoe\",\"mcUuid\":null,\"presence\":\"offline\"}]";
	private static final String ME_ONLINE = "{\"enabled\":true,\"availability\":\"available\",\"network\":\"online\","
		+ "\"fingerprint\":null,\"directory\":\"active\",\"displayName\":\"Anna\",\"findableByName\":false,\"relayHost\":null}";

	/** Eine Uhr, die nur der Test bewegt: die Frist des Liefer-Buttons zählt an ihr. */
	private static final class SetClock {
		private long millis;

		long millis() {
			return millis;
		}
	}

	private final SetClock clock = new SetClock();
	private final TopicStore store = new TopicStore(clock::millis);
	private final List<Topic> changed = new ArrayList<>();

	TopicStoreTest() {
		store.addListener(changed::add);
	}

	@Test
	void aNewerRevisionReplacesTheWholeValue() {
		push(Topic.FRIENDS, 1, ONE_FRIEND);

		assertTrue(push(Topic.FRIENDS, 2, OTHER_FRIEND));

		assertEquals(List.of("f9"), ids(store.friends()));
	}

	@Test
	void aDuplicateRevisionIsIgnored() {
		push(Topic.FRIENDS, 5, ONE_FRIEND);

		assertFalse(push(Topic.FRIENDS, 5, OTHER_FRIEND));

		assertEquals(List.of("f1"), ids(store.friends()));
		assertEquals(List.of(Topic.FRIENDS), changed);
	}

	@Test
	void aStaleRevisionIsIgnored() {
		push(Topic.FRIENDS, 5, ONE_FRIEND);

		assertFalse(push(Topic.FRIENDS, 4, OTHER_FRIEND));

		assertEquals(List.of("f1"), ids(store.friends()));
	}

	@Test
	void everyTopicCountsItsOwnRevisions() {
		push(Topic.FRIENDS, 7, ONE_FRIEND);

		assertTrue(push(Topic.INVITES, 1, "[]"));
	}

	@Test
	void theFirstPushOfATopicIsTakenWhateverItsRevision() {
		assertTrue(push(Topic.FRIENDS, 41, ONE_FRIEND));
	}

	@Test
	void listenersHearOfEveryTakenValueAndOfNothingElse() {
		push(Topic.FRIENDS, 1, ONE_FRIEND);
		push(Topic.FRIENDS, 1, ONE_FRIEND);
		push(Topic.INVITES, 1, "[]");

		assertEquals(List.of(Topic.FRIENDS, Topic.INVITES), changed);
	}

	@Test
	void aMalformedValueLeavesTheOldValueAndTheOldRevision() {
		push(Topic.FRIENDS, 1, ONE_FRIEND);

		assertFalse(push(Topic.FRIENDS, 2, "{\"not\":\"a list\"}"));
		assertFalse(push(Topic.FRIENDS, 3, "[{\"id\":\"f2\",\"name\":\"Bea\",\"presence\":\"asleep\"}]"));

		assertEquals(List.of("f1"), ids(store.friends()));
		assertTrue(push(Topic.FRIENDS, 2, OTHER_FRIEND), "revision 2 was never taken, so it still counts as new");
	}

	@Test
	void playerControlledTextIsSanitisedBeforeAnyoneSeesIt() {
		push(Topic.FRIENDS, 1, "[{\"id\":\"f1\",\"name\":\"\u00a7cAl\u202eex\",\"mcUuid\":\"NOT-A-UUID\",\"presence\":\"online\"}]");
		push(Topic.INVITES, 1, "[{\"id\":\"i1\",\"fromName\":\"" + "B".repeat(40) + "\",\"title\":\"" + "T".repeat(80) + "\"}]");

		assertEquals(new Friend("f1", "cAlex", Optional.empty(), Friend.Presence.ONLINE, Optional.empty()), store.friends().get(0));
		assertEquals(new Invite("i1", "B".repeat(Sanitize.NAME_MAX_CHARS), "T".repeat(Sanitize.TITLE_MAX_CHARS)), store.invites().get(0));
	}

	@Test
	void friendsCanBeFoundByTheirSanitisedName() {
		push(Topic.FRIENDS, 1, ONE_FRIEND);

		assertEquals("f1", store.friendNamed("Alex").orElseThrow().id());
		assertTrue(store.friendNamed("Nobody").isEmpty());
	}

	@Test
	void anIdThatCouldNotBeAnAliasMakesTheValueMalformed() {
		assertFalse(push(Topic.FRIENDS, 1, "[{\"id\":\"\",\"name\":\"Alex\",\"presence\":\"online\"}]"));
		assertFalse(push(Topic.FRIENDS, 2, "[{\"id\":\"" + "x".repeat(65) + "\",\"name\":\"Alex\",\"presence\":\"online\"}]"));
	}

	@Test
	void clearingForgetsValuesAndRevisionsSoAReconnectStartsFresh() {
		push(Topic.FRIENDS, 9, ONE_FRIEND);
		push(Topic.GAME, 4, "{\"hostable\":true,\"reason\":null,\"lan\":null,\"sharedElsewhere\":false}");
		changed.clear();

		store.clear();

		assertEquals(List.of(), store.friends());
		assertEquals(Game.UNKNOWN, store.game());
		assertTrue(changed.containsAll(List.of(Topic.FRIENDS, Topic.GAME)) && changed.size() == 2);
		assertTrue(push(Topic.FRIENDS, 1, ONE_FRIEND), "revision 1 is new again after a clear");
	}

	@Test
	void receivedNamesTheTopicsWhoseFirstPushArrivedAndClearResetsThem() {
		assertFalse(store.received(Topic.ME));
		assertFalse(store.received(Topic.GAME), "das Spiel-Thema hat einen Platzhalter, aber noch keinen Schub");

		push(Topic.ME, 1, ME_ONLINE);
		push(Topic.GAME, 1, "{\"hostable\":true,\"reason\":null,\"lan\":null,\"sharedElsewhere\":false}");

		assertTrue(store.received(Topic.ME));
		assertTrue(store.received(Topic.GAME));
		assertFalse(store.received(Topic.FRIENDS), "ein Thema ohne Schub bleibt unerwartet");

		store.clear();

		assertFalse(store.received(Topic.ME), "nach dem Verlust der Verbindung zählt der erste Schub neu");
	}

	@Test
	void theRetryCooldownCountsDownFromThePushAndZeroMeansReady() {
		push(Topic.REQUESTS, 1, "{\"incoming\":[],\"outgoing\":[],\"retryCooldownMs\":42000}");

		assertEquals(42_000, store.retryCooldownMillis(clock.millis()));
		assertEquals(41_000, store.retryCooldownMillis(clock.millis() + 1_000));
		assertEquals(0, store.retryCooldownMillis(clock.millis() + 42_000), "abgelaufen bleibt null");
		assertEquals(0, store.retryCooldownMillis(clock.millis() + 60_000));

		push(Topic.REQUESTS, 2, "{\"incoming\":[],\"outgoing\":[],\"retryCooldownMs\":0}");
		assertEquals(0, store.retryCooldownMillis(clock.millis()), "ein neuer Schub ersetzt die Frist");
	}

	@Test
	void clearingDropsTheRetryCooldownUntilTheNextPush() {
		push(Topic.REQUESTS, 1, "{\"incoming\":[],\"outgoing\":[],\"retryCooldownMs\":42000}");

		store.clear();

		assertEquals(0, store.retryCooldownMillis(clock.millis()));
	}

	private boolean push(Topic topic, long revision, String json) {
		return store.apply(new State(topic, revision, new JsonParser().parse(json)));
	}

	private static List<String> ids(List<Friend> friends) {
		return friends.stream().map(Friend::id).toList();
	}
}
