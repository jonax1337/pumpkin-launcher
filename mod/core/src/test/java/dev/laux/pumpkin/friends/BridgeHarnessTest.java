package dev.laux.pumpkin.friends;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import dev.laux.pumpkin.friends.ScriptedLauncher.Connection;
import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.bridge.Messages.Kick;
import dev.laux.pumpkin.friends.bridge.Messages.LanClosed;
import dev.laux.pumpkin.friends.bridge.Messages.LanOpened;
import dev.laux.pumpkin.friends.bridge.Messages.Share;
import dev.laux.pumpkin.friends.bridge.Messages.StopSharing;
import dev.laux.pumpkin.friends.bridge.Protocol;
import dev.laux.pumpkin.friends.state.Snapshot;
import dev.laux.pumpkin.friends.state.StateStore;
import dev.laux.pumpkin.friends.state.StateStore.Alert;
import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Semaphore;
import java.util.concurrent.locks.LockSupport;
import java.util.function.BooleanSupplier;
import java.util.function.Predicate;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** Die sieben Fälle aus SPEC 13.3.1 gegen einen {@link ScriptedLauncher}, ohne Minecraft-Klassen. */
class BridgeHarnessTest {
	private static final BridgeClient.Versions VERSIONS = new BridgeClient.Versions("0.1.0", "26.3");
	private static final Duration AWAIT_LIMIT = Duration.ofSeconds(5);
	private static final Duration POLL_INTERVAL = Duration.ofMillis(5);
	private static final String UUID_HEX = "0123456789abcdef0123456789abcdef";

	private final StateStore store = new StateStore();
	private final List<BridgeClient> clients = new ArrayList<>();
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

	// Fall 1
	@Test
	void withoutEnvironmentNothingStarts() {
		await(() -> !bridgeThreadAlive());

		Optional<BridgeClient> client = BridgeClient.startIfLaunched(Map.of(), VERSIONS, store, timing(new ScaledSleeper()));

		assertTrue(client.isEmpty());
		assertFalse(bridgeThreadAlive());
	}

	@Test
	void incompleteOrInvalidEnvironmentCountsAsAbsent() {
		for (Map<String, String> environment : List.of(
				without("PUMPKIN_IPC_TOKEN"), without("PUMPKIN_IPC_PORT"), without("PUMPKIN_IPC_PROTOCOL"),
				with("PUMPKIN_IPC_TOKEN", "AB".repeat(32)), with("PUMPKIN_IPC_PORT", "70000"),
				with("PUMPKIN_IPC_PORT", "0"), with("PUMPKIN_IPC_PROTOCOL", "2"))) {
			assertTrue(BridgeClient.startIfLaunched(environment, VERSIONS, store, timing(new ScaledSleeper())).isEmpty(),
				environment.toString());
		}
	}

	// Fall 2
	@Test
	void handshakeSendsHelloAndExposesTheSanitizedSnapshot() throws IOException {
		start(new ScaledSleeper());
		try (Connection connection = launcher.accept()) {
			assertEquals("{\"type\":\"hello\",\"protocols\":[1],\"token\":\"" + ScriptedLauncher.TOKEN
				+ "\",\"mod\":\"0.1.0\",\"minecraft\":\"26.3\"}", connection.readLine());
			connection.send("{\"type\":\"welcome\",\"protocol\":1,\"launcher\":\"0.2.0\"}");
			connection.send("{\"type\":\"snapshot\",\"friends\":["
				+ "{\"id\":\"f1\",\"name\":\"§cAlex\",\"mcUuid\":\"" + UUID_HEX + "\",\"presence\":\"online\"},"
				+ "{\"id\":\"f2\",\"name\":\"" + "B".repeat(40) + "\",\"mcUuid\":null,\"presence\":\"playing\"}],"
				+ "\"session\":{\"guests\":[{\"id\":\"f1\",\"name\":\"§aAlex\",\"state\":\"connected\"}]},"
				+ "\"invites\":[{\"id\":\"i1\",\"fromName\":\"Bob§k\",\"title\":\"" + "T".repeat(80) + "\"}]}");

			Snapshot snapshot = awaitSnapshot(shown -> !shown.friends().isEmpty());

			assertEquals(List.of(
				new Snapshot.Friend("f1", "cAlex", Optional.of(UUID_HEX), Snapshot.Presence.ONLINE),
				new Snapshot.Friend("f2", "B".repeat(32), Optional.empty(), Snapshot.Presence.PLAYING)),
				snapshot.friends());
			assertEquals(Optional.of(new Snapshot.Session(
				List.of(new Snapshot.Guest("f1", "aAlex", Snapshot.GuestState.CONNECTED)))), snapshot.session());
			assertEquals(List.of(new Snapshot.Invite("i1", "Bobk", "T".repeat(64))), snapshot.invites());
		}
	}

