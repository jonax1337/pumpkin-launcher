package dev.laux.pumpkin.bridge.modules.friends.state;

import static dev.laux.pumpkin.bridge.Fixtures.Direction.LAUNCHER_TO_MOD;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.laux.pumpkin.bridge.Fixtures;
import dev.laux.pumpkin.bridge.Fixtures.Line;
import dev.laux.pumpkin.bridge.protocol.FrameCodec;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.State;
import dev.laux.pumpkin.bridge.protocol.Topic;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;
import org.junit.jupiter.api.Test;

/** topics.jsonl: a push for every topic, replayed in file order into a {@link TopicStore}. */
class TopicFixturesTest {
	private static final List<State> PUSHES = Fixtures.read("topics.jsonl", LAUNCHER_TO_MOD).stream()
		.map(Line::wire).map(wire -> (State) FrameCodec.decode(wire).orElseThrow()).toList();

	// Spelled as numbers so that the source file holds no invisible characters.
	private static final String SECTION_SIGN = String.valueOf((char) 0x00A7);
	private static final String RIGHT_TO_LEFT_OVERRIDE = String.valueOf((char) 0x202E);

	private final TopicStore store = new TopicStore();

	@Test
	void everyTopicIsPushedByTheFixture() {
		assertEquals(List.of(Topic.values()).size(), PUSHES.stream().map(State::topic).distinct().count());
	}

	@Test
	void everyPushIsTaken() {
		PUSHES.forEach(push -> assertTrue(store.apply(push), push.topic() + " rev " + push.rev()));
	}

	@Test
	void meKeepsTheIdentityLine() {
		replay(Topic.ME);

		assertEquals(Optional.of(new Me(true, Me.Availability.AVAILABLE, Me.Network.ONLINE, Optional.of("ab12 cd34"),
			Me.Directory.ACTIVE, "Anna", true, Optional.of("relay-eu1.example.org"))), store.me());
	}

	@Test
	void meMirrorsEveryStateOfTheNameDirectory() {
		List<State> pushes = Fixtures.read("topics-me-directory.jsonl", LAUNCHER_TO_MOD).stream()
			.map(Line::wire).map(wire -> (State) FrameCodec.decode(wire).orElseThrow()).toList();

		List<Me.Directory> shown = pushes.stream().map(push -> {
			assertTrue(store.apply(push), "rev " + push.rev());
			return store.me().orElseThrow().directory();
		}).toList();

		assertEquals(List.of(Me.Directory.values()), shown);
	}

	@Test
	void aDirectoryStateTheModDoesNotKnowMakesTheMeValueMalformed() {
		State unknown = (State) FrameCodec.decode("{\"type\":\"state\",\"topic\":\"me\",\"rev\":1,\"value\":{\"enabled\":true,"
			+ "\"availability\":\"available\",\"network\":\"online\",\"fingerprint\":null,\"directory\":\"sleeping\"}}").orElseThrow();

		assertFalse(store.apply(unknown));
		assertEquals(Optional.empty(), store.me());
	}

	@Test
	void friendsAreAddressedByAliasAndKeepTheirUuidOnlyWhenKnown() {
		replay(Topic.FRIENDS);

		assertEquals(List.of(
			new Friend("f1", "Alex", Optional.empty(), Friend.Presence.PLAYING, Optional.empty()),
			new Friend("f2", "Bea", Optional.of("069a79f444e94726a5befca90e38aaf5"), Friend.Presence.OFFLINE, Optional.empty())),
			store.friends());
	}

	@Test
	void aFriendKeepsARenamedOrAnIdentityChangedNoticeAndOtherFriendsHaveNone() {
		Fixtures.read("topics-notice.jsonl", LAUNCHER_TO_MOD).stream().map(Line::wire)
			.map(wire -> (State) FrameCodec.decode(wire).orElseThrow()).forEach(store::apply);

		List<Optional<FriendNotice>> notices = store.friends().stream().map(Friend::notice).toList();

		assertEquals(List.of(Optional.of(new FriendNotice.Renamed("Alt")), Optional.of(new FriendNotice.IdentityChanged()),
			Optional.empty()), notices);
	}

