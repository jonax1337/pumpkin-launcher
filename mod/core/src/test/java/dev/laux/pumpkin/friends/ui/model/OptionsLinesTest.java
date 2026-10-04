package dev.laux.pumpkin.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.laux.pumpkin.friends.protocol.ScopeState;
import dev.laux.pumpkin.friends.protocol.Scopes;
import dev.laux.pumpkin.friends.state.Me;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * The Optionen tab is read-only and complete for R-A (INGAME 6.2): the same six lines in every state, the values of the
 * me topic and the welcome, and no line an edit could change. The me topic itself carries the display name, the name
 * findability and the relay host (A27), so no line waits for anything else.
 */
class OptionsLinesTest {
	@Test
	void sixLinesFromTheTopicsAndTheWelcome() {
		Me me = new Me(true, Me.Availability.AVAILABLE, Me.Network.ONLINE, Optional.of("ab12 cd34"),
			Me.Directory.ACTIVE, "Anna", false, Optional.empty());

		List<String> keys = OptionsLines.of(Optional.of(me), Optional.of("0.2.0"),
			Optional.of(new Scopes(ScopeState.ASK, ScopeState.ALLOW))).lines().stream()
			.map(OptionsLines.Line::key).toList();

		assertEquals(List.of("pumpkin_friends.options.launcher", "pumpkin_friends.options.name",
			"pumpkin_friends.options.fingerprint", "pumpkin_friends.options.network.online",
			"pumpkin_friends.options.findable.no", "pumpkin_friends.options.actions.allow"), keys);
	}

	@Test
	void theLauncherVersionTheNameAndTheFingerprintCarryTheirValues() {
		Me me = new Me(true, Me.Availability.AVAILABLE, Me.Network.ONLINE, Optional.of("ab12 cd34"),
			Me.Directory.ACTIVE, "Anna", false, Optional.empty());
		List<OptionsLines.Line> lines = OptionsLines.of(Optional.of(me), Optional.of("0.2.0"), Optional.empty()).lines();

		assertEquals("0.2.0", lines.get(0).argument().orElseThrow());
		assertEquals("Anna", lines.get(1).argument().orElseThrow());
		assertEquals("ab12 cd34", lines.get(2).argument().orElseThrow());
	}

	@Test
	void aRelayHostTheTopicCarriesBecomesTheViaLine() {
		Me me = new Me(true, Me.Availability.AVAILABLE, Me.Network.DEGRADED, Optional.empty(), Me.Directory.ACTIVE,
			"Anna", false, Optional.of("relay.example"));
		List<OptionsLines.Line> lines = OptionsLines.of(Optional.of(me), Optional.empty(), Optional.empty()).lines();

		assertEquals("pumpkin_friends.options.network.via", lines.get(3).key());
		assertEquals("relay.example", lines.get(3).argument().orElseThrow());
	}

	@Test
	void theFindabilityHasOneLinePerAnswer() {
		Me findable = new Me(true, Me.Availability.AVAILABLE, Me.Network.ONLINE, Optional.empty(), Me.Directory.ACTIVE,
			"Anna", true, Optional.empty());
		Me hidden = new Me(true, Me.Availability.AVAILABLE, Me.Network.ONLINE, Optional.empty(), Me.Directory.OFF,
			"Anna", false, Optional.empty());

		String yes = OptionsLines.of(Optional.of(findable), Optional.empty(), Optional.empty()).lines().get(4).key();
		String no = OptionsLines.of(Optional.of(hidden), Optional.empty(), Optional.empty()).lines().get(4).key();

		assertEquals("pumpkin_friends.options.findable.yes", yes);
		assertEquals("pumpkin_friends.options.findable.no", no);
	}

	@Test
	void withoutTopicsTheLinesKeepTheirPlacesWithTheDashVariants() {
		List<String> keys = OptionsLines.of(Optional.empty(), Optional.empty(), Optional.empty())
			.lines().stream().map(OptionsLines.Line::key).toList();

		assertEquals(List.of("pumpkin_friends.options.launcher.unknown", "pumpkin_friends.options.name.unknown",
			"pumpkin_friends.options.fingerprint.unknown", "pumpkin_friends.options.network.unknown",
			"pumpkin_friends.options.findable.unknown", "pumpkin_friends.options.actions.ask"), keys);
	}

	@Test
	void aMissingFingerprintOrNameHasItsOwnVariant() {
		Me me = new Me(true, Me.Availability.AVAILABLE, Me.Network.ONLINE, Optional.empty(), Me.Directory.ACTIVE,
			"", false, Optional.empty());
		List<OptionsLines.Line> lines = OptionsLines.of(Optional.of(me), Optional.empty(), Optional.empty()).lines();

		assertEquals("pumpkin_friends.options.name.unknown", lines.get(1).key(), "ohne Identität kein Anzeigename");
		assertEquals("pumpkin_friends.options.fingerprint.unknown", lines.get(2).key());
	}
}
