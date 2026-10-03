package dev.laux.pumpkin.friends.state;

import dev.laux.pumpkin.friends.bridge.Messages;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Function;

/** Unveränderlicher, bereinigter Stand für den Client-Thread (SPEC 7.3, 11.4). */
public record Snapshot(List<Friend> friends, Optional<Session> session, List<Invite> invites,
		boolean awaitingConfirmation) {
	public static final Snapshot EMPTY = new Snapshot(List.of(), Optional.empty(), List.of(), false);

	static Snapshot from(Messages.SnapshotUpdate update) {
		return new Snapshot(
			convert(update.friends(), Messages.Friend::id, Snapshot::friend),
			Optional.ofNullable(update.session()).map(Snapshot::session),
			convert(update.invites(), Messages.Invite::id, Snapshot::invite),
			false);
	}

	Snapshot withAwaitingConfirmation(boolean awaiting) {
		return new Snapshot(friends, session, invites, awaiting);
	}

	public List<Friend> onlineFriends() {
		return friends.stream().filter(friend -> friend.presence() != Presence.OFFLINE).toList();
	}

	private static Friend friend(Messages.Friend raw) {
		return new Friend(raw.id(), Sanitize.name(raw.name()), Sanitize.mcUuid(raw.mcUuid()),
			Presence.parse(raw.presence()));
	}

	private static Session session(Messages.Session raw) {
		return new Session(convert(raw.guests(), Messages.Guest::id, guest ->
			new Guest(guest.id(), Sanitize.name(guest.name()), GuestState.parse(guest.state()))));
	}

	private static Invite invite(Messages.Invite raw) {
		return new Invite(raw.id(), Sanitize.name(raw.fromName()), Sanitize.title(raw.title()));
	}

	/** Fehlende Listen und Einträge ohne Kennung kommen vom nicht vertrauenswürdigen Kanal und fallen weg. */
	private static <R, T> List<T> convert(List<R> raw, Function<R, String> id, Function<R, T> converter) {
		if (raw == null) {
			return List.of();
		}
		return raw.stream().filter(Objects::nonNull).filter(entry -> id.apply(entry) != null).map(converter).toList();
	}

	public enum Presence {
		OFFLINE, ONLINE, PLAYING;

		static Presence parse(String wire) {
			return switch (wire == null ? "" : wire) {
				case "online" -> ONLINE;
				case "playing" -> PLAYING;
				default -> OFFLINE;
			};
		}
	}

	public enum GuestState {
		INVITED, CONNECTED;

		static GuestState parse(String wire) {
			return "connected".equals(wire) ? CONNECTED : INVITED;
		}
	}

	public record Friend(String id, String name, Optional<String> mcUuid, Presence presence) {
	}

	public record Session(List<Guest> guests) {
	}

	public record Guest(String id, String name, GuestState state) {
	}

	public record Invite(String id, String fromName, String title) {
	}
}
