package dev.laux.pumpkin.bridge.protocol;

import java.util.Objects;
import dev.laux.pumpkin.bridge.runtime.Immutable;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.List;

/**
 * What the mod sends to the launcher. Each frame writes exactly the members of its wire line besides {@code type}
 * (the examples are in {@code mod/fixtures/protocol}).
 */
public interface ModFrame {
	String type();

	default void writeMembers(JsonObject line) {
	}

	public static final class Hello implements ModFrame {
		private final String token;
		private final String modVersion;
		private final String build;
		private final GameInfo game;

		public Hello(String token, String modVersion, String build, GameInfo game) {
			this.token = token;
			this.modVersion = modVersion;
			this.build = build;
			this.game = game;
		}

		public String token() {
			return token;
		}

		public String modVersion() {
			return modVersion;
		}

		public String build() {
			return build;
		}

		public GameInfo game() {
			return game;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Hello)) {
				return false;
			}
			Hello that = (Hello) other;
			return Objects.equals(token, that.token)
				&& Objects.equals(modVersion, that.modVersion)
				&& Objects.equals(build, that.build)
				&& Objects.equals(game, that.game);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(token);
			hash = 31 * hash + Objects.hashCode(modVersion);
			hash = 31 * hash + Objects.hashCode(build);
			hash = 31 * hash + Objects.hashCode(game);
			return hash;
		}


		@Override
		public String type() {
			return "hello";
		}

		@Override
		public void writeMembers(JsonObject line) {
			line.addProperty("protocol", Protocol.VERSION);
			line.addProperty("token", token);
			JsonObject mod = new JsonObject();
			mod.addProperty("version", modVersion);
			mod.addProperty("build", build);
			line.add("mod", mod);
			JsonObject gameMembers = new JsonObject();
			gameMembers.addProperty("minecraft", game.minecraft());
			gameMembers.addProperty("loader", game.loader());
			gameMembers.addProperty("loaderVersion", game.loaderVersion());
			gameMembers.addProperty("java", game.java());
			line.add("game", gameMembers);
		}

		// The token must never reach a log (SPEC 12.1).
		@Override
		public String toString() {
			return "Hello[mod=" + modVersion + ", build=" + build + ", game=" + game + "]";
		}
	}

	public static final class Req implements ModFrame {
		private final String id;
		private final String op;
		private final JsonObject args;

		public Req(String id, String op, JsonObject args) {
			this.id = id;
			this.op = op;
			this.args = args;
		}

		public String id() {
			return id;
		}

		public String op() {
			return op;
		}

		public JsonObject args() {
			return args;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Req)) {
				return false;
			}
			Req that = (Req) other;
			return Objects.equals(id, that.id)
				&& Objects.equals(op, that.op)
				&& Objects.equals(args, that.args);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(id);
			hash = 31 * hash + Objects.hashCode(op);
			hash = 31 * hash + Objects.hashCode(args);
			return hash;
		}

		@Override
		public String toString() {
			return "Req[id=" + id + ", op=" + op + ", args=" + args + "]";
		}

		@Override
		public String type() {
			return "req";
		}

		@Override
		public void writeMembers(JsonObject line) {
			line.addProperty("id", id);
			line.addProperty("op", op);
			line.add("args", args);
		}
	}

	/** A hint only; the launcher checks the port against the game process again. */
	public static final class LanOpened implements ModFrame {
		private final int port;

		public LanOpened(int port) {
			this.port = port;
		}

		public int port() {
			return port;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof LanOpened)) {
				return false;
			}
			LanOpened that = (LanOpened) other;
			return port == that.port;
		}

		@Override
		public int hashCode() {
			int hash = Integer.hashCode(port);
			return hash;
		}

		@Override
		public String toString() {
			return "LanOpened[port=" + port + "]";
		}

		@Override
		public String type() {
			return "lanOpened";
		}

		@Override
		public void writeMembers(JsonObject line) {
			line.addProperty("port", port);
		}
	}

	public static final class LanClosed implements ModFrame {
		public LanClosed() {
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof LanClosed)) {
				return false;
			}
			return true;
		}

		@Override
		public int hashCode() {
			return 0;
		}

		@Override
		public String toString() {
			return "LanClosed[]";
		}

		@Override
		public String type() {
			return "lanClosed";
		}
	}

	/** Diagnostics: the screens this mod offers. */
	public static final class Ready implements ModFrame {
		private final List<String> screens;

		public Ready(List<String> screens) {
			screens = Immutable.copyList(screens);
			this.screens = screens;
		}

		public List<String> screens() {
			return screens;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Ready)) {
				return false;
			}
			Ready that = (Ready) other;
			return Objects.equals(screens, that.screens);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(screens);
			return hash;
		}

		@Override
		public String toString() {
			return "Ready[screens=" + screens + "]";
		}


		@Override
		public String type() {
			return "ready";
		}

		@Override
		public void writeMembers(JsonObject line) {
			JsonArray names = new JsonArray();
			screens.forEach(names::add);
			line.add("screens", names);
		}
	}

	public static final class Ping implements ModFrame {
		public Ping() {
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Ping)) {
				return false;
			}
			return true;
		}

		@Override
		public int hashCode() {
			return 0;
		}

		@Override
		public String toString() {
			return "Ping[]";
		}

		@Override
		public String type() {
			return "ping";
		}
	}

	public static final class Pong implements ModFrame {
		public Pong() {
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Pong)) {
				return false;
			}
			return true;
		}

		@Override
		public int hashCode() {
			return 0;
		}

		@Override
		public String toString() {
			return "Pong[]";
		}

		@Override
		public String type() {
			return "pong";
		}
	}
}
