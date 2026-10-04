package dev.laux.pumpkin.friends.request;

import static dev.laux.pumpkin.friends.Fixtures.Direction.LAUNCHER_TO_MOD;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import dev.laux.pumpkin.friends.FakeClock;
import dev.laux.pumpkin.friends.Fixtures;
import dev.laux.pumpkin.friends.ManualMainThread;
import dev.laux.pumpkin.friends.protocol.ErrorCode;
import dev.laux.pumpkin.friends.protocol.FrameCodec;
import dev.laux.pumpkin.friends.protocol.LauncherFrame;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Pending;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Response;
import dev.laux.pumpkin.friends.protocol.Limits;
import dev.laux.pumpkin.friends.protocol.OpError;
import dev.laux.pumpkin.friends.protocol.ModFrame.Req;
import dev.laux.pumpkin.friends.protocol.Protocol;
import dev.laux.pumpkin.friends.protocol.Scope;
import dev.laux.pumpkin.friends.request.RequestManager.Delivery;
import dev.laux.pumpkin.friends.request.Results.Done;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** Request ids, answers, local errors and timeouts, with a clock and a main thread that the test moves by hand. */
class RequestManagerTest {
	private final FakeClock clock = new FakeClock();
	private final ManualMainThread mainThread = new ManualMainThread();
	private final List<Req> sent = new ArrayList<>();
	private Delivery delivery = Delivery.QUEUED;
	private final RequestManager manager = new RequestManager(mainThread, clock, frame -> {
		if (delivery == Delivery.QUEUED) {
			sent.add((Req) frame);
		}
		return delivery;
	});

	@Test
	void idsAreBase36CountersThatTheLauncherAccepts() {
		for (int count = 0; count < 40; count++) {
			manager.start(Ops.stateSync());
			manager.onResponse(success(sent.get(count).id()));
		}

		assertEquals("0", sent.get(0).id());
		assertEquals("a", sent.get(10).id());
		assertEquals("10", sent.get(36).id());
		assertTrue(sent.stream().allMatch(request -> Protocol.isValidRequestId(request.id())));
		assertEquals(40, sent.stream().map(Req::id).distinct().count());
	}

	@Test
	void theAnswerWithTheMatchingIdCompletesTheRequestOnTheMainThread() {
		Request<Done> request = manager.start(Ops.hostStop());

		manager.onResponse(success(sent.get(0).id()));

		assertFalse(request.reply().isDone(), "nothing happens before the main thread runs");
		mainThread.runPending();
		assertEquals(new Reply.Success<>(Done.DONE), request.reply().join());
	}

	@Test
	void anErrorAnswerCarriesTheCodeAndItsParameters() {
		Request<Done> request = manager.start(Ops.hostInvite(List.of("f1"), false));
		String id = sent.get(0).id();

		manager.onResponse(response("{\"type\":\"res\",\"id\":\"" + id
			+ "\",\"ok\":false,\"error\":{\"code\":\"guestLimit\",\"params\":{\"max\":7}}}"));

		mainThread.runPending();
		OpError error = request.reply().join().error().orElseThrow();
		assertEquals(ErrorCode.GUEST_LIMIT, error.code());
		assertEquals("7", error.param("max").orElseThrow());
	}

	@Test
	void theResultIsReadWithTheReaderOfTheOperation() {
		Request<Results.JoinHere> request = manager.start(Ops.inviteJoinHere("i1"));

		manager.onResponse(response("{\"type\":\"res\",\"id\":\"" + sent.get(0).id()
			+ "\",\"ok\":true,\"result\":{\"host\":\"127.1.2.3\",\"port\":25565}}"));

		mainThread.runPending();
		assertEquals(new Reply.Success<>(new Results.JoinHere("127.1.2.3", 25565)), request.reply().join());
	}

	@Test
	void aResultThatDoesNotFitItsOperationIsAnInternalError() {
		Request<Results.JoinHere> request = manager.start(Ops.inviteJoinHere("i1"));

		manager.onResponse(success(sent.get(0).id()));

		mainThread.runPending();
		assertEquals(ErrorCode.INTERNAL, request.reply().join().error().orElseThrow().code());
	}

	@Test
	void anAnswerWithAnUnknownIdOrAFinishedIdChangesNothing() {
		Request<Done> request = manager.start(Ops.hostStop());
		manager.onResponse(success("zz"));
		manager.onResponse(success(sent.get(0).id()));
		manager.onResponse(success(sent.get(0).id()));

		assertEquals(1, mainThread.runPending(), "exactly one completion was posted");
		assertTrue(request.reply().isDone());
	}

