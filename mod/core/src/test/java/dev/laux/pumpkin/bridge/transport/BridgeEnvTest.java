package dev.laux.pumpkin.bridge.transport;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.laux.pumpkin.bridge.Fixtures;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class BridgeEnvTest {
	private static final Map<String, String> VALID = Map.of(
		"PUMPKIN_IPC_PORT", "50123", "PUMPKIN_IPC_TOKEN", Fixtures.TOKEN, "PUMPKIN_IPC_PROTOCOL", "2");

	@Test
	void theLauncherEnvironmentOfProtocolTwoIsAccepted() {
		BridgeEnv env = BridgeEnv.from(VALID).orElseThrow();

		assertEquals(50123, env.port());
		assertEquals(Fixtures.TOKEN, env.token());
	}

	@ParameterizedTest
	@CsvSource({"PUMPKIN_IPC_PORT,", "PUMPKIN_IPC_TOKEN,", "PUMPKIN_IPC_PROTOCOL,"})
	void aMissingVariableMeansTheGameWasNotStartedByTheLauncher(String variable) {
		Map<String, String> environment = new HashMap<>(VALID);
		environment.remove(variable);

		assertEquals(Optional.empty(), BridgeEnv.from(environment));
	}

	@ParameterizedTest
	@CsvSource({
		"PUMPKIN_IPC_PORT,0", "PUMPKIN_IPC_PORT,70000", "PUMPKIN_IPC_PORT,abc", "PUMPKIN_IPC_TOKEN,TOO-SHORT",
		"PUMPKIN_IPC_PROTOCOL,1", "PUMPKIN_IPC_PROTOCOL,3"})
	void anInvalidVariableMeansTheSame(String variable, String value) {
		Map<String, String> environment = new HashMap<>(VALID);
		environment.put(variable, value);

		assertEquals(Optional.empty(), BridgeEnv.from(environment));
	}

	@Test
	void theTokenNeverShowsInTheTextOfTheEnvironment() {
		assertFalse(BridgeEnv.from(VALID).orElseThrow().toString().contains(Fixtures.TOKEN));
		assertTrue(BridgeEnv.from(VALID).orElseThrow().toString().contains("50123"));
	}
}
