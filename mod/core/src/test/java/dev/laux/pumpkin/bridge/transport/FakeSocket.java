package dev.laux.pumpkin.bridge.transport;

import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.io.OutputStream;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * A socket without a network: the test feeds the lines the launcher "sends", reads the lines the mod wrote with the time
 * each was written, and can make writes hang like a launcher that stopped reading.
 */
final class FakeSocket extends Socket {
	private static final int END_OF_STREAM = -1;

	private final LinkedBlockingQueue<Integer> incoming = new LinkedBlockingQueue<>();
	private final List<WrittenLine> written = new ArrayList<>();
	private final StringBuilder partialLine = new StringBuilder();
	private volatile int readTimeoutMillis;
	private volatile boolean writesBlocked;
	private volatile boolean closed;
	// Like a real stream, the end stays the end however often it is read.
	private volatile boolean endReached;

	record WrittenLine(long nanos, String text) {
	}

	void feedLine(String line) {
		for (byte next : (line + "\n").getBytes(StandardCharsets.UTF_8)) {
			incoming.add(next & 0xFF);
		}
	}

	void feedBytes(int count, char filler) {
		for (int index = 0; index < count; index++) {
			incoming.add((int) filler);
		}
	}

	void endInput() {
		incoming.add(END_OF_STREAM);
	}

	void blockWrites() {
		writesBlocked = true;
	}

	synchronized List<WrittenLine> writtenLines() {
		return List.copyOf(written);
	}

	synchronized List<String> writtenTexts() {
		return written.stream().map(WrittenLine::text).toList();
	}

	@Override
	public void setSoTimeout(int timeout) {
		readTimeoutMillis = timeout;
	}

	@Override
	public InputStream getInputStream() {
		return new InputStream() {
			@Override
			public int read() throws IOException {
				if (endReached) {
					return END_OF_STREAM;
				}
				try {
					Integer next = incoming.poll(readTimeoutMillis, TimeUnit.MILLISECONDS);
					if (closed) {
						throw new IOException("socket closed");
					}
					if (next == null) {
						throw new SocketTimeoutException("read timed out");
					}
					endReached = next == END_OF_STREAM;
					return next;
				} catch (InterruptedException interrupted) {
					throw new InterruptedIOException();
				}
			}
		};
	}

	@Override
	public OutputStream getOutputStream() {
		return new OutputStream() {
			@Override
			public void write(int value) throws IOException {
				waitWhileBlocked();
				record((char) (value & 0xFF));
			}

			private void waitWhileBlocked() throws IOException {
				try {
					while (writesBlocked && !closed) {
						Thread.sleep(5);
					}
				} catch (InterruptedException interrupted) {
					throw new InterruptedIOException();
				}
				if (closed) {
					throw new IOException("socket closed");
				}
			}
		};
	}

	@Override
	public void close() {
		closed = true;
	}

	private synchronized void record(char value) {
		if (value == '\n') {
			written.add(new WrittenLine(System.nanoTime(), new String(partialLine.toString().getBytes(StandardCharsets.ISO_8859_1),
				StandardCharsets.UTF_8)));
			partialLine.setLength(0);
		} else {
			partialLine.append(value);
		}
	}
}
