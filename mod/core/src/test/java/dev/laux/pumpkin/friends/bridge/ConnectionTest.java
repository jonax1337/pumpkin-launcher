package dev.laux.pumpkin.friends.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import dev.laux.pumpkin.friends.Await;
import dev.laux.pumpkin.friends.FakeClock;
import dev.laux.pumpkin.friends.Fixtures;
import dev.laux.pumpkin.friends.ManualMainThread;
import dev.laux.pumpkin.friends.bridge.FakeSocket.WrittenLine;
import dev.laux.pumpkin.friends.bridge.LineReader.OversizedLineException;
import dev.laux.pumpkin.friends.json.WireNames;
import dev.laux.pumpkin.friends.protocol.FrameCodec;
import dev.laux.pumpkin.friends.protocol.GameInfo;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Welcome;
import dev.laux.pumpkin.friends.protocol.Limits;
import dev.laux.pumpkin.friends.protocol.ModFrame;
import dev.laux.pumpkin.friends.protocol.NotifyKind;
import dev.laux.pumpkin.friends.protocol.RejectReason;
import dev.laux.pumpkin.friends.request.Ops;
import dev.laux.pumpkin.friends.request.Request;
import dev.laux.pumpkin.friends.request.RequestManager;
import dev.laux.pumpkin.friends.request.RequestManager.Delivery;
import dev.laux.pumpkin.friends.request.Results.Done;
import dev.laux.pumpkin.friends.runtime.MonotonicClock;
import dev.laux.pumpkin.friends.state.TopicStore;
import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/** One connection against a socket without a network: handshake, keep-alive, silence, stalled writes, limits. */
class ConnectionTest {
	private static final String WELCOME = "{\"type\":\"welcome\",\"protocol\":2,\"launcher\":\"2.1.0\",\"scopes\":{\"share\":\"ask\",\"social\":\"ask\"}}";
	private static final String FRIEND_ONLINE = "{\"type\":\"event\",\"event\":\"notify\",\"kind\":\"friendOnline\",\"name\":\"Alex\"}";
	private static final ModFrame.Hello HELLO = new ModFrame.Hello(Fixtures.TOKEN, "2.1.0", "0123456789abcdef",
		new GameInfo("1.21.1", "neoforge", "21.1.172", 21));

	private final FakeSocket socket = new FakeSocket();
	private final ManualMainThread mainThread = new ManualMainThread();
	private final List<Welcome> welcomes = new CopyOnWriteArrayList<>();
	private final List<RejectReason> rejections = new CopyOnWriteArrayList<>();
	private final List<String> heard = new CopyOnWriteArrayList<>();
	private Connection connection;
	private CompletableFuture<Void> served;

	@AfterEach
	void closeEverything() {
		socket.close();
	}

	@Test
	void theHelloIsTheFirstLineOnTheWire() {
		start(fastPings());

		Await.until("hello", () -> !socket.writtenTexts().isEmpty());

		assertEquals(FrameCodec.encode(HELLO), socket.writtenTexts().get(0));
	}

	@Test
	void aWelcomeTellsTheOwnerAndOpensTheOutgoingQueue() {
		start(fastPings());
		socket.feedLine(WELCOME);
		Await.until("welcome", () -> !welcomes.isEmpty());

		assertTrue(connection.offer(new ModFrame.LanOpened(25565)));

		Await.until("lanOpened written", () -> socket.writtenTexts().contains("{\"type\":\"lanOpened\",\"port\":25565}"));
		assertEquals("2.1.0", welcomes.get(0).launcher());
	}

	@Test
	void aWelcomeForAnotherProtocolIsRefusedAsProtocolMismatch() {
		start(fastPings());

		socket.feedLine("{\"type\":\"welcome\",\"protocol\":3,\"launcher\":\"9.0.0\",\"scopes\":{\"share\":\"ask\",\"social\":\"ask\"}}");

		served.join();
		assertEquals(List.of(RejectReason.PROTOCOL), rejections);
		assertTrue(welcomes.isEmpty());
	}

	@ParameterizedTest
	@EnumSource(RejectReason.class)
	void everyRejectReasonEndsTheConnectionAndIsReportedOnce(RejectReason reason) {
		start(fastPings());

		socket.feedLine("{\"type\":\"reject\",\"reason\":\"" + WireNames.of(reason) + "\"}");

		served.join();
		assertEquals(List.of(reason), rejections);
		assertEquals(1, socket.writtenTexts().size(), "only the hello was written");
	}

