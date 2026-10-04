package dev.laux.pumpkin.friends.bridge;

import static dev.laux.pumpkin.friends.Fixtures.Direction.LAUNCHER_TO_MOD;
import static dev.laux.pumpkin.friends.Fixtures.Direction.MOD_TO_LAUNCHER;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import dev.laux.pumpkin.friends.Await;
import dev.laux.pumpkin.friends.Fixtures;
import dev.laux.pumpkin.friends.Fixtures.Line;
import dev.laux.pumpkin.friends.ManualMainThread;
import dev.laux.pumpkin.friends.ScriptedLauncher;
import dev.laux.pumpkin.friends.ScriptedLauncher.Session;
import dev.laux.pumpkin.friends.protocol.ClosingReason;
import dev.laux.pumpkin.friends.protocol.ErrorCode;
import dev.laux.pumpkin.friends.protocol.GameInfo;
import dev.laux.pumpkin.friends.protocol.Limits;
import dev.laux.pumpkin.friends.protocol.NotifyKind;
import dev.laux.pumpkin.friends.protocol.RejectReason;
import dev.laux.pumpkin.friends.protocol.Scope;
import dev.laux.pumpkin.friends.request.Ops;
import dev.laux.pumpkin.friends.request.Reply;
import dev.laux.pumpkin.friends.request.Request;
import dev.laux.pumpkin.friends.request.Results.Done;
import dev.laux.pumpkin.friends.runtime.MainThread;
import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Semaphore;
import java.util.function.BooleanSupplier;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/**
 * The real client against a {@link ScriptedLauncher} speaking protocol 2 over loopback sockets. Several tests open a session
 * only to let the end of its block hang up on the mod, hence the suppressed "resource never referenced" lint.
 */
@SuppressWarnings("try")
class BridgeClientTest {
	private static final String THREAD_NAME_PREFIX = "Pumpkin Friends bridge";
	private static final String OLD_PROTOCOL_ENV = "1";

	private final ManualMainThread mainThread = new ManualMainThread();
	private final List<BridgeClient> clients = new ArrayList<>();
	private final List<String> heard = new CopyOnWriteArrayList<>();
	private ScriptedLauncher launcher;

	@BeforeEach
	void startLauncher() throws IOException {
		launcher = new ScriptedLauncher();
	}

	@AfterEach
	void stopEverything() throws IOException {
		clients.forEach(BridgeClient::stop);
		launcher.close();
	}

	@Test
	void withoutTheLauncherEnvironmentNoThreadIsStarted() {
		Await.until("threads of earlier tests have ended", () -> !bridgeThreadAlive());
		Optional<BridgeClient> client = BridgeClient.startIfLaunched(Map.of(), platform(), timing(new ScaledSleeper()));

		assertTrue(client.isEmpty());
		assertFalse(bridgeThreadAlive());
	}

	@Test
	void anEnvironmentOfTheOldProtocolCountsAsAbsent() {
		Map<String, String> environment = new HashMap<>(launcher.environment());
		environment.put("PUMPKIN_IPC_PROTOCOL", OLD_PROTOCOL_ENV);

		assertTrue(BridgeClient.startIfLaunched(environment, platform(), timing(new ScaledSleeper())).isEmpty());
	}

	@Test
	void theHelloIsExactlyTheLineOfTheHandshakeFixture() throws IOException {
		start(new ScaledSleeper());

		try (Session session = launcher.accept()) {
			assertEquals(Fixtures.only("handshake-ok.jsonl", MOD_TO_LAUNCHER).message(), session.readFrame());
		}
	}

	@Test
	void aWelcomeConnectsTheLinkAndTheScopesAreKept() throws IOException {
		BridgeClient client = start(new ScaledSleeper());

		try (Session session = launcher.acceptAndWelcome()) {
			awaitMain(client::isConnected);

			LinkState.Connected state = assertInstanceOf(LinkState.Connected.class, client.state());
			assertEquals("2.1.0", state.launcherVersion());
		}
	}

	@Test
	void theReadyHintNamesTheScreensNowAndAfterEveryReconnect() throws IOException {
		BridgeClient client = start(new ScaledSleeper());
		client.announceReady(List.of("hub"));

		try (Session first = launcher.acceptAndWelcome()) {
			assertEquals("{\"type\":\"ready\",\"screens\":[\"hub\"]}", first.readFrameOfType("ready").toString());
		}
		try (Session second = launcher.acceptAndWelcome()) {
			assertEquals("{\"type\":\"ready\",\"screens\":[\"hub\"]}", second.readFrameOfType("ready").toString());
		}
	}