	// Fall 3
	@ParameterizedTest
	@ValueSource(strings = {"token", "protocol", "duplicate"})
	void rejectClosesAndRetriesNoFasterThanTheBackoff(String reason) throws IOException {
		HeldSleeper sleeper = new HeldSleeper();
		start(sleeper);
		for (Duration expectedDelay : List.of(Duration.ofSeconds(1), Duration.ofSeconds(2))) {
			try (Connection connection = launcher.accept()) {
				connection.readLine();
				connection.send("{\"type\":\"reject\",\"reason\":\"" + reason + "\"}");
				connection.assertClosedByMod();
			}
			await(() -> sleeper.delays().size() == sleeper.released() + 1);
			List<Duration> delays = sleeper.delays();
			assertEquals(expectedDelay, delays.get(delays.size() - 1));
			launcher.assertNoConnectionWithin(Duration.ofMillis(300));
			sleeper.release();
		}
		assertFalse(store.isConnected());
	}

	// Fall 4
	@Test
	void lineOverTheLimitClosesTheConnection() throws IOException {
		start(new ScaledSleeper());
		try (Connection connection = launcher.acceptAndWelcome()) {
			await(store::isConnected);
			connection.send(notifyPaddedTo(Protocol.MAX_LINE_BYTES + 1));
			connection.assertClosedByMod();
			await(() -> !store.isConnected());
		}
	}

	@Test
	void lineOfExactlyTheLimitIsAccepted() throws IOException {
		start(new ScaledSleeper());
		try (Connection connection = launcher.acceptAndWelcome()) {
			connection.send(notifyPaddedTo(Protocol.MAX_LINE_BYTES));
			assertEquals("pumpkin_friends.notify.friendOnline", awaitAlerts(1).get(0).translationKey());
		}
	}

	@Test
	void malformedLinesAreIgnored() throws IOException {
		start(new ScaledSleeper());
		try (Connection connection = launcher.acceptAndWelcome()) {
			for (String malformed : List.of("not json", "[1,2]", "{\"type\":7}", "{\"type\":\"snapshot\",\"friends\":5}",
					"{\"type\":\"futureMessage\"}", "{\"type\":\"notify\",\"event\":null}", "")) {
				connection.send(malformed);
			}
			connection.send("{\"type\":\"notify\",\"event\":\"friendOnline\",\"name\":\"Alex\",\"mcUuid\":null}");

			assertEquals(List.of(new Alert("pumpkin_friends.notify.friendOnline", Optional.of("Alex"), Optional.empty())),
				awaitAlerts(1));
			assertTrue(store.isConnected());
		}
	}

	// Fall 5
	@Test
	void notifyAndErrorReachTheStateQueue() throws IOException {
		start(new ScaledSleeper());
		try (Connection connection = launcher.acceptAndWelcome()) {
			connection.send("{\"type\":\"notify\",\"event\":\"guestJoined\",\"name\":\"§eAlex\",\"mcUuid\":\"" + UUID_HEX
				+ "\"}");
			connection.send("{\"type\":\"error\",\"code\":\"denied\",\"ref\":null}");

			assertEquals(List.of(
				new Alert("pumpkin_friends.notify.guestJoined", Optional.of("eAlex"), Optional.of(UUID_HEX)),
				new Alert("pumpkin_friends.error.denied", Optional.empty(), Optional.empty())),
				awaitAlerts(2));
		}
	}

	@Test
	void pingGetsPongAndKeepsTheConnectionAlive() throws IOException {
		Duration silenceTimeout = Duration.ofMillis(600);
		startWith(new BridgeClient.Timing(Duration.ofSeconds(2), Duration.ofMillis(100), silenceTimeout,
			new ScaledSleeper()));
		try (Connection connection = launcher.acceptAndWelcome()) {
			long until = System.nanoTime() + silenceTimeout.multipliedBy(3).toNanos();
			while (System.nanoTime() < until) {
				assertEquals("{\"type\":\"ping\"}", connection.readLine());
				connection.send("{\"type\":\"pong\"}");
			}
			assertTrue(store.isConnected());
		}
	}

	@Test
	void launcherThatStopsAnsweringIsDroppedAfterTheSilenceTimeout() throws IOException {
		startWith(new BridgeClient.Timing(Duration.ofSeconds(2), Duration.ofMillis(100), Duration.ofMillis(500),
			new ScaledSleeper()));
		try (Connection connection = launcher.acceptAndWelcome()) {
			await(store::isConnected);
			connection.assertClosedByMod();
			await(() -> !store.isConnected());
		}
	}

	// Fall 6
	@Test
	void outgoingMessagesHaveTheExactWireJson() throws IOException {
		BridgeClient client = start(new ScaledSleeper());
		try (Connection connection = launcher.acceptAndWelcome()) {
			await(store::isConnected);
			client.send(new Share(List.of("f1", "f2")));
			client.send(new StopSharing());
			client.send(new Kick("f3"));
			client.send(new LanOpened(25565));
			client.send(new LanClosed());

			assertEquals("{\"type\":\"share\",\"friendIds\":[\"f1\",\"f2\"]}", connection.readLineSkippingPings());
			assertEquals("{\"type\":\"stopSharing\"}", connection.readLineSkippingPings());
			assertEquals("{\"type\":\"kick\",\"friendId\":\"f3\"}", connection.readLineSkippingPings());
			assertEquals("{\"type\":\"lanOpened\",\"port\":25565}", connection.readLineSkippingPings());
			assertEquals("{\"type\":\"lanClosed\"}", connection.readLineSkippingPings());
		}
	}