	@Test
	void framesBeforeTheWelcomeAreIgnored() {
		start(fastPings());

		socket.feedLine(FRIEND_ONLINE);
		socket.feedLine(WELCOME);
		Await.until("welcome", () -> !welcomes.isEmpty());

		mainThread.runPending();
		assertEquals(List.of(), heard);
	}

	@Test
	void framesAfterTheWelcomeGoToTheInbox() {
		start(fastPings());
		socket.feedLine(WELCOME);
		Await.until("welcome", () -> !welcomes.isEmpty());

		socket.feedLine(FRIEND_ONLINE);

		awaitNotice();
		assertEquals(List.of("FRIEND_ONLINE Alex"), heard);
	}

	@Test
	void anIdleLinkSendsItsOwnPingEveryPingPeriod() {
		start(fastPings());
		socket.feedLine(WELCOME);

		Await.until("two pings", () -> socket.writtenTexts().stream().filter("{\"type\":\"ping\"}"::equals).count() >= 2);
	}

	@Test
	void aPingFromTheLauncherIsAnsweredWithAPong() {
		start(patient());
		socket.feedLine(WELCOME);
		Await.until("welcome", () -> !welcomes.isEmpty());

		socket.feedLine("{\"type\":\"ping\"}");

		Await.until("pong", () -> socket.writtenTexts().contains("{\"type\":\"pong\"}"));
	}

	@Test
	void aLauncherThatSaysNothingForTheSilencePeriodEndsTheConnection() {
		start(fastPings());
		socket.feedLine(WELCOME);

		IOException ended = assertThrows(IOException.class, this::awaitEnd);

		assertTrue(ended.getMessage().contains("silent"), ended.getMessage());
	}

	@Test
	void anyLineFromTheLauncherKeepsTheConnectionAlive() throws InterruptedException {
		start(fastPings());
		socket.feedLine(WELCOME);

		for (int count = 0; count < 12; count++) {
			Thread.sleep(50);
			socket.feedLine("{\"type\":\"pong\"}");
		}

		assertFalse(served.isDone(), "600 ms passed with a 300 ms silence limit, but the launcher kept talking");
	}

	@Test
	void aWriteThatDoesNotFinishWithinTheStallLimitEndsTheConnection() {
		start(patient().withStall(Duration.ofMillis(100)));
		socket.feedLine(WELCOME);
		Await.until("welcome", () -> !welcomes.isEmpty());
		socket.blockWrites();

		connection.offer(new ModFrame.LanClosed());

		IOException ended = assertThrows(IOException.class, this::awaitEnd);
		assertTrue(ended.getMessage().contains("not read"), ended.getMessage());
	}

	@Test
	void aLineLongerThanTheLauncherLimitEndsTheConnection() {
		start(patient());
		socket.feedLine(WELCOME);
		Await.until("welcome", () -> !welcomes.isEmpty());

		socket.feedBytes(Limits.LAUNCHER_LINE_BYTES, 'x');

		assertThrows(OversizedLineException.class, this::awaitEnd);
	}

	@Test
	void aLineOfExactlyTheLauncherLimitIsAccepted() {
		start(patient());
		socket.feedLine(WELCOME);
		Await.until("welcome", () -> !welcomes.isEmpty());
		String start = FRIEND_ONLINE.substring(0, FRIEND_ONLINE.length() - 1);
		int closingBrace = 1;
		int lineEnding = 1;
		socket.feedLine(start + " ".repeat(Limits.LAUNCHER_LINE_BYTES - lineEnding - closingBrace - start.length()) + "}");

		awaitNotice();
		assertFalse(served.isDone());
	}

	@Test
	void theLauncherClosingTheStreamEndsTheConnection() {
		start(patient());
		socket.feedLine(WELCOME);

		socket.endInput();

		assertThrows(IOException.class, this::awaitEnd);
	}

	@Test
	void theWriterNeverSendsMoreThanTwentyMessagesInAnyLauncherSecond() {
		start(patient());
		socket.feedLine(WELCOME);
		Await.until("welcome", () -> !welcomes.isEmpty());

		for (int count = 0; count < 45; count++) {
			assertTrue(connection.offer(new ModFrame.LanClosed()), "queue slot " + count);
		}

		Await.until("all written", () -> socket.writtenLines().size() >= 46);
		List<WrittenLine> lines = socket.writtenLines();
		for (int first = 1; first + Limits.MESSAGES_PER_SECOND < lines.size(); first++) {
			Duration span = Duration.ofNanos(lines.get(first + Limits.MESSAGES_PER_SECOND).nanos() - lines.get(first).nanos());
			assertTrue(span.compareTo(Limits.MESSAGE_WINDOW) >= 0, "21 messages within " + span + " from line " + first);
		}
	}

