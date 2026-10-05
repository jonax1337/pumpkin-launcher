package dev.laux.pumpkin.bridge.transport;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;

/**
 * Reads lines of at most {@code maxLineBytes} (line ending included) without ever buffering more. A read timeout of the
 * socket interrupts {@link #next()} without losing what was already read: the next call carries on with the same line.
 */
final class LineReader {
	private final InputStream in;
	private final int maxLineBytes;
	private final ByteArrayOutputStream line = new ByteArrayOutputStream();

	LineReader(InputStream in, int maxLineBytes) {
		this.in = in;
		this.maxLineBytes = maxLineBytes;
	}

	/**
	 * The next line without its line ending.
	 *
	 * @throws SocketTimeoutException when the socket timeout passes before the line is complete
	 * @throws EOFException when the other side closed
	 * @throws OversizedLineException when the line, line ending included, is longer than the limit
	 */
	String next() throws IOException {
		for (int next = in.read(); next != '\n'; next = in.read()) {
			if (next < 0) {
				throw new EOFException("The launcher closed the connection");
			}
			line.write(next);
			if (line.size() + 1 > maxLineBytes) {
				throw new OversizedLineException(maxLineBytes);
			}
		}
		String complete = line.toString(StandardCharsets.UTF_8);
		line.reset();
		return complete.endsWith("\r") ? complete.substring(0, complete.length() - 1) : complete;
	}

	static final class OversizedLineException extends IOException {
		private static final long serialVersionUID = 1L;

		OversizedLineException(int limit) {
			super("A line from the launcher is longer than " + limit + " bytes");
		}
	}
}
