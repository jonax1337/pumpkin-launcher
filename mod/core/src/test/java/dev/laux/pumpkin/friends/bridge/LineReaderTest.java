package dev.laux.pumpkin.friends.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import dev.laux.pumpkin.friends.bridge.LineReader.OversizedLineException;
import java.io.ByteArrayInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;
import org.junit.jupiter.api.Test;

class LineReaderTest {
	@Test
	void readsLinesWithoutTheirLineEnding() throws IOException {
		LineReader reader = readerOf("first\nsecond\r\nthird\n", 100);

		assertEquals("first", reader.next());
		assertEquals("second", reader.next());
		assertEquals("third", reader.next());
	}

	@Test
	void aLineOfExactlyTheLimitIncludingItsLineEndingIsAccepted() throws IOException {
		LineReader reader = readerOf("x".repeat(15) + "\n", 16);

		assertEquals(15, reader.next().length());
	}

	@Test
	void aLineOneByteOverTheLimitIsRefusedBeforeItIsBuffered() {
		LineReader reader = readerOf("x".repeat(16) + "\n", 16);

		assertThrows(OversizedLineException.class, reader::next);
	}

	@Test
	void aLineThatNeverEndsIsRefusedAtTheLimit() {
		LineReader reader = readerOf("y".repeat(1000), 64);

		assertThrows(OversizedLineException.class, reader::next);
	}

	@Test
	void endOfStreamBeforeALineEndingIsEndOfFile() {
		assertThrows(EOFException.class, () -> readerOf("half a line", 100).next());
	}

	@Test
	void multibyteCharactersSurviveTheDecoding() throws IOException {
		assertEquals("Grüße ☃", readerOf("Grüße ☃\n", 100).next());
	}

	@Test
	void aReadTimeoutInTheMiddleOfALineLosesNothing() throws IOException {
		StutteringInput input = new StutteringInput("hel", "", "lo\nnext\n");
		LineReader reader = new LineReader(input, 100);

		assertThrows(SocketTimeoutException.class, reader::next);
		assertEquals("hello", reader.next());
		assertEquals("next", reader.next());
	}

	private static LineReader readerOf(String text, int limit) {
		return new LineReader(new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)), limit);
	}

	/** Delivers its chunks in order; an empty chunk makes the next read time out. */
	private static final class StutteringInput extends InputStream {
		private final Deque<byte[]> chunks = new ArrayDeque<>();
		private int offset;

		StutteringInput(String... chunks) {
			for (String chunk : chunks) {
				this.chunks.add(chunk.getBytes(StandardCharsets.UTF_8));
			}
		}

		@Override
		public int read() throws IOException {
			if (chunks.isEmpty()) {
				return -1;
			}
			byte[] chunk = chunks.peekFirst();
			if (chunk.length == 0) {
				chunks.pollFirst();
				throw new SocketTimeoutException("read timed out");
			}
			int next = chunk[offset++];
			if (offset == chunk.length) {
				chunks.pollFirst();
				offset = 0;
			}
			return next;
		}
	}
}
