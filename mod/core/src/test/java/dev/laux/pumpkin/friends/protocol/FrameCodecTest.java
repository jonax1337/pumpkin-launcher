package dev.laux.pumpkin.friends.protocol;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Pending;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Response;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.State;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** The launcher channel is untrusted: whatever does not have the exact shape is dropped, never half-read. */
class FrameCodecTest {
	@ParameterizedTest
	@ValueSource(strings = {
		"not json", "", "[1,2]", "null", "{}", "{\"type\":7}", "{\"type\":\"futureMessage\"}",
		"{\"type\":\"welcome\",\"protocol\":2,\"launcher\":\"2.1.0\"}",
		"{\"type\":\"welcome\",\"protocol\":\"2\",\"launcher\":\"2.1.0\",\"scopes\":{\"share\":\"ask\",\"social\":\"ask\"}}",
		"{\"type\":\"welcome\",\"protocol\":2,\"launcher\":\"2.1.0\",\"scopes\":{\"share\":\"maybe\",\"social\":\"ask\"}}",
		"{\"type\":\"reject\",\"reason\":\"moon\"}",
		"{\"type\":\"res\",\"id\":\"A1\",\"ok\":true,\"result\":{}}",
		"{\"type\":\"res\",\"id\":\"abcdefghijklm\",\"ok\":true,\"result\":{}}",
		"{\"type\":\"res\",\"id\":\"a1\",\"ok\":false}",
		"{\"type\":\"res\",\"id\":\"a1\",\"ok\":\"yes\",\"result\":{}}",
		"{\"type\":\"pending\",\"id\":\"a1\",\"prompt\":\"password\",\"scope\":\"share\"}",
		"{\"type\":\"pending\",\"id\":\"a1\",\"prompt\":\"scope\",\"scope\":\"root\"}",
		"{\"type\":\"state\",\"topic\":\"weather\",\"rev\":1,\"value\":[]}",
		"{\"type\":\"state\",\"topic\":\"friends\",\"rev\":1.5,\"value\":[]}",
		"{\"type\":\"state\",\"topic\":\"friends\",\"rev\":1}"})
	void aLineThatDoesNotMatchTheProtocolIsDropped(String line) {
		assertTrue(FrameCodec.decode(line).isEmpty(), line);
	}

	@Test
	void aSuccessWithoutResultCountsAsAnEmptyResult() {
		Response response = (Response) FrameCodec.decode("{\"type\":\"res\",\"id\":\"a1\",\"ok\":true}").orElseThrow();

		assertTrue(response.result().orElseThrow().raw().entrySet().isEmpty());
	}

	@Test
	void unknownMembersAreIgnored() {
		Pending pending = (Pending) FrameCodec.decode(
			"{\"type\":\"pending\",\"id\":\"a1\",\"prompt\":\"scope\",\"scope\":\"social\",\"extra\":[1]}").orElseThrow();

		assertEquals(new Pending("a1", Scope.SOCIAL), pending);
	}

	@Test
	void aStateKeepsItsValueEvenWhenItIsJsonNull() {
		State state = (State) FrameCodec.decode("{\"type\":\"state\",\"topic\":\"session\",\"rev\":2,\"value\":null}").orElseThrow();

		assertEquals(Topic.SESSION, state.topic());
		assertEquals(2, state.rev());
		assertTrue(state.value().isJsonNull());
	}

	@Test
	void requestsEncodeInOneLineWithoutLineEndings() {
		JsonObject args = new JsonObject();
		args.addProperty("name", "line\nbreak");

		String line = FrameCodec.encode(new ModFrame.Req("a1", "friend.addByName", args));

		assertEquals("{\"type\":\"req\",\"id\":\"a1\",\"op\":\"friend.addByName\",\"args\":{\"name\":\"line\\nbreak\"}}", line);
	}
}