	@Test
	void aQuickOperationTimesOutAfterFifteenSeconds() {
		Request<Done> request = manager.start(Ops.hostStop());

		clock.advance(Limits.REQUEST_TIMEOUT.minusMillis(1));
		manager.expireOverdue();
		mainThread.runPending();
		assertFalse(request.reply().isDone());

		clock.advance(Duration.ofMillis(1));
		manager.expireOverdue();
		mainThread.runPending();
		assertEquals(ErrorCode.TIMEOUT, request.reply().join().error().orElseThrow().code());
	}

	@Test
	void aSlowOperationWaitsThirtySeconds() {
		Request<Done> request = manager.start(Ops.friendAddByName("Notch"));

		clock.advance(Duration.ofSeconds(29));
		manager.expireOverdue();
		mainThread.runPending();
		assertFalse(request.reply().isDone());

		clock.advance(Duration.ofSeconds(1));
		manager.expireOverdue();
		mainThread.runPending();
		assertEquals(ErrorCode.TIMEOUT, request.reply().join().error().orElseThrow().code());
	}

	@Test
	void afterPendingTheModWaitsOneHundredAndThirtySecondsFromThatMoment() {
		Request<Done> request = manager.start(Ops.hostInvite(List.of("f1"), false));
		clock.advance(Duration.ofSeconds(20));
		manager.onPending(new Pending(sent.get(0).id(), Scope.SHARE));

		clock.advance(Duration.ofSeconds(129));
		manager.expireOverdue();
		mainThread.runPending();
		assertFalse(request.reply().isDone(), "129 s after pending");

		clock.advance(Duration.ofSeconds(1));
		manager.expireOverdue();
		mainThread.runPending();
		assertEquals(ErrorCode.TIMEOUT, request.reply().join().error().orElseThrow().code());
	}

	@Test
	void pendingTellsTheRequestWhichScopeTheLauncherAsksAbout() {
		Request<Done> request = manager.start(Ops.friendAddByName("Notch"));
		List<Scope> told = new ArrayList<>();
		request.whenPending(told::add);

		manager.onPending(new Pending(sent.get(0).id(), Scope.SOCIAL));

		assertTrue(manager.isAwaitingLauncherDialog());
		mainThread.runPending();
		assertEquals(List.of(Scope.SOCIAL), told);
		assertEquals(Optional.of(Scope.SOCIAL), request.awaitedScope());
	}

	@Test
	void aListenerAddedAfterPendingHearsOfItAtOnce() {
		Request<Done> request = manager.start(Ops.friendAddByName("Notch"));
		manager.onPending(new Pending(sent.get(0).id(), Scope.SOCIAL));
		mainThread.runPending();
		List<Scope> told = new ArrayList<>();

		request.whenPending(told::add);

		assertEquals(List.of(Scope.SOCIAL), told);
	}

	@Test
	void afterTheFinalAnswerNobodyAwaitsTheDialogAnymore() {
		Request<Done> request = manager.start(Ops.friendAddByName("Notch"));
		manager.onPending(new Pending(sent.get(0).id(), Scope.SOCIAL));

		manager.onResponse(success(sent.get(0).id()));

		mainThread.runPending();
		assertFalse(manager.isAwaitingLauncherDialog());
		assertEquals(Optional.empty(), request.awaitedScope());
	}

	@Test
	void theNinthRequestInFlightIsAnsweredBusyWithoutBeingSent() {
		for (int count = 0; count < Limits.MAX_IN_FLIGHT; count++) {
			manager.start(Ops.stateSync());
		}

		Request<Done> ninth = manager.start(Ops.stateSync());

		mainThread.runPending();
		assertEquals(ErrorCode.BUSY, ninth.reply().join().error().orElseThrow().code());
		assertEquals(Limits.MAX_IN_FLIGHT, sent.size());
	}

	@Test
	void aFreedSlotLetsTheNextRequestThrough() {
		for (int count = 0; count < Limits.MAX_IN_FLIGHT; count++) {
			manager.start(Ops.stateSync());
		}
		manager.onResponse(success(sent.get(3).id()));

		Request<Done> next = manager.start(Ops.stateSync());

		mainThread.runPending();
		assertFalse(next.reply().isDone(), "it waits for the launcher like any other");
		assertEquals(Limits.MAX_IN_FLIGHT + 1, sent.size());
	}

	@Test
	void aTimedOutRequestFreesItsSlot() {
		for (int count = 0; count < Limits.MAX_IN_FLIGHT; count++) {
			manager.start(Ops.stateSync());
		}
		clock.advance(Limits.REQUEST_TIMEOUT);
		manager.expireOverdue();

		manager.start(Ops.stateSync());

		assertEquals(Limits.MAX_IN_FLIGHT + 1, sent.size());
	}

