package dev.laux.pumpkin.friends.ui.model;

import dev.laux.pumpkin.friends.protocol.ScopeState;
import dev.laux.pumpkin.friends.protocol.Scopes;
import dev.laux.pumpkin.friends.state.Me;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * The lines of the read-only Optionen tab (INGAME 6.2): everything the me topic and the welcome carry about the
 * player's friends identity, nothing editable - the settings live in the launcher, and [Im Launcher öffnen] is the tab's
 * only action. A missing value (topic not pushed yet, no welcome, no identity yet) has its own dash variant instead of
 * hiding the line, so the tab's shape never changes.
 */
public record OptionsLines(List<Line> lines) {
	private static final String KEY = "pumpkin_friends.options.";

	/** One text row: a language key and, when its format has one, the player's value. */
	public record Line(String key, Optional<String> argument) {
		static Line plain(String key) {
			return new Line(key, Optional.empty());
		}

		static Line valued(String key, String argument) {
			return new Line(key, Optional.of(argument));
		}
	}

	public static OptionsLines of(Optional<Me> me, Optional<String> launcherVersion, Optional<Scopes> scopes) {
		List<Line> lines = new ArrayList<>();
		lines.add(valued(KEY + "launcher", KEY + "launcher.unknown", launcherVersion));
		lines.add(me.map(who -> namedLine(KEY + "name", KEY + "name.unknown", who.displayName()))
			.orElseGet(() -> Line.plain(KEY + "name.unknown")));
		lines.add(me.map(who -> valued(KEY + "fingerprint", KEY + "fingerprint.unknown", who.fingerprint()))
			.orElseGet(() -> Line.plain(KEY + "fingerprint.unknown")));
		lines.add(me.map(OptionsLines::networkLine).orElseGet(() -> Line.plain(KEY + "network.unknown")));
		lines.add(me.map(who -> Line.plain(KEY + "findable." + (who.findableByName() ? "yes" : "no")))
			.orElseGet(() -> Line.plain(KEY + "findable.unknown")));
		lines.add(Line.plain(KEY + "actions." + actionsState(scopes).name().toLowerCase(Locale.ROOT)));
		return new OptionsLines(List.copyOf(lines));
	}

	/** "Verbunden über {host}" when the topic names the host, otherwise the network state. */
	private static Line networkLine(Me who) {
		return who.relayHost().map(host -> Line.valued(KEY + "network.via", host))
			.orElseGet(() -> Line.plain(KEY + "network." + who.network().name().toLowerCase(Locale.ROOT)));
	}

	private static ScopeState actionsState(Optional<Scopes> scopes) {
		return scopes.map(Scopes::social).orElse(ScopeState.ASK);
	}

	private static Line namedLine(String present, String absent, String displayName) {
		return displayName.isBlank() ? Line.plain(absent) : Line.valued(present, displayName);
	}

	private static Line valued(String present, String absent, Optional<String> value) {
		return value.map(found -> Line.valued(present, found)).orElseGet(() -> Line.plain(absent));
	}
}