	@Test
	void theNameBeforeARenameIsSanitisedLikeEveryOtherName() {
		store.apply(friendsPush("[{\"id\":\"f1\",\"name\":\"Alex\",\"mcUuid\":null,\"presence\":\"online\","
			+ "\"notice\":{\"type\":\"renamed\",\"previousName\":\"" + SECTION_SIGN + "cAl" + RIGHT_TO_LEFT_OVERRIDE + "ex\"}}]"));

		assertEquals(Optional.of(new FriendNotice.Renamed("cAlex")), store.friends().get(0).notice());
	}

	@Test
	void aNoticeOfAnewerLauncherIsLeftOutAndTheFriendStays() {
		store.apply(friendsPush("[{\"id\":\"f1\",\"name\":\"Alex\",\"mcUuid\":null,\"presence\":\"online\","
			+ "\"notice\":{\"type\":\"addedInGame\"}}]"));

		assertEquals(List.of("f1"), store.friends().stream().map(Friend::id).toList());
		assertEquals(Optional.empty(), store.friends().get(0).notice());
	}

	private static State friendsPush(String friendsJson) {
		return (State) FrameCodec.decode("{\"type\":\"state\",\"topic\":\"friends\",\"rev\":1,\"value\":" + friendsJson + "}").orElseThrow();
	}

	@Test
	void requestsKeepBothDirections() {
		replay(Topic.REQUESTS);

		assertEquals(new Requests(
			List.of(new Requests.Incoming("r1", "Sam", Optional.of("Sam_MC"), "ab12 cd34")),
			List.of(new Requests.Outgoing("r2", Optional.empty(), Requests.State.DELIVERING)), 42_000), store.requests());
	}

	@Test
	void invitesKeepSenderAndTitle() {
		replay(Topic.INVITES);

		assertEquals(List.of(new Invite("i1", "Sam", "Insel")), store.invites());
	}

	@Test
	void sessionHoldsGuestsUntilALaterPushSaysNothingIsShared() {
		replayFirstOf(Topic.SESSION);
		assertEquals(Optional.of(new Session(List.of(new Session.Guest("f1", "Alex", Session.State.CONNECTED)))), store.session());

		replay(Topic.SESSION);
		assertEquals(Optional.empty(), store.session());
	}

	@Test
	void joinHoldsTheForeignWorldUntilALaterPushSaysItIsLeft() {
		replayFirstOf(Topic.JOIN);
		assertEquals(Optional.of(new Join("i1", "Sam", Join.Phase.CONNECTED, Optional.of(Join.Path.DIRECT), OptionalInt.of(23))),
			store.join());

		replay(Topic.JOIN);
		assertEquals(Optional.empty(), store.join());
	}

	@Test
	void gameReportsWhyTheWorldCannotBeSharedAndTheVerifiedLanPort() {
		replayFirstOf(Topic.GAME);
		assertEquals(new Game(false, Optional.of(new Game.Unhostable(Game.Unhostable.Kind.VERSION_UNSUPPORTED, Optional.of("1.20"))),
			OptionalInt.of(50123), false), store.game());

		replay(Topic.GAME);
		assertEquals(new Game(true, Optional.empty(), OptionalInt.empty(), true), store.game(),
				"der zweite Druck zeigt die Welt eines anderen Spiels des gleichen Launchers");
	}

	@Test
	void codesKeepOnlyTheTailOfTheCode() {
		replay(Topic.CODES);

		assertEquals(List.of(new Code("c1", "x7q2", 1_790_000_000L, false)), store.codes());
	}

	@Test
	void blockedPeopleAreAddressedByAlias() {
		replay(Topic.BLOCKED);

		assertEquals(List.of(new Blocked("f3", "Troll")), store.blocked());
	}

	private void replay(Topic topic) {
		PUSHES.stream().filter(push -> push.topic() == topic).forEach(store::apply);
	}

	private void replayFirstOf(Topic topic) {
		store.apply(PUSHES.stream().filter(push -> push.topic() == topic).findFirst().orElseThrow());
	}
}