	@Test
	void pushedTopicsReachTheStoreOnTheMainThreadWhileTheTopicRevisionsStayOrdered() throws IOException {
		BridgeClient client = start(new ScaledSleeper());
		try (Session session = launcher.acceptAndWelcome()) {
			for (Line push : Fixtures.read("topics.jsonl", LAUNCHER_TO_MOD)) {
				session.sendFixture(push);
			}

			awaitMain(() -> client.topics().blocked().size() == 1);

			assertEquals(2, client.topics().friends().size());
			assertEquals(Optional.empty(), client.topics().session(), "revision 2 of session says nothing is shared");
			assertEquals("Troll", client.topics().blocked().get(0).name());
		}
	}

	@Test
	void aRequestTravelsAsTheFixtureLineAndItsAnswerCompletesTheReply() throws IOException {
		BridgeClient client = start(new ScaledSleeper());
		try (Session session = launcher.acceptAndWelcome()) {
			awaitMain(client::isConnected);

			Request<Done> request = client.request(Ops.friendAddByName("Notch"));

			JsonObject sent = session.readFrameOfType("req");
			assertEquals("friend.addByName", sent.get("op").getAsString());
			assertEquals("{\"name\":\"Notch\"}", sent.get("args").toString());
			session.sendSuccess(sent.get("id").getAsString());
			awaitMain(() -> request.reply().isDone());
			assertEquals(new Reply.Success<>(Done.DONE), request.reply().join());
		}
	}

	@Test
	void anErrorAnswerArrivesAsATypedFailure() throws IOException {
		BridgeClient client = start(new ScaledSleeper());
		try (Session session = launcher.acceptAndWelcome()) {
			awaitMain(client::isConnected);
			Request<Done> request = client.request(Ops.friendAddByName("Notch"));
			String id = session.readFrameOfType("req").get("id").getAsString();

			session.send("{\"type\":\"res\",\"id\":\"" + id + "\",\"ok\":false,\"error\":{\"code\":\"nameUnknown\",\"params\":{}}}");

			awaitMain(() -> request.reply().isDone());
			assertEquals(ErrorCode.NAME_UNKNOWN, request.reply().join().error().orElseThrow().code());
		}
	}

	@Test
	void pendingShowsTheDialogScopeUntilTheFinalAnswer() throws IOException {
		BridgeClient client = start(new ScaledSleeper());
		try (Session session = launcher.acceptAndWelcome()) {
			awaitMain(client::isConnected);
			Request<Done> request = client.request(Ops.hostInvite(List.of("f1"), false));
			String id = session.readFrameOfType("req").get("id").getAsString();

			session.send("{\"type\":\"pending\",\"id\":\"" + id + "\",\"prompt\":\"scope\",\"scope\":\"share\"}");
			awaitMain(() -> request.awaitedScope().isPresent());
			assertEquals(Optional.of(Scope.SHARE), request.awaitedScope());
			assertTrue(client.isAwaitingLauncherDialog());

			session.sendSuccess(id);
			awaitMain(() -> request.reply().isDone());
			assertFalse(client.isAwaitingLauncherDialog());
		}
	}

	@Test
	void theNinthRequestInFlightIsBusyAtOnceAndNeverReachesTheLauncher() throws IOException {
		BridgeClient client = start(new ScaledSleeper());
		try (Session session = launcher.acceptAndWelcome()) {
			awaitMain(client::isConnected);
			List<Request<Done>> requests = new ArrayList<>();
			for (int count = 0; count < Limits.MAX_IN_FLIGHT; count++) {
				requests.add(client.request(Ops.hostStop()));
			}

			Request<Done> ninth = client.request(Ops.hostStop());

			awaitMain(() -> ninth.reply().isDone());
			assertEquals(ErrorCode.BUSY, ninth.reply().join().error().orElseThrow().code());
			client.lanClosed();
			assertEquals(Limits.MAX_IN_FLIGHT, requestLinesBefore("lanClosed", session));
			assertTrue(requests.stream().noneMatch(request -> request.reply().isDone()));
		}
	}