	// Fall 7; der erste abgewiesene Versuch zeigt, dass ein welcome die Wartezeiten wieder bei 1 s beginnen lässt.
	@Test
	void launcherClosingMidSessionDisconnectsAndReconnectsAfterTheBackoff() throws IOException {
		ScaledSleeper sleeper = new ScaledSleeper();
		start(sleeper);
		refuseOneAttempt();
		try (Connection first = launcher.acceptAndWelcome()) {
			sendOneFriend(first);
			awaitSnapshot(shown -> !shown.friends().isEmpty());
		}
		awaitSnapshot(Snapshot.EMPTY::equals);
		assertFalse(store.isConnected());
		refuseOneAttempt();
		refuseOneAttempt();
		try (Connection reconnected = launcher.acceptAndWelcome()) {
			sendOneFriend(reconnected);
			awaitSnapshot(shown -> !shown.friends().isEmpty());
		}
		// Nach dem Schließen der letzten Verbindung wartet die Mod ein weiteres Mal; ob schon vermerkt, ist ein Wettlauf.
		assertEquals(Stream.of(1, 1, 2, 5).map(Duration::ofSeconds).toList(), sleeper.delays().subList(0, 4));
	}

	private void refuseOneAttempt() throws IOException {
		try (Connection refused = launcher.accept()) {
			refused.readLine();
		}
	}

	private static void sendOneFriend(Connection connection) throws IOException {
		connection.send("{\"type\":\"snapshot\",\"friends\":[{\"id\":\"f1\",\"name\":\"Alex\",\"mcUuid\":null,"
			+ "\"presence\":\"online\"}],\"session\":null,\"invites\":[]}");
	}

	private BridgeClient start(BridgeClient.Sleeper sleeper) {
		return startWith(timing(sleeper));
	}

	private BridgeClient startWith(BridgeClient.Timing timing) {
		BridgeClient client = BridgeClient.startIfLaunched(launcher.environment(), VERSIONS, store, timing).orElseThrow();
		clients.add(client);
		return client;
	}

	private static BridgeClient.Timing timing(BridgeClient.Sleeper sleeper) {
		return new BridgeClient.Timing(Duration.ofSeconds(2), Duration.ofSeconds(10), Duration.ofSeconds(30), sleeper);
	}

	private Map<String, String> without(String variable) {
		Map<String, String> environment = new HashMap<>(launcher.environment());
		environment.remove(variable);
		return environment;
	}

	private Map<String, String> with(String variable, String value) {
		Map<String, String> environment = new HashMap<>(launcher.environment());
		environment.put(variable, value);
		return environment;
	}

	/** Ein gültiges {@code notify}, mit Leerzeichen im Objekt auf genau {@code bytes} Bytes aufgefüllt. */
	private static String notifyPaddedTo(int bytes) {
		String start = "{\"type\":\"notify\",\"event\":\"friendOnline\",\"name\":\"Alex\",\"mcUuid\":null";
		return start + " ".repeat(bytes - start.length() - 1) + "}";
	}

	private Snapshot awaitSnapshot(Predicate<Snapshot> condition) {
		await(() -> {
			store.drain();
			return condition.test(store.snapshot());
		});
		return store.snapshot();
	}

	private List<Alert> awaitAlerts(int count) {
		List<Alert> alerts = new ArrayList<>();
		await(() -> {
			alerts.addAll(store.drain());
			return alerts.size() >= count;
		});
		return alerts;
	}

	private static boolean bridgeThreadAlive() {
		return Thread.getAllStackTraces().keySet().stream()
			.anyMatch(thread -> thread.isAlive() && thread.getName().startsWith("Pumpkin Friends bridge"));
	}

	private static void await(BooleanSupplier condition) {
		long deadline = System.nanoTime() + AWAIT_LIMIT.toNanos();
		while (!condition.getAsBoolean()) {
			if (System.nanoTime() > deadline) {
				fail("Bedingung nicht innerhalb von " + AWAIT_LIMIT + " erfüllt");
			}
			LockSupport.parkNanos(POLL_INTERVAL.toNanos());
		}
	}

	/** Zeichnet die verlangten Wartezeiten auf und wartet nur ein Hundertstel davon. */
	private static final class ScaledSleeper implements BridgeClient.Sleeper {
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

	/** Zeichnet die verlangten Wartezeiten auf und wartet, bis der Test sie freigibt. */
	private static final class HeldSleeper implements BridgeClient.Sleeper {
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
