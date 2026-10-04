package dev.laux.pumpkin.friends.ui;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.compat.Lan;
import dev.laux.pumpkin.friends.compat.Text;
import dev.laux.pumpkin.friends.compat.Toasts;
import dev.laux.pumpkin.friends.compat.Widgets;
import dev.laux.pumpkin.friends.request.Op;
import dev.laux.pumpkin.friends.request.Ops;
import dev.laux.pumpkin.friends.request.Reply;
import dev.laux.pumpkin.friends.state.Friend;
import dev.laux.pumpkin.friends.state.Invite;
import dev.laux.pumpkin.friends.state.Session;
import dev.laux.pumpkin.friends.ui.kit.PumpkinScreen;
import dev.laux.pumpkin.friends.ui.kit.Row;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.Set;
import java.util.stream.Collectors;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.screens.Screen;

/**
 * Freunde-Bildschirm aus dem Pausemenü (SPEC 11.3): Freundesliste, Welt öffnen, Freunde einladen, Gäste entfernen,
 * Teilen beenden und empfangene Einladungen. Baut sich neu auf, sobald sich der angezeigte Stand ändert. The hub with
 * tabs replaces this screen (package U2); until then it runs on the same widget kit.
 */
public final class FriendsScreen extends PumpkinScreen {
	private static final int MAX_GUESTS = 7;
	private static final int ACTION_WIDTH = 70;
	private static final int FULL_ROW_WIDTH = 100;

	private final BridgeClient client;
	private final Set<String> selectedFriendIds = new LinkedHashSet<>();
	// Nur gesetzt, wenn Einladen möglich ist; dann gibt es auch die Schalter, die es umschalten.
	private AbstractWidget inviteButton;
	private View shown;

	public FriendsScreen(Screen parent, BridgeClient client) {
		super(Text.translate("pumpkin_friends.title"), parent);
		this.client = client;
	}

	@Override
	protected List<Row> rows(int tab) {
		shown = currentView();
		selectedFriendIds.retainAll(invitableFriendIds(shown));
		List<Row> rows = new ArrayList<>();
		if (!shown.connected()) {
			rows.add(Row.text(Text.translate("pumpkin_friends.disconnected")));
			return rows;
		}
		addHosting(rows);
		addFriendList(rows);
		addInvites(rows);
		return rows;
	}

	@Override
	protected String statusLine() {
		return shown != null && shown.awaitingConfirmation() ? Text.translate("pumpkin_friends.confirm_in_launcher") : "";
	}

	@Override
	protected void onTick() {
		super.onTick();
		if (!currentView().equals(shown)) {
			rebuildWidgets();
		}
	}

	private View currentView() {
		return new View(client.isConnected(), client.topics().friends(), client.topics().session(), client.topics().invites(),
			client.isAwaitingLauncherDialog(), Lan.canPublish(), Lan.publishedPort());
	}

	private void addHosting(List<Row> rows) {
		if (shown.canPublish()) {
			rows.add(buttonRow("host.publish", Text.translate("pumpkin_friends.open_to_friends"), this::publish));
			return;
		}
		if (shown.publishedPort().isEmpty()) {
			return;
		}
		shown.session().ifPresent(session -> addGuests(rows, session));
		addInviteChoices(rows);
	}

	private void publish() {
		if (!Lan.publish()) {
			Toasts.showSystem(Text.translate("pumpkin_friends.publish_failed"));
		}
	}

	private void addGuests(List<Row> rows, Session session) {
		rows.add(Row.heading(Text.translate("pumpkin_friends.section.guests")));
		for (Session.Guest guest : session.guests()) {
			rows.add(Row.text(Text.translate("pumpkin_friends.row", guest.name(),
					Text.translate("pumpkin_friends.guest." + lowercase(guest.state()))))
				.withAction("guest.kick." + guest.id(), Widgets.button(Text.translate("pumpkin_friends.kick"), ACTION_WIDTH,
					() -> run(Ops.hostKick(guest.id())))));
		}
		rows.add(buttonRow("host.stop", Text.translate("pumpkin_friends.stop_sharing"), this::stopSharing));
		if (!Lan.canUnpublish()) {
			rows.add(Row.text(Text.translate("pumpkin_friends.lan_stays_open")));
		}
	}