	@Test
	void lanHintsGoOutAsFixtureLinesAndNeverFasterThanTwentyPerSecond() throws IOException {
		BridgeClient client = start(new ScaledSleeper());
		try (Session session = launcher.acceptAndWelcome()) {
			awaitMain(client::isConnected);
			int messages = 45;
			for (int count = 0; count < messages; count++) {
				client.lanOpened(50123);
			}

			for (int count = 0; count < messages; count++) {
				session.readFrameOfType("lanOpened");
			}

			List<Session.ReceivedLine> lanLines = session.received().stream()
				.filter(line -> line.text().contains("lanOpened")).toList();
			assertEquals(Fixtures.read("hints.jsonl", MOD_TO_LAUNCHER).get(0).wire(), lanLines.get(0).text());
			for (int first = 0; first + Limits.MESSAGES_PER_SECOND < lanLines.size(); first++) {
				Duration span = Duration.ofNanos(lanLines.get(first + Limits.MESSAGES_PER_SECOND).nanos() - lanLines.get(first).nanos());
				assertTrue(span.compareTo(Limits.MESSAGE_WINDOW.minusMillis(50)) >= 0,
					"21 messages within " + span + " from " + first);
			}
		}
	}

	@Test
	void anIdleLinkPingsAndALauncherPingGetsAPong() throws IOException {
		startWith(timing(new ScaledSleeper(), Duration.ofMillis(100), Duration.ofSeconds(30)));
		try (Session session = launcher.acceptAndWelcome()) {
			assertEquals("ping", session.readFrameOfType("ping").get("type").getAsString());

			session.send("{\"type\":\"ping\"}");

			assertEquals("pong", session.readFrameOfType("pong").get("type").getAsString());
		}
	}

	@Test
	void aSilentLauncherIsDroppedAndTheModReconnects() throws IOException {
		ScaledSleeper sleeper = new ScaledSleeper();
		BridgeClient client = startWith(timing(sleeper, Duration.ofSeconds(10), Duration.ofMillis(400)));
		try (Session silent = launcher.acceptAndWelcome()) {
			awaitMain(client::isConnected);
			silent.assertClosedByMod();
			awaitMain(() -> !client.isConnected());
		}

		try (Session again = launcher.acceptAndWelcome()) {
			awaitMain(client::isConnected);
		}
		assertEquals(Duration.ofSeconds(1), sleeper.delays().get(0));
	}

	@Test
	void whenTheLinkBreaksOpenRequestsFailAndTopicsAreForgotten() throws IOException {
		BridgeClient client = start(new ScaledSleeper());
		Request<Done> open;
		try (Session session = launcher.acceptAndWelcome()) {
			session.sendFixture(Fixtures.read("topics.jsonl", LAUNCHER_TO_MOD).get(3));
			awaitMain(() -> !client.topics().invites().isEmpty());
			open = client.request(Ops.hostStop());
			session.readFrameOfType("req");
		}

		awaitMain(() -> open.reply().isDone());
		assertEquals(ErrorCode.DISCONNECTED, open.reply().join().error().orElseThrow().code());
		awaitMain(() -> client.topics().invites().isEmpty());
	}

	@Test
	void aRequestWithoutALinkFailsAsDisconnected() {
		BridgeClient client = start(new HeldSleeper());

		Request<Done> request = client.request(Ops.hostStop());

		awaitMain(() -> request.reply().isDone());
		assertEquals(ErrorCode.DISCONNECTED, request.reply().join().error().orElseThrow().code());
	}

	// The first refused attempt shows that a welcome lets the waits start again at one second.
	@Test
	void theLauncherClosingMidSessionIsFollowedByAReconnectAfterTheBackoff() throws IOException {
		ScaledSleeper sleeper = new ScaledSleeper();
		BridgeClient client = start(sleeper);
		launcher.refuseOneAttempt();
		try (Session first = launcher.acceptAndWelcome()) {
			awaitMain(client::isConnected);
		}
		awaitMain(() -> !client.isConnected());
		launcher.refuseOneAttempt();
		launcher.refuseOneAttempt();
		try (Session reconnected = launcher.acceptAndWelcome()) {
			awaitMain(client::isConnected);
		}

		assertEquals(Stream.of(1, 1, 2, 5).map(Duration::ofSeconds).toList(), sleeper.delays().subList(0, 4));
	}

