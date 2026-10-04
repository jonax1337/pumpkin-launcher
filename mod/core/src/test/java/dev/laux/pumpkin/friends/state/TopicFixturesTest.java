package dev.laux.pumpkin.friends.state;

import static dev.laux.pumpkin.friends.Fixtures.Direction.LAUNCHER_TO_MOD;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.laux.pumpkin.friends.Fixtures;
import dev.laux.pumpkin.friends.Fixtures.Line;
import dev.laux.pumpkin.friends.protocol.FrameCodec;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.State;
import dev.laux.pumpkin.friends.protocol.Topic;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;
import org.junit.jupiter.api.Test;

/** topics.jsonl: a push for every topic, replayed in file order into a {@link TopicStore}. */
class TopicFixturesTest {
	private static final List<State> PUSHES = Fixtures.read("topics.jsonl", LAUNCHER_TO_MOD).stream()
		.map(Line::wire).map(wire -> (State) FrameCodec.decode(wire).orElseThrow()).toList();

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

		assertEquals(Optional.of(new Me(true, Me.Availability.AVAILABLE, Me.Network.ONLINE, Optional.of("ab12 cd34"))), store.me());
	}

	@Test
	void friendsAreAddressedByAliasAndKeepTheirUuidOnlyWhenKnown() {
		replay(Topic.FRIENDS);

		assertEquals(List.of(
			new Friend("f1", "Alex", Optional.empty(), Friend.Presence.PLAYING),
			new Friend("f2", "Bea", Optional.of("069a79f444e94726a5befca90e38aaf5"), Friend.Presence.OFFLINE)), store.friends());
	}

	@Test
	void requestsKeepBothDirections() {
		replay(Topic.REQUESTS);

		assertEquals(new Requests(
			List.of(new Requests.Incoming("r1", "Sam", Optional.of("Sam_MC"), "ab12 cd34")),
			List.of(new Requests.Outgoing("r2", Optional.empty(), Requests.State.DELIVERING))), store.requests());
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
			OptionalInt.of(50123)), store.game());

		replay(Topic.GAME);
		assertEquals(new Game(true, Optional.empty(), OptionalInt.empty()), store.game());
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
