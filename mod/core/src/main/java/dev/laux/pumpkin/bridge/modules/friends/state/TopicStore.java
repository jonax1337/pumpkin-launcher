package dev.laux.pumpkin.bridge.modules.friends.state;

import dev.laux.pumpkin.bridge.runtime.Immutable;

import dev.laux.pumpkin.bridge.protocol.json.MalformedJson;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.State;
import dev.laux.pumpkin.bridge.protocol.Topic;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.LongSupplier;
import org.apache.logging.log4j.Logger;
import org.apache.logging.log4j.LogManager;

/**
 * The last value of every topic (docs/bridge/README.md, "Protocol 2"). The launcher pushes whole values with a revision per topic; a value replaces
 * the copy here and is never patched, and a revision that is not newer than the one held is ignored. Everything here
 * runs on the main thread, so readers need no locking.
 */
public final class TopicStore {
	private static final Logger LOG = LogManager.getLogger("pumpkin_bridge");

	private final Map<Topic, Long> revisions = new EnumMap<>(Topic.class);
	private final List<Listener> listeners = new CopyOnWriteArrayList<>();
	/** Wall clock the "Jetzt zustellen" cooldown counts on; tests replace it. */
	private final LongSupplier wallClock;
	private long deliverReadyAtMillis = Long.MIN_VALUE;
	private Optional<Me> me = Optional.empty();
	private List<Friend> friends = Immutable.list();
	private Requests requests = Requests.NONE;
	private List<Invite> invites = Immutable.list();
	private Optional<Session> session = Optional.empty();
	private Optional<Join> join = Optional.empty();
	private Game game = Game.UNKNOWN;
	private List<Code> codes = Immutable.list();
	private List<Blocked> blocked = Immutable.list();

	/** Told on the main thread after a topic changed. */
	@FunctionalInterface
	public interface Listener {
		void changed(Topic topic);
	}

	public void addListener(Listener listener) {
		listeners.add(listener);
	}

	public TopicStore() {
		this(System::currentTimeMillis);
	}

	TopicStore(LongSupplier wallClock) {
		this.wallClock = wallClock;
	}

	/** Whether the launcher has pushed this topic since the link came up; false again after {@link #clear()}. */
	public boolean received(Topic topic) {
		return revisions.containsKey(topic);
	}

	/**
	 * The remaining milliseconds of the launcher's "Jetzt zustellen" cooldown at the given time, from the last taken
	 * requests push; zero when pressing again may act now (the launcher re-pushes the value about once a second while
	 * it counts down).
	 */
	public long retryCooldownMillis(long nowMillis) {
		return Math.max(0, deliverReadyAtMillis - nowMillis);
	}

	public Optional<Me> me() {
		return me;
	}

	public List<Friend> friends() {
		return friends;
	}

	public Requests requests() {
		return requests;
	}

	public List<Invite> invites() {
		return invites;
	}

	public Optional<Session> session() {
		return session;
	}

	public Optional<Join> join() {
		return join;
	}

	public Game game() {
		return game;
	}

	public List<Code> codes() {
		return codes;
	}

	public List<Blocked> blocked() {
		return blocked;
	}

	public Optional<Friend> friendNamed(String name) {
		return friends.stream().filter(friend -> friend.name().equals(name)).findFirst();
	}

	/** Takes the pushed value unless its revision is stale or duplicate, or the value is malformed. Returns whether it was taken. */
	public boolean apply(State push) {
		Topic topic = push.topic();
		if (revisions.containsKey(topic) && push.rev() <= revisions.get(topic)) {
			return false;
		}
		try {
			replace(push);
		} catch (MalformedJson malformed) {
			LOG.debug("Pumpkin Bridge: ignoring malformed {} value: {}", topic, malformed.getMessage());
			return false;
		}
		if (topic == Topic.REQUESTS) {
			deliverReadyAtMillis = wallClock.getAsLong() + requests.retryCooldownMillis();
		}
		revisions.put(topic, push.rev());
		listeners.forEach(listener -> listener.changed(topic));
		return true;
	}

	/** Forgets everything, including the revisions: after a lost link the launcher starts over with its full state. */
	public void clear() {
		List<Topic> held = Immutable.copyList(revisions.keySet());
		revisions.clear();
		deliverReadyAtMillis = Long.MIN_VALUE;
		me = Optional.empty();
		friends = Immutable.list();
		requests = Requests.NONE;
		invites = Immutable.list();
		session = Optional.empty();
		join = Optional.empty();
		game = Game.UNKNOWN;
		codes = Immutable.list();
		blocked = Immutable.list();
		held.forEach(topic -> listeners.forEach(listener -> listener.changed(topic)));
	}

	private void replace(State push) {
		switch (push.topic()) {
			case ME:
				me = Optional.of(TopicParser.me(push.value()));
				break;
			case FRIENDS:
				friends = TopicParser.friends(push.value());
				break;
			case REQUESTS:
				requests = TopicParser.requests(push.value());
				break;
			case INVITES:
				invites = TopicParser.invites(push.value());
				break;
			case SESSION:
				session = TopicParser.session(push.value());
				break;
			case JOIN:
				join = TopicParser.join(push.value());
				break;
			case GAME:
				game = TopicParser.game(push.value());
				break;
			case CODES:
				codes = TopicParser.codes(push.value());
				break;
			case BLOCKED:
				blocked = TopicParser.blocked(push.value());
				break;
		}
	}
}
