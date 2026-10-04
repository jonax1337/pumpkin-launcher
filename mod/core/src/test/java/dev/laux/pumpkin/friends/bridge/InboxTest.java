package dev.laux.pumpkin.friends.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonParser;
import dev.laux.pumpkin.friends.FakeClock;
import dev.laux.pumpkin.friends.ManualMainThread;
import dev.laux.pumpkin.friends.protocol.ClosingReason;
import dev.laux.pumpkin.friends.protocol.FrameCodec;
import dev.laux.pumpkin.friends.protocol.LauncherFrame;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Closing;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Notify;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.State;
import dev.laux.pumpkin.friends.protocol.ModFrame;
import dev.laux.pumpkin.friends.protocol.NotifyKind;
import dev.laux.pumpkin.friends.protocol.ScopeState;
import dev.laux.pumpkin.friends.protocol.Scopes;
import dev.laux.pumpkin.friends.protocol.Topic;
import dev.laux.pumpkin.friends.request.Ops;
import dev.laux.pumpkin.friends.request.Reply;
import dev.laux.pumpkin.friends.request.Request;
import dev.laux.pumpkin.friends.request.RequestManager;
import dev.laux.pumpkin.friends.request.RequestManager.Delivery;
import dev.laux.pumpkin.friends.request.Results.Done;
import dev.laux.pumpkin.friends.state.TopicStore;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The hand-over to the main thread: ordering, sanitising, and listeners that misbehave. */
class InboxTest {
	// Spelled as numbers so that the source file holds no invisible characters.
	private static final String SECTION_SIGN = String.valueOf((char) 0x00A7);
	private static final String ZERO_WIDTH_SPACE = String.valueOf((char) 0x200B);
	private static final String RIGHT_TO_LEFT_OVERRIDE = String.valueOf((char) 0x202E);

	private final ManualMainThread mainThread = new ManualMainThread();
	private final List<String> sentIds = new ArrayList<>();
	private final RequestManager requests = new RequestManager(mainThread, new FakeClock(), frame -> {
		sentIds.add(((ModFrame.Req) frame).id());
		return Delivery.QUEUED;
	});
	private final TopicStore topics = new TopicStore();
	private final List<ClosingReason> closedForGood = new ArrayList<>();
	private final Inbox inbox = new Inbox(requests, topics, mainThread, closedForGood::add);
	private final List<String> heard = new ArrayList<>();

	@Test
	void topicsReachTheStoreOnlyOnTheMainThreadAndInArrivalOrder() {
		inbox.deliver(state(Topic.FRIENDS, 1, "[]"));
		inbox.deliver(state(Topic.INVITES, 1, "[{\"id\":\"i1\",\"fromName\":\"Sam\",\"title\":\"Insel\"}]"));
		assertTrue(topics.invites().isEmpty(), "nothing before the main thread runs");
		topics.addListener(topic -> heard.add(topic.name()));

		mainThread.runPending();

		assertEquals(List.of("FRIENDS", "INVITES"), heard);
		assertEquals("Sam", topics.invites().get(0).fromName());
	}

	@Test
	void aNoticeKeepsItsKindAndASanitisedName() {
		inbox.addListener(recorder());

		inbox.deliver(new Notify(NotifyKind.GUEST_JOINED, Optional.of(SECTION_SIGN + "cAl" + ZERO_WIDTH_SPACE + "ex")));
		inbox.deliver(new Notify(NotifyKind.SESSION_ENDED, Optional.empty()));
		inbox.deliver(new Notify(NotifyKind.FRIEND_ONLINE, Optional.of(SECTION_SIGN + RIGHT_TO_LEFT_OVERRIDE)));
		mainThread.runPending();

		assertEquals(List.of("notice GUEST_JOINED cAlex", "notice SESSION_ENDED -", "notice FRIEND_ONLINE -"), heard);
	}

	@Test
	void aListenerThatThrowsDoesNotKeepTheOthersFromHearing() {
		inbox.addListener(new BridgeListener() {
			@Override
			public void notice(NotifyKind kind, Optional<String> name) {
				throw new IllegalStateException("broken UI");
			}
		});
		inbox.addListener(recorder());

		inbox.deliver(new Notify(NotifyKind.JOIN_ENDED, Optional.empty()));
		mainThread.runPending();

		assertEquals(List.of("notice JOIN_ENDED -"), heard);
	}

	@Test
	void aFinalClosingReachesTheClientAtOnceAndTheListenersOnTheMainThread() {
		inbox.addListener(recorder());

		inbox.deliver(new Closing(ClosingReason.REPLACED));

		assertEquals(List.of(ClosingReason.REPLACED), closedForGood);
		assertTrue(heard.isEmpty());
		mainThread.runPending();
		assertEquals(List.of("closing REPLACED"), heard);
	}

	@Test
	void whenTheLinkGoesDownTheTopicsAreForgottenOnTheMainThread() {
		inbox.deliver(state(Topic.INVITES, 1, "[{\"id\":\"i1\",\"fromName\":\"Sam\",\"title\":\"Insel\"}]"));
		mainThread.runPending();

		inbox.linkChanged(LinkState.OFFLINE);
		assertEquals(1, topics.invites().size(), "still shown until the main thread runs");
		mainThread.runPending();

		assertTrue(topics.invites().isEmpty());
		assertEquals(LinkState.OFFLINE, inbox.linkState());
	}

	@Test
	void aConnectedLinkKeepsTheTopicsAndTellsTheListeners() {
		inbox.addListener(recorder());
		inbox.deliver(state(Topic.FRIENDS, 1, "[]"));
		LinkState connected = new LinkState.Connected("2.1.0", new Scopes(ScopeState.ASK, ScopeState.ALLOW));

		inbox.linkChanged(connected);
		mainThread.runPending();

		assertEquals(connected, inbox.linkState());
		assertTrue(inbox.linkState().isConnected());
		assertEquals(List.of("link Connected"), heard);
	}

	@Test
	void answersGoStraightToTheRequestManager() {
		Request<Done> request = requests.start(Ops.hostStop());

		inbox.deliver(FrameCodec.decode("{\"type\":\"res\",\"id\":\"" + sentIds.get(0) + "\",\"ok\":true,\"result\":{}}").orElseThrow());
		mainThread.runPending();

		assertEquals(new Reply.Success<>(Done.DONE), request.reply().join());
	}

	@Test
	void aTickExpiresOverdueRequests() {
		FakeClock clock = new FakeClock();
		RequestManager timed = new RequestManager(mainThread, clock, frame -> Delivery.QUEUED);
		Inbox ticking = new Inbox(timed, topics, mainThread, closedForGood::add);
		Request<Done> request = timed.start(Ops.hostStop());

		clock.advance(Duration.ofSeconds(16));
		ticking.tick();
		mainThread.runPending();

		assertTrue(request.reply().isDone());
	}

	private BridgeListener recorder() {
		return new BridgeListener() {
			@Override
			public void linkChanged(LinkState state) {
				heard.add("link " + state.getClass().getSimpleName());
			}

			@Override
			public void notice(NotifyKind kind, Optional<String> name) {
				heard.add("notice " + kind + " " + name.orElse("-"));
			}

			@Override
			public void closing(ClosingReason reason) {
				heard.add("closing " + reason);
			}
		};
	}

	private static LauncherFrame state(Topic topic, long revision, String json) {
		return new State(topic, revision, JsonParser.parseString(json));
	}
}
