package dev.laux.pumpkin.bridge.transport;

import static dev.laux.pumpkin.bridge.Fixtures.Direction.LAUNCHER_TO_MOD;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonParser;
import dev.laux.pumpkin.bridge.FakeClock;
import dev.laux.pumpkin.bridge.Fixtures;
import dev.laux.pumpkin.bridge.Fixtures.Line;
import dev.laux.pumpkin.bridge.ManualMainThread;
import dev.laux.pumpkin.bridge.protocol.ClosingReason;
import dev.laux.pumpkin.bridge.protocol.FrameCodec;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Closing;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Notify;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.State;
import dev.laux.pumpkin.bridge.protocol.ModFrame;
import dev.laux.pumpkin.bridge.protocol.NotifyKind;
import dev.laux.pumpkin.bridge.protocol.ScopeState;
import dev.laux.pumpkin.bridge.protocol.Scopes;
import dev.laux.pumpkin.bridge.protocol.Topic;
import dev.laux.pumpkin.bridge.modules.friends.protocol.Ops;
import dev.laux.pumpkin.bridge.transport.request.Reply;
import dev.laux.pumpkin.bridge.transport.request.Request;
import dev.laux.pumpkin.bridge.transport.request.RequestManager;
import dev.laux.pumpkin.bridge.transport.request.RequestManager.Delivery;
import dev.laux.pumpkin.bridge.modules.friends.protocol.Results.Done;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** Main-thread frame ordering, raw notices, and listeners that misbehave. */
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
	private final List<State> states = new ArrayList<>();
	private final List<ClosingReason> closedForGood = new ArrayList<>();
	private final Inbox inbox = new Inbox(requests, mainThread, closedForGood::add);
	private final List<String> heard = new ArrayList<>();

	@Test
	void stateFramesReachListenersOnlyOnTheMainThreadAndInArrivalOrder() {
		inbox.addListener(new BridgeListener() {
			@Override
			public void stateReceived(State state) {
				states.add(state);
			}
		});
		inbox.deliver(state(Topic.FRIENDS, 1, "[]"));
		inbox.deliver(state(Topic.INVITES, 1, "[{\"id\":\"i1\",\"fromName\":\"Sam\",\"title\":\"Insel\"}]"));
		assertTrue(states.isEmpty(), "nothing before the main thread runs");

		mainThread.runPending();

		assertEquals(List.of(Topic.FRIENDS, Topic.INVITES), states.stream().map(State::topic).toList());
		assertEquals("Sam", states.get(1).value().getAsJsonArray().get(0).getAsJsonObject().get("fromName").getAsString());
	}

	@Test
	void aNoticeKeepsItsKindAndUntrustedNameForTheModule() {
		inbox.addListener(recorder());

		inbox.deliver(new Notify(NotifyKind.GUEST_JOINED, Optional.of(SECTION_SIGN + "cAl" + ZERO_WIDTH_SPACE + "ex")));
		inbox.deliver(new Notify(NotifyKind.SESSION_ENDED, Optional.empty()));
		inbox.deliver(new Notify(NotifyKind.FRIEND_ONLINE, Optional.of(SECTION_SIGN + RIGHT_TO_LEFT_OVERRIDE)));
		mainThread.runPending();

		assertEquals(List.of("notice GUEST_JOINED " + SECTION_SIGN + "cAl" + ZERO_WIDTH_SPACE + "ex",
			"notice SESSION_ENDED -", "notice FRIEND_ONLINE " + SECTION_SIGN + RIGHT_TO_LEFT_OVERRIDE), heard);
	}

	@Test
	void everyNoticeOfTheEventFixtureReachesTheListenersSoNoToastKindIsLost() {
		inbox.addListener(recorder());
		Fixtures.read("events.jsonl", LAUNCHER_TO_MOD).stream().map(Line::wire).map(wire -> FrameCodec.decode(wire).orElseThrow())
			.filter(Notify.class::isInstance).forEach(inbox::deliver);

		mainThread.runPending();

		assertEquals(NotifyKind.values().length, heard.size());
		assertTrue(heard.contains("notice SCOPE_DENIED -"));
		assertTrue(heard.contains("notice REQUEST_RECEIVED Sam"));
		assertTrue(heard.contains("notice JOIN_ENDED -"));
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
	void stateAndDisconnectCallbacksStayInArrivalOrderOnTheMainThread() {
		inbox.addListener(new BridgeListener() {
			@Override
			public void stateReceived(State state) {
				heard.add("state " + state.topic());
			}

			@Override
			public void linkChanged(LinkState state) {
				heard.add("link " + state.getClass().getSimpleName());
			}
		});
		inbox.deliver(state(Topic.INVITES, 1, "[{\"id\":\"i1\",\"fromName\":\"Sam\",\"title\":\"Insel\"}]"));
		inbox.linkChanged(LinkState.OFFLINE);
		assertTrue(heard.isEmpty());
		mainThread.runPending();

		assertEquals(List.of("state INVITES", "link Offline"), heard);
		assertEquals(LinkState.OFFLINE, inbox.linkState());
	}

	@Test
	void aConnectedLinkTellsTheListenersAndPublishesItsState() {
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
		Inbox ticking = new Inbox(timed, mainThread, closedForGood::add);
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