	@Test
	void theOutgoingQueueHoldsSixtyFourFramesBesidesTheOneBeingWritten() throws InterruptedException {
		start(patient());
		socket.feedLine(WELCOME);
		Await.until("welcome", () -> !welcomes.isEmpty());
		socket.blockWrites();
		connection.offer(new ModFrame.LanClosed());
		Thread.sleep(100);

		int accepted = 0;
		while (connection.offer(new ModFrame.LanClosed())) {
			accepted++;
		}

		assertEquals(Limits.OUTGOING_QUEUE, accepted);
	}

	@Test
	void aLineLongerThanTheModLimitIsNeverWritten() {
		start(patient());
		socket.feedLine(WELCOME);
		Await.until("welcome", () -> !welcomes.isEmpty());
		JsonObject huge = new JsonObject();
		huge.addProperty("text", "x".repeat(Limits.MOD_LINE_BYTES));

		connection.offer(new ModFrame.Req("a1", "friend.addByName", huge));
		connection.offer(new ModFrame.LanClosed());

		Await.until("the frame after it", () -> socket.writtenTexts().contains("{\"type\":\"lanClosed\"}"));
		assertTrue(socket.writtenTexts().stream().noneMatch(text -> text.contains("friend.addByName")));
	}

	@Test
	void requestTimeoutsAreCheckedOnTheHousekeepingBeat() {
		FakeClock requestClock = new FakeClock();
		RequestManager requests = new RequestManager(mainThread, requestClock, frame -> Delivery.QUEUED);
		Request<Done> request = requests.start(Ops.hostStop());
		requestClock.advance(Limits.REQUEST_TIMEOUT.plusSeconds(1));

		start(patient(), requests);

		Await.until("the request timed out", () -> {
			mainThread.runPending();
			return request.reply().isDone();
		});
	}

	private void awaitNotice() {
		Await.until("notice", () -> {
			mainThread.runPending();
			return !heard.isEmpty();
		});
	}

	private void awaitEnd() throws IOException {
		try {
			served.get(5, TimeUnit.SECONDS);
		} catch (ExecutionException failed) {
			if (failed.getCause() instanceof IOException io) {
				throw io;
			}
			throw new IllegalStateException(failed.getCause());
		} catch (InterruptedException | TimeoutException other) {
			throw new IllegalStateException(other);
		}
	}

	private void start(TestTiming timing) {
		start(timing, new RequestManager(mainThread, MonotonicClock.SYSTEM, frame -> Delivery.QUEUED));
	}

	private void start(TestTiming timing, RequestManager requests) {
		Inbox inbox = new Inbox(requests, new TopicStore(), mainThread, reason -> { });
		inbox.addListener(new BridgeListener() {
			@Override
			public void notice(NotifyKind kind, Optional<String> name) {
				heard.add(kind + " " + name.orElse("-"));
			}
		});
		connection = new Connection(socket, HELLO, timing.toTiming(), MonotonicClock.SYSTEM, inbox, new Connection.Events() {
			@Override
			public void welcomed(Welcome welcome) {
				welcomes.add(welcome);
			}

			@Override
			public void rejected(RejectReason reason) {
				rejections.add(reason);
			}
		});
		served = new CompletableFuture<>();
		Thread thread = new Thread(this::serveAndReport, "connection under test");
		thread.setDaemon(true);
		thread.start();
	}

	private void serveAndReport() {
		try {
			connection.serve();
			served.complete(null);
		} catch (IOException | RuntimeException failure) {
			served.completeExceptionally(failure);
		}
	}

	/** Pings every 50 ms and gives up on a silent launcher after 300 ms. */
	private static TestTiming fastPings() {
		return new TestTiming(Duration.ofMillis(50), Duration.ofMillis(300), Duration.ofSeconds(5));
	}

	/** Own pings and silence limit are far away, so only what the test provokes can end the connection. */
	private static TestTiming patient() {
		return new TestTiming(Duration.ofSeconds(30), Duration.ofSeconds(30), Duration.ofSeconds(5));
	}

	/** The times a test varies; the rest of {@link Timing} is fixed. */
	private record TestTiming(Duration ping, Duration silence, Duration stall) {
		TestTiming withStall(Duration other) {
			return new TestTiming(ping, silence, other);
		}

		Timing toTiming() {
			return new Timing(Duration.ofSeconds(1), ping, silence, stall, Duration.ofMillis(10), Duration.ofSeconds(1),
				pause -> { });
		}
	}
}