	private void stopSharing() {
		run(Ops.hostStop());
		Lan.unpublish();
	}

	private void addInviteChoices(List<Row> rows) {
		Set<String> invitable = invitableFriendIds(shown);
		if (invitable.isEmpty()) {
			return;
		}
		rows.add(Row.heading(Text.translate("pumpkin_friends.section.invite")));
		shown.friends().stream().filter(friend -> invitable.contains(friend.id()))
			.forEach(friend -> rows.add(Row.fullWidth("invite.choice." + friend.id(),
				Widgets.toggle(friend.name(), selectedFriendIds.contains(friend.id()), FULL_ROW_WIDTH,
					selected -> toggle(friend.id(), selected)))));
		inviteButton = Widgets.button(Text.translate("pumpkin_friends.invite"), FULL_ROW_WIDTH, this::invite);
		inviteButton.active = canInvite();
		rows.add(Row.fullWidth("host.invite", inviteButton));
	}

	private void toggle(String friendId, boolean selected) {
		if (selected) {
			selectedFriendIds.add(friendId);
		} else {
			selectedFriendIds.remove(friendId);
		}
		inviteButton.active = canInvite();
	}

	private boolean canInvite() {
		return !selectedFriendIds.isEmpty() && selectedFriendIds.size() <= MAX_GUESTS;
	}

	private void invite() {
		run(Ops.hostInvite(List.copyOf(selectedFriendIds), false));
		selectedFriendIds.clear();
		rebuildWidgets();
	}

	/** Sends the operation; if the launcher refuses or does not answer, the player sees why as a toast. */
	private void run(Op<?> operation) {
		client.request(operation).reply().thenAccept(this::showFailure);
	}

	private void showFailure(Reply<?> reply) {
		reply.error().ifPresent(Toasts::showError);
	}

	/** Online-Freunde, die noch nicht Gast der Sitzung sind. */
	private static Set<String> invitableFriendIds(View view) {
		Set<String> guestIds = view.session().stream().flatMap(session -> session.guests().stream())
			.map(Session.Guest::id).collect(Collectors.toSet());
		return view.friends().stream().filter(Friend::isOnline).map(Friend::id).filter(id -> !guestIds.contains(id))
			.collect(Collectors.toCollection(LinkedHashSet::new));
	}

	private void addFriendList(List<Row> rows) {
		rows.add(Row.heading(Text.translate("pumpkin_friends.section.friends")));
		if (shown.friends().isEmpty()) {
			rows.add(Row.text(Text.translate("pumpkin_friends.no_friends")));
		}
		for (Friend friend : shown.friends()) {
			rows.add(Row.text(Text.translate("pumpkin_friends.row", friend.name(),
				Text.translate("pumpkin_friends.presence." + lowercase(friend.presence())))));
		}
	}

	private void addInvites(List<Row> rows) {
		if (shown.invites().isEmpty()) {
			return;
		}
		rows.add(Row.heading(Text.translate("pumpkin_friends.section.invites")));
		for (Invite invite : shown.invites()) {
			rows.add(Row.text(Text.translate("pumpkin_friends.invite_row", invite.fromName(), invite.title())));
		}
		rows.add(Row.text(Text.translate("pumpkin_friends.join_in_launcher")));
	}

	private static Row buttonRow(String id, String label, Runnable action) {
		return Row.fullWidth(id, Widgets.button(label, FULL_ROW_WIDTH, action));
	}

	private static String lowercase(Enum<?> value) {
		return value.name().toLowerCase(Locale.ROOT);
	}

	/** Alles, was der Bildschirm zeigt; ändert sich etwas davon, wird er neu aufgebaut. */
	private record View(boolean connected, List<Friend> friends, Optional<Session> session, List<Invite> invites,
			boolean awaitingConfirmation, boolean canPublish, OptionalInt publishedPort) {
	}
}
