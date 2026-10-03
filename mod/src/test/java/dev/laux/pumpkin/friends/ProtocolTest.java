package dev.laux.pumpkin.friends;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.laux.pumpkin.friends.bridge.Messages;
import dev.laux.pumpkin.friends.bridge.Protocol;
import java.io.ByteArrayInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class ProtocolTest {
	@Test
	void encodesTheHelloOfSection72() {
		String line = Protocol.encode(new Messages.Hello(List.of(1), "ab".repeat(32), "0.1.0", "26.3"));

		assertEquals("{\"type\":\"hello\",\"protocols\":[1],\"token\":\"" + "ab".repeat(32)
			+ "\",\"mod\":\"0.1.0\",\"minecraft\":\"26.3\"}", line);
	}

	@Test
	void encodesThePing() {
		assertEquals("{\"type\":\"ping\"}", Protocol.encode(new Messages.Ping()));
	}

	@Test
	void decodesWelcomeAndReject() {
		assertEquals(Optional.of(new Messages.Welcome(1, "0.2.0")),
			Protocol.decode("{\"type\":\"welcome\",\"protocol\":1,\"launcher\":\"0.2.0\"}"));
		assertEquals(Optional.of(new Messages.Reject("duplicate")),
			Protocol.decode("{\"type\":\"reject\",\"reason\":\"duplicate\"}"));
	}

	@Test
	void decodesASnapshot() {
		Optional<Messages.Inbound> decoded = Protocol.decode("{\"type\":\"snapshot\","
			+ "\"friends\":[{\"id\":\"f1\",\"name\":\"Alex\",\"mcUuid\":null,\"presence\":\"online\"}],"
			+ "\"session\":{\"guests\":[{\"id\":\"f1\",\"name\":\"Alex\",\"state\":\"invited\"}]},"
			+ "\"invites\":[{\"id\":\"i1\",\"fromName\":\"Bob\",\"title\":\"Insel\"}]}");

		assertEquals(Optional.of(new Messages.SnapshotUpdate(
			List.of(new Messages.Friend("f1", "Alex", null, "online")),
			new Messages.Session(List.of(new Messages.Guest("f1", "Alex", "invited"))),
			List.of(new Messages.Invite("i1", "Bob", "Insel")))), decoded);
	}

	@Test
	void decodesNotifyErrorAndPong() {
		assertEquals(Optional.of(new Messages.Notify("friendOnline", "Alex", null)),
			Protocol.decode("{\"type\":\"notify\",\"event\":\"friendOnline\",\"name\":\"Alex\",\"mcUuid\":null}"));
		assertEquals(Optional.of(new Messages.ErrorReport("busy", "r1")),
			Protocol.decode("{\"type\":\"error\",\"code\":\"busy\",\"ref\":\"r1\"}"));
		assertEquals(Optional.of(new Messages.Pong()), Protocol.decode("{\"type\":\"pong\"}"));
	}

	@Test
	void ignoresUnknownFields() {
		assertEquals(Optional.of(new Messages.Pong()), Protocol.decode("{\"type\":\"pong\",\"later\":true}"));
	}

	@ParameterizedTest
	@ValueSource(strings = {"", "null", "not json", "[1]", "{}", "{\"type\":3}", "{\"type\":\"ping\"}",
		"{\"type\":\"welcome\",\"protocol\":\"eins\"}", "{\"type\":\"snapshot\",\"friends\":{}}"})
	void malformedOrUnknownLinesDecodeToNothing(String line) {
		assertTrue(Protocol.decode(line).isEmpty());
	}

	@Test
	void readsLinesWithoutTheLineBreak() throws IOException {
		InputStream in = stream("{\"type\":\"pong\"}\n{}\n");

		assertEquals("{\"type\":\"pong\"}", Protocol.readLine(in));
		assertEquals("{}", Protocol.readLine(in));
		assertThrows(EOFException.class, () -> Protocol.readLine(in));
	}

	@Test
	void acceptsALineOfExactlyTheLimit() throws IOException {
		String line = "x".repeat(Protocol.MAX_LINE_BYTES);

		assertEquals(line, Protocol.readLine(stream(line + "\n")));
	}

	@Test
	void refusesALineOverTheLimit() {
		InputStream in = stream("x".repeat(Protocol.MAX_LINE_BYTES + 1) + "\n");

		assertThrows(Protocol.OversizedLineException.class, () -> Protocol.readLine(in));
	}

	@Test
	void countsTheLimitInBytesNotCharacters() {
		InputStream in = stream("ä".repeat(Protocol.MAX_LINE_BYTES / 2 + 1) + "\n");

		assertThrows(Protocol.OversizedLineException.class, () -> Protocol.readLine(in));
	}

	private static InputStream stream(String text) {
		return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8));
	}
}