	@ParameterizedTest
	@EnumSource(value = RejectReason.class, names = "RETRY", mode = EnumSource.Mode.EXCLUDE)
	void aTerminalRejectIsShownAndRetriedOnlyOnceAMinute(RejectReason reason) throws IOException {
		HeldSleeper sleeper = new HeldSleeper();
		BridgeClient client = start(sleeper);

		try (Session session = launcher.accept()) {
			session.readLine();
			session.sendReject(reason);
			session.assertClosedByMod();
		}

		Await.until("long pause", () -> sleeper.delays().size() == 1);
		assertEquals(Duration.ofSeconds(60), sleeper.delays().get(0));
		awaitMain(() -> client.state().equals(new LinkState.Rejected(reason)));
		launcher.assertNoConnectionWithin(Duration.ofMillis(300));
		sleeper.release();
		try (Session again = launcher.accept()) {
			again.readLine();
		}
	}

	@Test
	void aTerminalRejectRepeatedDoesNotPileUpOrChangeTheWait() throws IOException {
		HeldSleeper sleeper = new HeldSleeper();
		start(sleeper);

		for (int attempt = 0; attempt < 3; attempt++) {
			try (Session session = launcher.accept()) {
				session.readLine();
				session.sendReject(RejectReason.TOKEN);
				session.assertClosedByMod();
			}
			int expected = attempt + 1;
			Await.until("pause " + expected, () -> sleeper.delays().size() == expected);
			sleeper.release();
		}

		assertEquals(List.of(Duration.ofSeconds(60), Duration.ofSeconds(60), Duration.ofSeconds(60)), sleeper.delays());
	}

	@Test
	void aRetryRejectBacksOffShortlyAndIsNotShownAsRejected() throws IOException {
		HeldSleeper sleeper = new HeldSleeper();
		BridgeClient client = start(sleeper);

		for (Duration expected : List.of(Duration.ofSeconds(1), Duration.ofSeconds(2), Duration.ofSeconds(5))) {
			try (Session session = launcher.accept()) {
				session.readLine();
				session.sendReject(RejectReason.RETRY);
				session.assertClosedByMod();
			}
			Await.until("pause " + expected, () -> sleeper.delays().size() == sleeper.released() + 1);
			assertEquals(expected, sleeper.delays().get(sleeper.delays().size() - 1));
			sleeper.release();
		}

		assertEquals(LinkState.OFFLINE, client.state());
		try (Session welcomed = launcher.acceptAndWelcome()) {
			awaitMain(client::isConnected);
		}
	}

	@Test
	void aFinalClosingStopsTheReconnects() throws IOException {
		ScaledSleeper sleeper = new ScaledSleeper();
		BridgeClient client = startListening(sleeper);
		try (Session session = launcher.acceptAndWelcome()) {
			session.send("{\"type\":\"event\",\"event\":\"closing\",\"reason\":\"launchEnded\"}");
			awaitMain(() -> heard.contains("closing LAUNCH_ENDED"));
		}

		awaitMain(() -> !client.isConnected());
		launcher.assertNoConnectionWithin(Duration.ofMillis(500));
		assertEquals(List.of(), sleeper.delays());
	}

	@Test
	void aClosingForABridgeRestartKeepsTheReconnects() throws IOException {
		BridgeClient client = startListening(new ScaledSleeper());
		try (Session session = launcher.acceptAndWelcome()) {
			session.send("{\"type\":\"event\",\"event\":\"closing\",\"reason\":\"bridgeStopped\"}");
			awaitMain(() -> heard.contains("closing BRIDGE_STOPPED"));
		}

		try (Session again = launcher.acceptAndWelcome()) {
			awaitMain(client::isConnected);
		}
	}

	@Test
	void noticesReachTheListenersSanitised() throws IOException {
		startListening(new ScaledSleeper());
		try (Session session = launcher.acceptAndWelcome()) {
			session.sendFixture(Fixtures.read("events.jsonl", LAUNCHER_TO_MOD).get(3));

			awaitMain(() -> !heard.isEmpty());

			assertEquals(List.of("notice " + NotifyKind.GUEST_JOINED + " Alex"), heard);
		}
	}

	@Test
	void aLineOverTheLauncherLimitClosesTheConnection() throws IOException {
		BridgeClient client = start(new ScaledSleeper());
		try (Session session = launcher.acceptAndWelcome()) {
			awaitMain(client::isConnected);

			session.send("x".repeat(Limits.LAUNCHER_LINE_BYTES));

			session.assertClosedByMod();
			awaitMain(() -> !client.isConnected());
		}
	}

