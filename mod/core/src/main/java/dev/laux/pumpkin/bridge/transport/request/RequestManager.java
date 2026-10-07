package dev.laux.pumpkin.bridge.transport.request;

import dev.laux.pumpkin.bridge.protocol.json.MalformedJson;
import dev.laux.pumpkin.bridge.protocol.ErrorCode;
import dev.laux.pumpkin.bridge.protocol.FrameCodec;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Pending;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Response;
import dev.laux.pumpkin.bridge.protocol.Limits;
import dev.laux.pumpkin.bridge.protocol.ModFrame;
import dev.laux.pumpkin.bridge.runtime.MainThread;
import dev.laux.pumpkin.bridge.runtime.MonotonicClock;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.Optional;

/**
 * Matches the launcher's answers to the requests that wait for them (docs/bridge/README.md, "Protocol 2"). A request gets exactly one {@link Reply},
 * always on the main thread: the answer, {@code timeout} when none comes in time, {@code busy} for the ninth request in
 * flight, {@code disconnected} when the link is down or goes down.
 */
public final class RequestManager {
	private final MainThread mainThread;
	private final MonotonicClock clock;
	private final Transport transport;
	private final Map<String, Open<?>> open = new HashMap<>();
	private long counter;

	public RequestManager(MainThread mainThread, MonotonicClock clock, Transport transport) {
		this.mainThread = mainThread;
		this.clock = clock;
		this.transport = transport;
	}

	/** How requests leave for the launcher. */
	public interface Transport {
		Delivery offer(ModFrame frame);
	}

	public enum Delivery {
		QUEUED,
		NOT_CONNECTED,
		QUEUE_FULL
	}

	public synchronized <T> Request<T> start(Op<T> op) {
		Request<T> request = new Request<>();
		ModFrame.Req frame = new ModFrame.Req(Long.toString(counter++, Character.MAX_RADIX), op.name(), op.args());
		Optional<ErrorCode> refusal = refusalOf(frame);
		if (refusal.isPresent()) {
			finishLocally(request, refusal.get());
			return request;
		}
		open.put(frame.id(), new Open<>(op, request, clock.nanos() + op.timeout().toNanos()));
		Delivery delivery = transport.offer(frame);
		if (delivery != Delivery.QUEUED) {
			open.remove(frame.id());
			finishLocally(request, delivery == Delivery.NOT_CONNECTED ? ErrorCode.DISCONNECTED : ErrorCode.BUSY);
		}
		return request;
	}

	public void onResponse(Response response) {
		Open<?> answered;
		synchronized (this) {
			answered = open.remove(response.id());
		}
		if (answered != null) {
			answered.finish(response);
		}
	}

	/** The launcher shows a dialog: the answer may take as long as the player needs, up to the launcher's own limit. */
	public synchronized void onPending(Pending pending) {
		Open<?> waiting = open.get(pending.id());
		if (waiting != null) {
			waiting.awaitDialog(pending, clock.nanos() + Limits.TIMEOUT_AFTER_PENDING.toNanos());
		}
	}

	/** Answers every request whose time has run out with {@code timeout}. */
	public synchronized void expireOverdue() {
		long now = clock.nanos();
		for (Iterator<Open<?>> iterator = open.values().iterator(); iterator.hasNext(); ) {
			Open<?> candidate = iterator.next();
			if (now - candidate.deadlineNanos >= 0) {
				iterator.remove();
				candidate.fail(ErrorCode.TIMEOUT);
			}
		}
	}

	public synchronized void failAll(ErrorCode code) {
		open.values().forEach(request -> request.fail(code));
		open.clear();
	}

	/** Whether the launcher currently asks the player something on behalf of a request. */
	public synchronized boolean isAwaitingLauncherDialog() {
		return open.values().stream().anyMatch(request -> request.awaitingDialog);
	}

	private Optional<ErrorCode> refusalOf(ModFrame.Req frame) {
		if (!fitsOneLine(frame)) {
			return Optional.of(ErrorCode.BAD_REQUEST);
		}
		return open.size() >= Limits.MAX_IN_FLIGHT ? Optional.of(ErrorCode.BUSY) : Optional.empty();
	}

	private static boolean fitsOneLine(ModFrame frame) {
		int lineEnding = 1;
		return FrameCodec.encode(frame).getBytes(StandardCharsets.UTF_8).length + lineEnding <= Limits.MOD_LINE_BYTES;
	}

	private <T> void finishLocally(Request<T> request, ErrorCode code) {
		mainThread.execute(() -> request.complete(Reply.failure(code)));
	}

	private final class Open<T> {
		private final Op<T> op;
		private final Request<T> request;
		private long deadlineNanos;
		private boolean awaitingDialog;

		Open(Op<T> op, Request<T> request, long deadlineNanos) {
			this.op = op;
			this.request = request;
			this.deadlineNanos = deadlineNanos;
		}

		void awaitDialog(Pending pending, long newDeadlineNanos) {
			deadlineNanos = newDeadlineNanos;
			awaitingDialog = true;
			mainThread.execute(() -> request.markPending(pending.scope()));
		}

		void finish(Response response) {
			Reply<T> reply = response.error().<Reply<T>>map(error -> new Reply.Failure<T>(error)).orElseGet(() -> readResult(response));
			mainThread.execute(() -> request.complete(reply));
		}

		void fail(ErrorCode code) {
			finishLocally(request, code);
		}

		private Reply<T> readResult(Response response) {
			try {
				return new Reply.Success<>(op.resultReader().apply(response.result().get()));
			} catch (MalformedJson unreadable) {
				return Reply.failure(ErrorCode.INTERNAL);
			}
		}
	}
}