	@Test
	void aRequestThatDoesNotFitOneLineIsBadRequestAndNeverSent() {
		JsonObject huge = new JsonObject();
		huge.addProperty("text", "x".repeat(Limits.MOD_LINE_BYTES));

		Request<Done> request = manager.start(new Op<>("friend.addByName", huge, Limits.REQUEST_TIMEOUT, fields -> Done.DONE));

		mainThread.runPending();
		assertEquals(ErrorCode.BAD_REQUEST, request.reply().join().error().orElseThrow().code());
		assertTrue(sent.isEmpty());
	}

	@Test
	void aRequestThatFitsExactlyOneLineIsSent() {
		JsonObject args = new JsonObject();
		args.addProperty("text", "");
		int overhead = FrameCodec.encode(new Req("0", "x", args)).length() + 1;
		args.addProperty("text", "y".repeat(Limits.MOD_LINE_BYTES - overhead));

		manager.start(new Op<>("x", args, Limits.REQUEST_TIMEOUT, fields -> Done.DONE));

		assertEquals(1, sent.size());
	}

	@Test
	void withoutALinkARequestFailsAsDisconnected() {
		delivery = Delivery.NOT_CONNECTED;

		Request<Done> request = manager.start(Ops.hostStop());

		mainThread.runPending();
		assertEquals(ErrorCode.DISCONNECTED, request.reply().join().error().orElseThrow().code());
		assertFalse(manager.isAwaitingLauncherDialog());
	}

	@Test
	void aFullOutgoingQueueIsBusy() {
		delivery = Delivery.QUEUE_FULL;

		Request<Done> request = manager.start(Ops.hostStop());

		mainThread.runPending();
		assertEquals(ErrorCode.BUSY, request.reply().join().error().orElseThrow().code());
	}

	@Test
	void aRefusedRequestDoesNotUseUpASlot() {
		delivery = Delivery.QUEUE_FULL;
		for (int count = 0; count < Limits.MAX_IN_FLIGHT + 2; count++) {
			manager.start(Ops.stateSync());
		}
		delivery = Delivery.QUEUED;

		manager.start(Ops.stateSync());

		assertEquals(1, sent.size());
	}

	@Test
	void whenTheLinkGoesDownEveryOpenRequestFailsAsDisconnected() {
		List<Request<Done>> open = List.of(manager.start(Ops.hostStop()), manager.start(Ops.friendsRetry()));

		manager.failAll(ErrorCode.DISCONNECTED);

		mainThread.runPending();
		open.forEach(request -> assertEquals(ErrorCode.DISCONNECTED, request.reply().join().error().orElseThrow().code()));
		manager.start(Ops.stateSync());
		assertEquals(3, sent.size());
	}

	@Test
	void repliesFromTheFixturesCorrelateByTheIdTheManagerAssigned() {
		for (Fixtures.Line answer : Fixtures.read("request-response.jsonl", LAUNCHER_TO_MOD)) {
			Request<Done> request = manager.start(Ops.hostStop());
			LauncherFrame frame = FrameCodec.decode(rewriteId(answer, sent.get(sent.size() - 1).id())).orElseThrow();

			manager.onResponse((Response) frame);

			mainThread.runPending();
			assertEquals(answer.message().get("ok").getAsBoolean(), request.reply().join().error().isEmpty(), answer.id());
		}
	}

	@Test
	void aPendingFromTheFixtureFollowedByItsAnswerCompletesTheRequest() {
		List<Fixtures.Line> lines = Fixtures.read("pending.jsonl", LAUNCHER_TO_MOD);
		Request<Done> request = manager.start(Ops.hostInvite(List.of("f1", "f2"), true));
		String id = sent.get(0).id();

		manager.onPending((Pending) FrameCodec.decode(rewriteId(lines.get(0), id)).orElseThrow());
		assertTrue(manager.isAwaitingLauncherDialog());
		manager.onResponse((Response) FrameCodec.decode(rewriteId(lines.get(1), id)).orElseThrow());

		mainThread.runPending();
		assertInstanceOf(Reply.Success.class, request.reply().join());
	}

	private static Response success(String id) {
		return response("{\"type\":\"res\",\"id\":\"" + id + "\",\"ok\":true,\"result\":{}}");
	}

	private static Response response(String line) {
		return (Response) FrameCodec.decode(line).orElseThrow();
	}

	private static String rewriteId(Fixtures.Line line, String id) {
		JsonObject copy = line.message().deepCopy();
		copy.addProperty("id", id);
		return copy.toString();
	}
}