	@Test
	void malformedLinesAreIgnoredAndTheConnectionStays() throws IOException {
		BridgeClient client = startListening(new ScaledSleeper());
		try (Session session = launcher.acceptAndWelcome()) {
			for (String malformed : List.of("not json", "[1,2]", "{\"type\":7}", "{\"type\":\"state\",\"topic\":\"friends\"}",
					"{\"type\":\"futureMessage\"}", "")) {
				session.send(malformed);
			}
			session.sendFixture(Fixtures.read("events.jsonl", LAUNCHER_TO_MOD).get(2));

			awaitMain(() -> !heard.isEmpty());

			assertEquals(List.of("notice FRIEND_ONLINE Alex"), heard);
			assertTrue(client.isConnected());
		}
	}

	/** Reads frames until one of the given type arrives and counts the requests among those before it. */
	private static int requestLinesBefore(String type, Session session) throws IOException {
		int requests = 0;
		for (JsonObject frame = session.readFrameSkippingPings(); !frame.get("type").getAsString().equals(type);
				frame = session.readFrameSkippingPings()) {
			if (frame.get("type").getAsString().equals("req")) {
				requests++;
			}
		}
		return requests;
	}

	private BridgeClient start(Timing.Sleeper sleeper) {
		return startWith(timing(sleeper));
	}

	private BridgeClient startListening(Timing.Sleeper sleeper) {
		BridgeClient client = start(sleeper);
		client.addListener(new BridgeListener() {
			@Override
			public void notice(NotifyKind kind, Optional<String> name) {
				heard.add("notice " + kind + " " + name.orElse("-"));
			}

			@Override
			public void closing(ClosingReason reason) {
				heard.add("closing " + reason);
			}
		});
		return client;
	}

	private BridgeClient startWith(Timing timing) {
		BridgeClient client = BridgeClient.startIfLaunched(launcher.environment(), platform(), timing).orElseThrow();
		clients.add(client);
		return client;
	}

	private static Timing timing(Timing.Sleeper sleeper) {
		return timing(sleeper, Duration.ofSeconds(10), Duration.ofSeconds(30));
	}

	private static Timing timing(Timing.Sleeper sleeper, Duration pingInterval, Duration silence) {
		return new Timing(Duration.ofSeconds(2), pingInterval, silence, Duration.ofSeconds(5), Duration.ofMillis(20),
			Duration.ofSeconds(60), sleeper);
	}

	private HostPlatform platform() {
		return new HostPlatform() {
			@Override
			public String modVersion() {
				return "2.1.0";
			}

			@Override
			public GameInfo game() {
				return new GameInfo("1.21.1", "neoforge", "21.1.172", 21);
			}

			@Override
			public MainThread mainThread() {
				return mainThread;
			}

			@Override
			public String buildId() {
				return "0123456789abcdef";
			}
		};
	}

	private void awaitMain(BooleanSupplier condition) {
		Await.until("condition on the main thread", () -> {
			mainThread.runPending();
			return condition.getAsBoolean();
		});
	}

	private static boolean bridgeThreadAlive() {
		return Thread.getAllStackTraces().keySet().stream()
			.anyMatch(thread -> thread.isAlive() && thread.getName().startsWith(THREAD_NAME_PREFIX));
	}

	/** Records the requested pauses and waits only a hundredth of them. */
	private static final class ScaledSleeper implements Timing.Sleeper {
		private static final int SCALE = 100;
		private final List<Duration> delays = new CopyOnWriteArrayList<>();

		@Override
		public void sleep(Duration duration) throws InterruptedException {
			delays.add(duration);
			Thread.sleep(duration.dividedBy(SCALE).toMillis());
		}

		List<Duration> delays() {
			return List.copyOf(delays);
		}
	}

	/** Records the requested pauses and waits until the test releases them. */
	private static final class HeldSleeper implements Timing.Sleeper {
		private final List<Duration> delays = new CopyOnWriteArrayList<>();
		private final Semaphore permits = new Semaphore(0);
		private volatile int released;

		@Override
		public void sleep(Duration duration) throws InterruptedException {
			delays.add(duration);
			permits.acquire();
		}

		void release() {
			released++;
			permits.release();
		}

		int released() {
			return released;
		}

		List<Duration> delays() {
			return List.copyOf(delays);
		}
	}
}
