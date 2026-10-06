package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import java.util.Objects;
import dev.laux.pumpkin.bridge.runtime.Immutable;
import dev.laux.pumpkin.bridge.runtime.Whitespace;

import dev.laux.pumpkin.bridge.protocol.ScopeState;
import dev.laux.pumpkin.bridge.protocol.Scopes;
import dev.laux.pumpkin.bridge.modules.friends.state.Me;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * The lines of the read-only Optionen tab (docs/bridge/README.md, "In-game navigation and world behavior"): everything the me topic and the welcome carry about the
 * player's friends identity, nothing editable - the settings live in the launcher, and [Im Launcher öffnen] is the tab's
 * only action. A missing value (topic not pushed yet, no welcome, no identity yet) has its own dash variant instead of
 * hiding the line, so the tab's shape never changes.
 */
public final class OptionsLines {
	private final List<Line> lines;

	public OptionsLines(List<Line> lines) {
		this.lines = lines;
	}

	public List<Line> lines() {
		return lines;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof OptionsLines)) {
			return false;
		}
		OptionsLines that = (OptionsLines) other;
		return Objects.equals(lines, that.lines);
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(lines);
		return hash;
	}

	@Override
	public String toString() {
		return "OptionsLines[lines=" + lines + "]";
	}

	private static final String KEY = "pumpkin_bridge.options.";

	/** One text row: a language key and, when its format has one, the player's value. */
	public static final class Line {
		private final String key;
		private final Optional<String> argument;

		public Line(String key, Optional<String> argument) {
			this.key = key;
			this.argument = argument;
		}

		public String key() {
			return key;
		}

		public Optional<String> argument() {
			return argument;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Line)) {
				return false;
			}
			Line that = (Line) other;
			return Objects.equals(key, that.key)
				&& Objects.equals(argument, that.argument);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(key);
			hash = 31 * hash + Objects.hashCode(argument);
			return hash;
		}

		@Override
		public String toString() {
			return "Line[key=" + key + ", argument=" + argument + "]";
		}

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
		return new OptionsLines(Immutable.copyList(lines));
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
		return Whitespace.isBlank(displayName) ? Line.plain(absent) : Line.valued(present, displayName);
	}

	private static Line valued(String present, String absent, Optional<String> value) {
		return value.map(found -> Line.valued(present, found)).orElseGet(() -> Line.plain(absent));
	}
}
