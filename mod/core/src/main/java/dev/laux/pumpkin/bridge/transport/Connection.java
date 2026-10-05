package dev.laux.pumpkin.bridge.transport;

import dev.laux.pumpkin.bridge.protocol.FrameCodec;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Ping;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Pong;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Reject;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Welcome;
import dev.laux.pumpkin.bridge.protocol.Limits;
import dev.laux.pumpkin.bridge.protocol.ModFrame;
import dev.laux.pumpkin.bridge.protocol.Protocol;
import dev.laux.pumpkin.bridge.protocol.RejectReason;
import dev.laux.pumpkin.bridge.runtime.MonotonicClock;
import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * One connection to the launcher, from {@code hello} to its end. The thread that calls {@link #serve()} reads, watches the
 * clock (silence, a stalled write, request timeouts) and answers pings; once the launcher has sent {@code welcome} a second
 * thread writes the outgoing queue with the send budget, and a {@code ping} when the queue was empty for a ping period.
 */
final class Connection {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_bridge");
	private static final long NOT_WRITING = Long.MIN_VALUE;
	/** The launcher counts messages in its own second; this slack keeps timer jitter from squeezing 21 into one of them. */
	private static final Duration SEND_WINDOW = Limits.MESSAGE_WINDOW.plusMillis(100);
	private static final String WRITER_THREAD_NAME = "Pumpkin Bridge bridge writer";

	/** What the owner of the connection learns from the handshake. Called on the thread of {@link #serve()}. */
	interface Events {
		void welcomed(Welcome welcome);

		void rejected(RejectReason reason);
	}

	private final Socket socket;
	private final ModFrame.Hello hello;
	private final Timing timing;
	private final MonotonicClock clock;
	private final Inbox inbox;
	private final Events events;
	private final BlockingQueue<ModFrame> outgoing = new ArrayBlockingQueue<>(Limits.OUTGOING_QUEUE);
	private final SendBudget budget = new SendBudget(Limits.MESSAGES_PER_SECOND, SEND_WINDOW.toNanos());
	private OutputStream out;
	private Thread writer;
	private boolean welcomed;
	private boolean finished;
	private long lastHeardNanos;
	private volatile long writeStartedNanos = NOT_WRITING;

	Connection(Socket socket, ModFrame.Hello hello, Timing timing, MonotonicClock clock, Inbox inbox, Events events) {
		this.socket = socket;
		this.hello = hello;
		this.timing = timing;
		this.clock = clock;
		this.inbox = inbox;
		this.events = events;
	}

	/** Queues a frame for the writer; {@code false} when the queue of 64 is full. */
	boolean offer(ModFrame frame) {
		return outgoing.offer(frame);
	}

	/** Runs until the launcher refuses or closes, goes silent, stops reading, or an I/O error ends the connection. */
	void serve() throws IOException {
		socket.setSoTimeout((int) timing.housekeepingPeriod().toMillis());
		out = socket.getOutputStream();
		lastHeardNanos = clock.nanos();
		write(hello);
		LineReader reader = new LineReader(new BufferedInputStream(socket.getInputStream()), Limits.LAUNCHER_LINE_BYTES);
		try {
			while (!finished) {
				readOneLine(reader);
				checkLiveness();
			}
		} finally {
			if (writer != null) {
				writer.interrupt();
			}
		}
	}

	private void readOneLine(LineReader reader) throws IOException {
		try {
			String line = reader.next();
			lastHeardNanos = clock.nanos();
			FrameCodec.decode(line).ifPresent(this::handle);
		} catch (SocketTimeoutException nothingYet) {
			// The read timeout is the housekeeping beat: partial input stays in the reader.
		}
	}

	private void handle(LauncherFrame frame) {
		if (frame instanceof Welcome welcome) {
			acceptWelcome(welcome);
		} else if (frame instanceof Reject reject) {
			refuse(reject.reason());
		} else if (frame instanceof Ping) {
			outgoing.offer(new ModFrame.Pong());
		} else if (welcomed && !(frame instanceof Pong)) {
			inbox.deliver(frame);
		}
	}

	private void acceptWelcome(Welcome welcome) {
		if (welcomed) {
			return;
		}
		if (welcome.protocol() != Protocol.VERSION) {
			refuse(RejectReason.PROTOCOL);
			return;
		}
		welcomed = true;
		writer = new Thread(this::writeQueued, WRITER_THREAD_NAME);
		writer.setDaemon(true);
		writer.start();
		events.welcomed(welcome);
	}

	private void refuse(RejectReason reason) {
		if (!welcomed) {
			finished = true;
			events.rejected(reason);
		}
	}

	private void checkLiveness() throws IOException {
		long now = clock.nanos();
		if (now - lastHeardNanos >= timing.silence().toNanos()) {
			throw new IOException("The launcher has been silent for " + timing.silence());
		}
		long writeStarted = writeStartedNanos;
		if (writeStarted != NOT_WRITING && now - writeStarted >= timing.writeStall().toNanos()) {
			throw new IOException("The launcher has not read for " + timing.writeStall());
		}
		inbox.tick();
	}

	private void writeQueued() {
		try {
			while (true) {
				ModFrame frame = outgoing.poll(timing.pingInterval().toNanos(), TimeUnit.NANOSECONDS);
				pace();
				write(frame == null ? new ModFrame.Ping() : frame);
			}
		} catch (InterruptedException connectionEnded) {
			Thread.currentThread().interrupt();
		} catch (IOException writeFailed) {
			LOG.debug("Pumpkin Bridge: write to the launcher failed: {}", writeFailed.getMessage());
			closeSocket();
		}
	}

	private void pace() throws InterruptedException {
		long wait = budget.reserve(clock.nanos());
		if (wait > 0) {
			TimeUnit.NANOSECONDS.sleep(wait);
		}
	}

	private void write(ModFrame frame) throws IOException {
		byte[] line = (FrameCodec.encode(frame) + "\n").getBytes(StandardCharsets.UTF_8);
		if (line.length > Limits.MOD_LINE_BYTES) {
			LOG.warn("Pumpkin Bridge: dropped a {} line of {} bytes, the limit is {}", frame.type(), line.length,
				Limits.MOD_LINE_BYTES);
			return;
		}
		writeStartedNanos = clock.nanos();
		out.write(line);
		out.flush();
		writeStartedNanos = NOT_WRITING;
	}

	private void closeSocket() {
		try {
			socket.close();
		} catch (IOException ignored) {
			// Closing a socket that is already failing changes nothing: the connection is gone either way.
		}
	}
}
