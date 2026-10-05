package dev.laux.pumpkin.bridge.protocol;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.List;

/**
 * What the mod sends to the launcher. Each record writes exactly the members of its wire line besides {@code type}
 * (the examples are in {@code mod/fixtures/protocol}).
 */
public sealed interface ModFrame {
	String type();

	default void writeMembers(JsonObject line) {
	}

	record Hello(String token, String modVersion, String build, GameInfo game) implements ModFrame {
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

	record Req(String id, String op, JsonObject args) implements ModFrame {
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
	record LanOpened(int port) implements ModFrame {
		@Override
		public String type() {
			return "lanOpened";
		}

		@Override
		public void writeMembers(JsonObject line) {
			line.addProperty("port", port);
		}
	}

	record LanClosed() implements ModFrame {
		@Override
		public String type() {
			return "lanClosed";
		}
	}

	/** Diagnostics: the screens this mod offers. */
	record Ready(List<String> screens) implements ModFrame {
		public Ready {
			screens = List.copyOf(screens);
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

	record Ping() implements ModFrame {
		@Override
		public String type() {
			return "ping";
		}
	}

	record Pong() implements ModFrame {
		@Override
		public String type() {
			return "pong";
		}
	}
}
