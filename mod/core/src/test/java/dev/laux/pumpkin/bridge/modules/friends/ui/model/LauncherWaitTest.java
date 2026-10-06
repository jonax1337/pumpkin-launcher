package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import dev.laux.pumpkin.bridge.FakeClock;
import dev.laux.pumpkin.bridge.ManualMainThread;
import dev.laux.pumpkin.bridge.protocol.json.JsonFields;
import dev.laux.pumpkin.bridge.protocol.ErrorCode;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Pending;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Response;
import dev.laux.pumpkin.bridge.protocol.ModFrame.Req;
import dev.laux.pumpkin.bridge.protocol.OpError;
import dev.laux.pumpkin.bridge.protocol.Scope;
import dev.laux.pumpkin.bridge.modules.friends.protocol.Ops;
import dev.laux.pumpkin.bridge.transport.request.Request;
import dev.laux.pumpkin.bridge.transport.request.RequestManager;
import dev.laux.pumpkin.bridge.modules.friends.protocol.Results.Done;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * The wait state machine of the LauncherWaitScreen (docs/bridge/README.md, "In-game navigation and world behavior"), driven through a real {@link RequestManager}: pending,
 * answer, timeout and abort, each exactly once.
 */
class LauncherWaitTest {
	private final FakeClock clock = new FakeClock();
	private final ManualMainThread mainThread = new ManualMainThread();
	private final List<String> sentIds = new ArrayList<>();
	private final RequestManager manager = new RequestManager(mainThread, clock, frame -> {
		sentIds.add(((Req) frame).id());
		return RequestManager.Delivery.QUEUED;
	});

	@Test
	void whileNothingHappensThePlayerWaits() {
		LauncherWait wait = LauncherWait.of(request());

		assertEquals(LauncherWait.Phase.WAITING, wait.phase());
		assertFalse(wait.finished());
		assertEquals(Optional.empty(), wait.awaitedScope());
	}

	@Test
	void thePendingDialogNamesItsScopeAndTellsTheListener() {
		LauncherWait wait = LauncherWait.of(request());
		List<Scope> asked = new ArrayList<>();
		wait.whenLauncherAsks(() -> asked.add(wait.awaitedScope().orElseThrow()));

		manager.onPending(new Pending(sentIds.get(0), Scope.SOCIAL));
		mainThread.runPending();

		assertEquals(LauncherWait.Phase.WAITING, wait.phase(), "a dialog is not an answer");
		assertEquals(Optional.of(Scope.SOCIAL), wait.awaitedScope());
		assertEquals(List.of(Scope.SOCIAL), asked);
	}

	@Test
	void aListenerThatRegistersAfterTheDialogHearsOfItAtOnce() {
		LauncherWait wait = LauncherWait.of(request());
		manager.onPending(new Pending(sentIds.get(0), Scope.SHARE));
		mainThread.runPending();
		List<Scope> asked = new ArrayList<>();

		wait.whenLauncherAsks(() -> asked.add(wait.awaitedScope().orElseThrow()));

		assertEquals(List.of(Scope.SHARE), asked);
	}

	@Test
	void aSuccessfulAnswerEndsTheWaiting() {
		LauncherWait wait = LauncherWait.of(request());

		manager.onResponse(success());
		mainThread.runPending();

		assertEquals(LauncherWait.Phase.SUCCEEDED, wait.phase());
		assertTrue(wait.finished());
		assertEquals(Optional.empty(), wait.failure());
	}

	@Test
	void aFailedAnswerEndsTheWaitingWithItsError() {
		LauncherWait wait = LauncherWait.of(request());

		manager.onResponse(failure(ErrorCode.DENIED));
		mainThread.runPending();

		assertEquals(LauncherWait.Phase.FAILED, wait.phase());
		assertEquals(ErrorCode.DENIED, wait.failure().orElseThrow().code());
	}

	@Test
	void aTimeoutArrivesLikeAnyOtherFailure() {
		LauncherWait wait = LauncherWait.of(request());

		clock.advance(Ops.hostStop().timeout());
		manager.expireOverdue();
		mainThread.runPending();

		assertEquals(LauncherWait.Phase.FAILED, wait.phase());
		assertEquals(ErrorCode.TIMEOUT, wait.failure().orElseThrow().code());
	}

	@Test
	void cancellingOnlyStopsWaitingAndTheLateAnswerChangesNothing() {
		Request<Done> request = request();
		LauncherWait wait = LauncherWait.of(request);

		wait.stopWaiting();
		assertEquals(LauncherWait.Phase.STOPPED_WAITING, wait.phase());

		manager.onResponse(success());
		mainThread.runPending();

		assertEquals(LauncherWait.Phase.STOPPED_WAITING, wait.phase(), "the screen is gone; the late answer is not for it");
		assertEquals(Optional.empty(), wait.failure());
		assertTrue(request.reply().isDone(), "the operation itself ran to its answer");
	}

	@Test
	void afterAnAnswerNoSecondDialogCounts() {
		LauncherWait wait = LauncherWait.of(request());
		manager.onResponse(success());
		mainThread.runPending();

		manager.onPending(new Pending(sentIds.get(0), Scope.SOCIAL));
		mainThread.runPending();

		assertEquals(LauncherWait.Phase.SUCCEEDED, wait.phase());
		assertEquals(Optional.empty(), wait.awaitedScope());
	}

	private Request<Done> request() {
		return manager.start(Ops.hostStop());
	}

	private Response success() {
		return new Response(sentIds.get(0), Optional.of(JsonFields.of(new JsonObject())), Optional.empty());
	}

	private Response failure(ErrorCode code) {
		return new Response(sentIds.get(0), Optional.empty(), Optional.of(new OpError(code, Map.of())));
	}
}
