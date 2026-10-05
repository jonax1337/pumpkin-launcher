package dev.laux.pumpkin.bridge.protocol;

import static dev.laux.pumpkin.bridge.Fixtures.Direction.LAUNCHER_TO_MOD;
import static dev.laux.pumpkin.bridge.Fixtures.Direction.MOD_TO_LAUNCHER;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.laux.pumpkin.bridge.Fixtures;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Reject;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Welcome;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** handshake-ok.jsonl and the six reject-*.jsonl files. */
class HandshakeFixturesTest {
	private static final GameInfo GAME = new GameInfo("1.21.1", "neoforge", "21.1.172", 21);

	@Test
	void helloEncodesExactlyAsInTheHandshakeFixture() {
		JsonObject expected = Fixtures.only("handshake-ok.jsonl", MOD_TO_LAUNCHER).message();

		ModFrame.Hello hello = new ModFrame.Hello(Fixtures.TOKEN, "2.1.0", "0123456789abcdef", GAME);

		assertEquals(expected, JsonParser.parseString(FrameCodec.encode(hello)));
	}

	@Test
	void welcomeFromTheFixtureDecodesWithItsScopes() {
		String line = Fixtures.only("handshake-ok.jsonl", LAUNCHER_TO_MOD).wire();

		assertEquals(new Welcome(2, "2.1.0", new Scopes(ScopeState.ASK, ScopeState.ASK)), FrameCodec.decode(line).orElseThrow());
	}

	@Test
	void welcomeCarriesPreGrantedScopes() {
		String line = "{\"type\":\"welcome\",\"protocol\":2,\"launcher\":\"2.1.0\",\"scopes\":{\"share\":\"allow\",\"social\":\"ask\"}}";

		Welcome welcome = (Welcome) FrameCodec.decode(line).orElseThrow();

		assertEquals(new Scopes(ScopeState.ALLOW, ScopeState.ASK), welcome.scopes());
	}

	@ParameterizedTest
	@CsvSource({
		"reject-token.jsonl,TOKEN", "reject-protocol.jsonl,PROTOCOL", "reject-owner.jsonl,OWNER",
		"reject-build.jsonl,BUILD", "reject-duplicate.jsonl,DUPLICATE", "reject-retry.jsonl,RETRY"})
	void everyRejectFixtureDecodesToItsReason(String file, RejectReason reason) {
		String line = Fixtures.only(file, LAUNCHER_TO_MOD).wire();

		assertEquals(new Reject(reason), FrameCodec.decode(line).orElseThrow());
	}

	@ParameterizedTest
	@CsvSource({
		"reject-token.jsonl,0123456789abcdef", "reject-owner.jsonl,0123456789abcdef", "reject-duplicate.jsonl,0123456789abcdef",
		"reject-retry.jsonl,0123456789abcdef", "reject-build.jsonl,ffffffffffffffff", "reject-protocol.jsonl,0123456789abcdef"})
	void theHelloOfEveryRejectScenarioIsTheSameLineWithItsBuild(String file, String build) {
		JsonObject fixture = Fixtures.only(file, MOD_TO_LAUNCHER).message().deepCopy();
		JsonObject ours = JsonParser.parseString(FrameCodec.encode(new ModFrame.Hello(Fixtures.TOKEN, "2.1.0", build, GAME)))
			.getAsJsonObject();
		// reject-protocol.jsonl shows a mod from the future (protocol 3); this mod only ever speaks protocol 2.
		fixture.remove("protocol");
		ours.remove("protocol");

		assertEquals(fixture, ours);
	}

	@Test
	void theHelloFitsTheLineLimitThatAppliesBeforeWelcomeEvenWithLongValues() {
		GameInfo longGame = new GameInfo("26.3-pre-release-candidate-1", "neoforge", "21.1.172-beta.42+build.7", 25);
		ModFrame.Hello hello = new ModFrame.Hello(Fixtures.TOKEN, "2.1.0+26.3-fabric", "0123456789abcdef", longGame);

		int lineBytes = FrameCodec.encode(hello).length() + 1;

		assertTrue(lineBytes < Limits.PRE_WELCOME_LINE_BYTES, "hello is " + lineBytes + " bytes");
	}

	@Test
	void theTokenNeverShowsInTheTextOfAHello() {
		ModFrame.Hello hello = new ModFrame.Hello(Fixtures.TOKEN, "2.1.0", "0123456789abcdef", GAME);

		assertFalse(hello.toString().contains(Fixtures.TOKEN));
	}
}
