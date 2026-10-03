package dev.laux.pumpkin.friends.state;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.bridge.Messages.ErrorReport;
import dev.laux.pumpkin.friends.bridge.Messages.Inbound;
import dev.laux.pumpkin.friends.bridge.Messages.Notify;
import dev.laux.pumpkin.friends.bridge.Messages.SnapshotUpdate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Queue;
import java.util.Set;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Übergabe zwischen Lese-Thread und Client-Thread (SPEC 11.4): der Lese-Thread legt Nachrichten in eine
 * {@link ConcurrentLinkedQueue}, der Client-Thread leert sie mit {@link #drain()} einmal pro Tick.
 */
public final class StateStore implements BridgeClient.Listener {
	private static final String CONFIRM_IN_LAUNCHER = "confirmInLauncher";
	private static final Set<String> NOTIFY_EVENTS = Set.of(
		"inviteReceived", "guestJoined", "guestLeft", "sessionEnded", "friendOnline", CONFIRM_IN_LAUNCHER);
	private static final Set<String> ERROR_CODES = Set.of(
		"notEnabled", "peerOffline", "guestLimit", "lanPortUnknown", "portNotGame", "denied", "versionUnsupported",
		"busy", "internal");

	private final Queue<Inbound> inbox = new ConcurrentLinkedQueue<>();
	private volatile boolean connected;
	private volatile Snapshot snapshot = Snapshot.EMPTY;

	@Override
	public void connected() {
		connected = true;
	}

	@Override
	public void received(Inbound message) {
		inbox.add(message);
	}

	@Override
	public void disconnected() {
		connected = false;
	}

	public boolean isConnected() {
		return connected;
	}

	public Snapshot snapshot() {
		return snapshot;
	}

	/** Übernimmt alle wartenden Nachrichten und liefert die Hinweise, die als Toast erscheinen sollen. */
	public List<Alert> drain() {
		if (!connected) {
			inbox.clear();
			snapshot = Snapshot.EMPTY;
			return List.of();
		}
		List<Alert> alerts = new ArrayList<>();
		for (Inbound message = inbox.poll(); message != null; message = inbox.poll()) {
			apply(message).ifPresent(alerts::add);
		}
		return alerts;
	}

	private Optional<Alert> apply(Inbound message) {
		return switch (message) {
			case SnapshotUpdate update -> {
				replaceSnapshot(Snapshot.from(update));
				yield Optional.empty();
			}
			case Notify notify -> notifyAlert(notify);
			case ErrorReport error -> errorAlert(error);
			default -> Optional.empty();
		};
	}

	// Der Hinweis "Bestätige im Launcher" gilt, bis der Launcher antwortet: mit einer geänderten Sitzung oder einem Fehler.
	private void replaceSnapshot(Snapshot next) {
		boolean stillAwaiting = snapshot.awaitingConfirmation() && next.session().equals(snapshot.session());
		snapshot = next.withAwaitingConfirmation(stillAwaiting);
	}

	private Optional<Alert> notifyAlert(Notify notify) {
		if (!isOneOf(NOTIFY_EVENTS, notify.event())) {
			return Optional.empty();
		}
		if (CONFIRM_IN_LAUNCHER.equals(notify.event())) {
			snapshot = snapshot.withAwaitingConfirmation(true);
		}
		return Optional.of(new Alert("pumpkin_friends.notify." + notify.event(),
			Optional.of(Sanitize.name(notify.name())).filter(name -> !name.isEmpty()), Sanitize.mcUuid(notify.mcUuid())));
	}

	private Optional<Alert> errorAlert(ErrorReport error) {
		if (!isOneOf(ERROR_CODES, error.code())) {
			return Optional.empty();
		}
		snapshot = snapshot.withAwaitingConfirmation(false);
		return Optional.of(new Alert("pumpkin_friends.error." + error.code(), Optional.empty(), Optional.empty()));
	}

	// Set.of(...).contains(null) wirft; fehlende Felder vom Launcher sind aber null.
	private static boolean isOneOf(Set<String> known, String value) {
		return value != null && known.contains(value);
	}

	/** Ein Toast: Übersetzungsschlüssel, optional der bereinigte Name und die UUID für den Kopf. */
	public record Alert(String translationKey, Optional<String> name, Optional<String> mcUuid) {
	}
}
