package dev.laux.pumpkin.friends.bridge;

import java.util.List;

/**
 * Nachrichten der JSON-Zeilen zwischen Mod und Launcher (SPEC 7.2/7.3). Eingehende Werte sind ungeprüft;
 * {@code StateStore} bereinigt sie, bevor etwas davon angezeigt wird.
 */
public final class Messages {
	private Messages() {
	}

	/** Mod an Launcher; die Felder jedes Records sind genau die Felder der Zeile neben {@code type}. */
	public sealed interface Outbound {
		String type();
	}

	public record Hello(List<Integer> protocols, String token, String mod, String minecraft) implements Outbound {
		public String type() {
			return "hello";
		}

		// Das Token darf nie in einem Log landen (SPEC 12.1).
		@Override
		public String toString() {
			return "Hello[mod=" + mod + ", minecraft=" + minecraft + "]";
		}
	}

	public record LanOpened(int port) implements Outbound {
		public String type() {
			return "lanOpened";
		}
	}

	public record LanClosed() implements Outbound {
		public String type() {
			return "lanClosed";
		}
	}

	public record Share(List<String> friendIds) implements Outbound {
		public String type() {
			return "share";
		}
	}

	public record StopSharing() implements Outbound {
		public String type() {
			return "stopSharing";
		}
	}

	public record Kick(String friendId) implements Outbound {
		public String type() {
			return "kick";
		}
	}

	public record Ping() implements Outbound {
		public String type() {
			return "ping";
		}
	}

	/** Launcher an Mod. */
	public sealed interface Inbound {
	}

	public record Welcome(int protocol, String launcher) implements Inbound {
	}

	public record Reject(String reason) implements Inbound {
	}

	public record SnapshotUpdate(List<Friend> friends, Session session, List<Invite> invites) implements Inbound {
	}

	public record Notify(String event, String name, String mcUuid) implements Inbound {
	}

	public record ErrorReport(String code, String ref) implements Inbound {
	}

	public record Pong() implements Inbound {
	}

	public record Friend(String id, String name, String mcUuid, String presence) {
	}

	public record Session(List<Guest> guests) {
	}

	public record Guest(String id, String name, String state) {
	}

	public record Invite(String id, String fromName, String title) {
	}
}
