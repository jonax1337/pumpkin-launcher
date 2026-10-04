package dev.laux.pumpkin.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.laux.pumpkin.friends.protocol.ScopeState;
import dev.laux.pumpkin.friends.protocol.Scopes;
import dev.laux.pumpkin.friends.state.Me;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * The Optionen tab is read-only and complete for R-A (INGAME 6.2): the same four lines in every state, the values of the
 * me topic and the welcome, and no line an edit could change.
 */
class OptionsLinesTest {
	@Test
	void fourLinesFromTheTopicsAndTheWelcome() {
		Me me = new Me(true, Me.Availability.AVAILABLE, Me.Network.ONLINE, Optional.of("ab12 cd34"),
			Me.Directory.ACTIVE);

		List<String> keys = OptionsLines.of(Optional.of(me), Optional.of("2.1.0"),
			Optional.of(new Scopes(ScopeState.ASK, ScopeState.ALLOW)), Optional.empty()).lines().stream()
			.map(OptionsLines.Line::key).toList();

		assertEquals(List.of("pumpkin_friends.options.launcher", "pumpkin_friends.options.fingerprint",
			"pumpkin_friends.options.network.online", "pumpkin_friends.options.actions.allow"), keys);
	}

	@Test
	void theLauncherVersionAndTheFingerprintCarryTheirValues() {
		Me me = new Me(true, Me.Availability.AVAILABLE, Me.Network.ONLINE, Optional.of("ab12 cd34"),
			Me.Directory.ACTIVE);
		List<OptionsLines.Line> lines = OptionsLines.of(Optional.of(me), Optional.of("2.1.0"), Optional.empty(),
			Optional.empty()).lines();

		assertEquals("2.1.0", lines.get(0).argument().orElseThrow());
		assertEquals("ab12 cd34", lines.get(1).argument().orElseThrow());
	}

	@Test
	void aNetworkHostTheTopicCarriesBecomesTheViaLine() {
		Me me = new Me(true, Me.Availability.AVAILABLE, Me.Network.DEGRADED, Optional.empty(), Me.Directory.ACTIVE);
		List<OptionsLines.Line> lines = OptionsLines.of(Optional.of(me), Optional.empty(), Optional.empty(),
			Optional.of("relay.example")).lines();

		assertEquals("pumpkin_friends.options.network.via", lines.get(2).key());
		assertEquals("relay.example", lines.get(2).argument().orElseThrow());
	}

	@Test
	void withoutTopicsTheLinesKeepTheirPlacesWithTheDashVariants() {
		List<String> keys = OptionsLines.of(Optional.empty(), Optional.empty(), Optional.empty(), Optional.empty())
			.lines().stream().map(OptionsLines.Line::key).toList();

		assertEquals(List.of("pumpkin_friends.options.launcher.unknown", "pumpkin_friends.options.fingerprint.unknown",
			"pumpkin_friends.options.network.unknown", "pumpkin_friends.options.actions.ask"), keys);
	}

	@Test
	void aMissingFingerprintHasItsOwnVariant() {
		Me me = new Me(true, Me.Availability.AVAILABLE, Me.Network.ONLINE, Optional.empty(), Me.Directory.ACTIVE);
		OptionsLines.Line fingerprint = OptionsLines.of(Optional.of(me), Optional.empty(), Optional.empty(),
			Optional.empty()).lines().get(1);

		assertEquals("pumpkin_friends.options.fingerprint.unknown", fingerprint.key());
	}
}
