package dev.laux.pumpkin.friends.protocol;

import static dev.laux.pumpkin.friends.Fixtures.Direction.LAUNCHER_TO_MOD;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import dev.laux.pumpkin.friends.Fixtures;
import dev.laux.pumpkin.friends.Fixtures.Line;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Response;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/** errors.jsonl: one answer for every error code. */
class ErrorFixturesTest {
	private static final List<Line> ERRORS = Fixtures.read("errors.jsonl", LAUNCHER_TO_MOD);

	@Test
	void everyFixtureErrorDecodesToAKnownCodeWithItsWireName() {
		for (Line line : ERRORS) {
			Response response = (Response) FrameCodec.decode(line.wire()).orElseThrow();

			String wire = line.message().getAsJsonObject("error").get("code").getAsString();
			assertEquals(wire, response.error().orElseThrow().code().wireName(), line.id());
			assertFalse(response.error().orElseThrow().code() == ErrorCode.UNRECOGNIZED, wire);
		}
	}

	@Test
	void theFixturesCoverEveryCodeTheLauncherCanSendAndNothingElse() {
		Set<ErrorCode> shown = ERRORS.stream().map(line -> ((Response) FrameCodec.decode(line.wire()).orElseThrow()).error()
			.orElseThrow().code()).collect(Collectors.toSet());

		Set<ErrorCode> sendable = Arrays.stream(ErrorCode.values()).filter(ErrorCode::travels).collect(Collectors.toSet());
		assertEquals(sendable, shown);
	}

	@Test
	void parametersArriveAsText() {
		Map<String, OpError> byId = ERRORS.stream().collect(Collectors.toMap(Line::id,
			line -> ((Response) FrameCodec.decode(line.wire()).orElseThrow()).error().orElseThrow()));

		assertEquals("7", byId.get("e03").param("max").orElseThrow());
		assertEquals("1.20", byId.get("e07").param("min").orElseThrow());
		assertEquals(Map.of(), byId.get("e01").params());
	}

	@Test
	void aCodeFromAnewerLauncherIsRecognisedAsUnknownNotAsOneOfOurs() {
		String line = "{\"type\":\"res\",\"id\":\"x1\",\"ok\":false,\"error\":{\"code\":\"somethingNew\",\"params\":{}}}";

		Response response = (Response) FrameCodec.decode(line).orElseThrow();

		assertEquals(ErrorCode.UNRECOGNIZED, response.error().orElseThrow().code());
	}

	@Test
	void theLocalCodeNeverComesFromTheWire() {
		String line = "{\"type\":\"res\",\"id\":\"x1\",\"ok\":false,\"error\":{\"code\":\"disconnected\"}}";

		Response response = (Response) FrameCodec.decode(line).orElseThrow();

		assertEquals(ErrorCode.UNRECOGNIZED, response.error().orElseThrow().code());
	}
}
