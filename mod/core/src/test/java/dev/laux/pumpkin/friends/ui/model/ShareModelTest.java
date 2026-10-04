package dev.laux.pumpkin.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.laux.pumpkin.friends.state.Game;
import dev.laux.pumpkin.friends.state.Join;
import java.util.Optional;
import java.util.OptionalInt;
import org.junit.jupiter.api.Test;

/** Every row of INGAME 6.4 as one case, in the order the table lists them. */
class ShareModelTest {
	private static final Game HOSTABLE = new Game(true, Optional.empty(), OptionalInt.empty(), false);
	private static final Game HOSTABLE_WITH_PORT = new Game(true, Optional.empty(), OptionalInt.of(50123), false);
	private static final Game BELOW_THE_FLOOR = hostableNo(Game.Unhostable.Kind.VERSION_UNSUPPORTED);
	private static final Game NO_MS_ACCOUNT = hostableNo(Game.Unhostable.Kind.MS_ACCOUNT_REQUIRED);
	private static final Game MANIFEST_UNKNOWN_TO_THE_LAUNCHER = hostableNo(Game.Unhostable.Kind.MANIFEST_INVALID);

	@Test
	void aGameThatJoinedAFriendIsJoinedEvenThoughItIsOnAServer() {
		Join joined = new Join("i1", "Sam", Join.Phase.CONNECTED, Optional.of(Join.Path.DIRECT), OptionalInt.of(23));
		assertEquals(ShareModel.State.JOINED, ShareModel.state(new ShareModel.Input(HOSTABLE, true,
			Optional.of(joined), false, false, false)));
	}

	@Test
	void onAServerSharingIsNotPossible() {
		assertEquals(ShareModel.State.ON_SERVER, ShareModel.state(
			input(HOSTABLE, true)));
	}

	@Test
	void aGameThatCannotShareNamesTheReason() {
		assertEquals(ShareModel.State.NOT_HOSTABLE, ShareModel.state(input(BELOW_THE_FLOOR, false)));
		assertEquals(ShareModel.State.NOT_HOSTABLE, ShareModel.state(input(NO_MS_ACCOUNT, false)));
		assertEquals(ShareModel.State.NOT_HOSTABLE, ShareModel.state(input(MANIFEST_UNKNOWN_TO_THE_LAUNCHER, false)));
	}

	@Test
	void withoutAGameTopicNothingIsDecided() {
		assertEquals(ShareModel.State.UNKNOWN, ShareModel.state(input(Game.UNKNOWN, false)));
	}

	@Test
	void aNotHostableWithoutAReasonIsUndecidedToo() {
		assertEquals(ShareModel.State.UNKNOWN, ShareModel.state(
			input(new Game(false, Optional.empty(), OptionalInt.empty(), false), false)));
	}

	@Test
	void anotherGameOfThePlayerSharingWinsOverThisGamesOwnRows() {
		assertEquals(ShareModel.State.SHARED_ELSEWHERE, ShareModel.state(new ShareModel.Input(HOSTABLE, false,
			Optional.empty(), false, false, true)));
	}

	@Test
	void aSessionHereShowsItsGuests() {
		assertEquals(ShareModel.State.SESSION, ShareModel.state(
			input(HOSTABLE_WITH_PORT, false, true)));
	}

	@Test
	void aPublishedWorldWithoutASessionShowsTheVerifiedPort() {
		assertEquals(ShareModel.State.PUBLISHED, ShareModel.state(input(HOSTABLE_WITH_PORT, false)));
	}

	@Test
	void aWorldOpenToLanThatTheLauncherHasNotVerifiedWaits() {
		assertEquals(ShareModel.State.WAITING_FOR_VERIFICATION,
			ShareModel.state(input(HOSTABLE, false, false, true)));
	}

	@Test
	void anUnpublishedSingleplayerWorldCanBeOpened() {
		assertEquals(ShareModel.State.NOT_PUBLISHED, ShareModel.state(input(HOSTABLE, false)));
	}

	private static ShareModel.Input input(Game game, boolean onServer) {
		return input(game, onServer, false, false);
	}

	private static ShareModel.Input input(Game game, boolean onServer, boolean sessionHere) {
		return input(game, onServer, sessionHere, false);
	}

	private static ShareModel.Input input(Game game, boolean onServer, boolean sessionHere, boolean worldOpen) {
		return new ShareModel.Input(game, onServer, Optional.empty(), sessionHere, worldOpen, false);
	}

	private static Game hostableNo(Game.Unhostable.Kind kind) {
		return new Game(false, Optional.of(new Game.Unhostable(kind, Optional.empty())), OptionalInt.empty(), false);
	}
}
