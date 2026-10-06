package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import java.util.Objects;

import dev.laux.pumpkin.bridge.modules.friends.state.Game;
import dev.laux.pumpkin.bridge.modules.friends.state.Game.Unhostable;
import dev.laux.pumpkin.bridge.modules.friends.state.Join;
import java.util.Optional;

/**
 * The Teilen tab's state machine (docs/bridge/README.md, "In-game navigation and world behavior"): which of the tab's bodies the current game shows. A pure decision over a
 * snapshot of the topics plus what the compat layer sees of the world; the tab renders the state, this class owns the
 * order of the checks. A game that joined a friend counts as joined before the server check, because such a game is
 * connected to a server and would otherwise hide its own "Verlassen" row.
 */
public final class ShareModel {
	private ShareModel() {
	}

	/** The eight bodies of docs/bridge/README.md, "In-game navigation and world behavior", plus the loading state of a game topic that has not arrived. */
	public enum State {
		/** {@code join.here}: this game is a guest of a friend's world. */
		JOINED,
		/** On a multiplayer server, not as a guest of a friend. */
		ON_SERVER,
		/** The launcher says this game cannot share; the view carries the reason. */
		NOT_HOSTABLE,
		/** No game topic yet (or one without a reason): nothing to decide on. */
		UNKNOWN,
		/** Another game of the player shares right now. */
		SHARED_ELSEWHERE,
		/** This game shares: the session has guests. */
		SESSION,
		/** The LAN world is published and the launcher has verified the port. */
		PUBLISHED,
		/** The world is open to the LAN, but the launcher has not verified the port yet. */
		WAITING_FOR_VERIFICATION,
		/** A singleplayer world that is not published yet. */
		NOT_PUBLISHED
	}

	/**
	 * @param sessionHere       whether the session topic names guests of this game
	 * @param worldOpenToLan    what the compat layer sees: the integrated server has published a port
	 * @param sharedElsewhere   the game topic's word that another game of this launcher holds the shared world
	 */
	public static final class Input {
		private final Game game;
		private final boolean onMultiplayerServer;
		private final Optional<Join> join;
		private final boolean sessionHere;
		private final boolean worldOpenToLan;
		private final boolean sharedElsewhere;

		public Input(Game game, boolean onMultiplayerServer, Optional<Join> join, boolean sessionHere, boolean worldOpenToLan, boolean sharedElsewhere) {
			this.game = game;
			this.onMultiplayerServer = onMultiplayerServer;
			this.join = join;
			this.sessionHere = sessionHere;
			this.worldOpenToLan = worldOpenToLan;
			this.sharedElsewhere = sharedElsewhere;
		}

		public Game game() {
			return game;
		}

		public boolean onMultiplayerServer() {
			return onMultiplayerServer;
		}

		public Optional<Join> join() {
			return join;
		}

		public boolean sessionHere() {
			return sessionHere;
		}

		public boolean worldOpenToLan() {
			return worldOpenToLan;
		}

		public boolean sharedElsewhere() {
			return sharedElsewhere;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Input)) {
				return false;
			}
			Input that = (Input) other;
			return Objects.equals(game, that.game)
				&& onMultiplayerServer == that.onMultiplayerServer
				&& Objects.equals(join, that.join)
				&& sessionHere == that.sessionHere
				&& worldOpenToLan == that.worldOpenToLan
				&& sharedElsewhere == that.sharedElsewhere;
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(game);
			hash = 31 * hash + Boolean.hashCode(onMultiplayerServer);
			hash = 31 * hash + Objects.hashCode(join);
			hash = 31 * hash + Boolean.hashCode(sessionHere);
			hash = 31 * hash + Boolean.hashCode(worldOpenToLan);
			hash = 31 * hash + Boolean.hashCode(sharedElsewhere);
			return hash;
		}

		@Override
		public String toString() {
			return "Input[game=" + game + ", onMultiplayerServer=" + onMultiplayerServer + ", join=" + join + ", sessionHere=" + sessionHere + ", worldOpenToLan=" + worldOpenToLan + ", sharedElsewhere=" + sharedElsewhere + "]";
		}
	}

	public static State state(Input input) {
		if (input.join().isPresent()) {
			return State.JOINED;
		}
		if (input.onMultiplayerServer()) {
			return State.ON_SERVER;
		}
		if (!input.game().hostable()) {
			return explainsWhy(input.game()) ? State.NOT_HOSTABLE : State.UNKNOWN;
		}
		if (input.sharedElsewhere()) {
			return State.SHARED_ELSEWHERE;
		}
		if (input.sessionHere()) {
			return State.SESSION;
		}
		if (input.game().lanPort().isPresent()) {
			return State.PUBLISHED;
		}
		return input.worldOpenToLan() ? State.WAITING_FOR_VERIFICATION : State.NOT_PUBLISHED;
	}

	/** The reason of a hostable "no", when there is one; {@code notReady} and nothing mean the topic is not usable. */
	private static boolean explainsWhy(Game game) {
		return game.reason().map(Unhostable::kind)
			.map(kind -> kind != Unhostable.Kind.NOT_READY)
			.orElse(false);
	}
}
