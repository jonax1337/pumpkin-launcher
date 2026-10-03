package dev.laux.pumpkin.friends.mc;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.bridge.Messages.Kick;
import dev.laux.pumpkin.friends.bridge.Messages.Share;
import dev.laux.pumpkin.friends.bridge.Messages.StopSharing;
import dev.laux.pumpkin.friends.state.Snapshot;
import dev.laux.pumpkin.friends.state.StateStore;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.OptionalInt;
import java.util.Set;
import java.util.stream.Collectors;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Checkbox;
import net.minecraft.client.gui.components.ScrollableLayout;
import net.minecraft.client.gui.components.StringWidget;
import net.minecraft.client.gui.layouts.HeaderAndFooterLayout;
import net.minecraft.client.gui.layouts.LinearLayout;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;

/**
 * Freunde-Bildschirm aus dem Pausemenü (SPEC 11.3): Freundesliste, Welt öffnen, Freunde einladen, Gäste entfernen,
 * Teilen beenden und empfangene Einladungen. Baut sich neu auf, sobald sich der angezeigte Stand ändert.
 */
public final class FriendsScreen extends Screen {
	private static final int ROW_WIDTH = 240;
	private static final int SPACING = 4;
	private static final int MAX_GUESTS = 7;

	private final Screen parent;
	private final StateStore store;
	private final BridgeClient client;
	private final Set<String> selectedFriendIds = new LinkedHashSet<>();
	private HeaderAndFooterLayout layout;
	private ScrollableLayout body;
	// Nur gesetzt, wenn Einladen möglich ist; dann gibt es auch die Kästchen, die es umschalten.
	private Button inviteButton;
	private View shown;

	public FriendsScreen(Screen parent, StateStore store, BridgeClient client) {
		super(Component.translatable("pumpkin_friends.title"));
		this.parent = parent;
		this.store = store;
		this.client = client;
	}

	@Override
	protected void init() {
		shown = currentView();
		selectedFriendIds.retainAll(invitableFriendIds(shown.snapshot()));
		layout = new HeaderAndFooterLayout(this);
		layout.addTitleHeader(title, font);
		LinearLayout content = LinearLayout.vertical().spacing(SPACING);
		content.defaultCellSetting().alignHorizontallyCenter();
		addSections(content);
		body = new ScrollableLayout(minecraft, content, layout.getContentHeight());
		layout.addToContents(body);
		layout.addToFooter(Button.builder(CommonComponents.GUI_DONE, button -> onClose()).width(Button.BIG_WIDTH).build());
		layout.visitWidgets(this::addRenderableWidget);
		repositionElements();
	}

	@Override
	protected void repositionElements() {
		body.arrangeElements();
		body.setMaxHeight(layout.getContentHeight());
		layout.arrangeElements();
	}

	@Override
	public void tick() {
		if (!currentView().equals(shown)) {
			rebuildWidgets();
		}
	}

	@Override
	public void onClose() {
		minecraft.gui.setScreen(parent);
	}

	private View currentView() {
		return new View(store.isConnected(), store.snapshot(), LanControl.canPublish(minecraft),
			LanControl.publishedPort(minecraft));
	}

	private void addSections(LinearLayout content) {
		if (!shown.connected()) {
			content.addChild(text(Component.translatable("pumpkin_friends.disconnected")));
			return;
		}
		Snapshot snapshot = shown.snapshot();
		if (snapshot.awaitingConfirmation()) {
			content.addChild(text(Component.translatable("pumpkin_friends.confirm_in_launcher")));
		}
		addHosting(content, snapshot);
		addFriendList(content, snapshot);
		addInvites(content, snapshot);
	}

	private void addHosting(LinearLayout content, Snapshot snapshot) {
		if (shown.canPublish()) {
			content.addChild(button(Component.translatable("pumpkin_friends.open_to_friends"), this::publish));
			return;
		}
		if (shown.publishedPort().isEmpty()) {
			return;
		}
		snapshot.session().ifPresent(session -> addGuests(content, session));
		addInviteChoices(content, snapshot);
	}

	private void publish() {
		if (!LanControl.publish(minecraft)) {
			Toasts.showSystem(minecraft, Component.translatable("pumpkin_friends.publish_failed"));
		}
	}

	private void addGuests(LinearLayout content, Snapshot.Session session) {
		content.addChild(heading("pumpkin_friends.section.guests"));
		for (Snapshot.Guest guest : session.guests()) {
			LinearLayout row = LinearLayout.horizontal().spacing(SPACING);
			row.addChild(text(Component.translatable("pumpkin_friends.row", Component.literal(guest.name()),
				Component.translatable("pumpkin_friends.guest." + lowercase(guest.state())))).setMaxWidth(ROW_WIDTH / 2));
			row.addChild(Button.builder(Component.translatable("pumpkin_friends.kick"),
				button -> client.send(new Kick(guest.id()))).width(Button.SMALL_WIDTH).build());
			content.addChild(row);
		}
		content.addChild(button(Component.translatable("pumpkin_friends.stop_sharing"), this::stopSharing));
	}

	private void stopSharing() {
		client.send(new StopSharing());
		LanControl.unpublish(minecraft);
	}

	private void addInviteChoices(LinearLayout content, Snapshot snapshot) {
		Set<String> invitable = invitableFriendIds(snapshot);
		if (invitable.isEmpty()) {
			return;
		}
		content.addChild(heading("pumpkin_friends.section.invite"));
		snapshot.onlineFriends().stream().filter(friend -> invitable.contains(friend.id()))
			.forEach(friend -> content.addChild(Checkbox.builder(Component.literal(friend.name()), font)
				.selected(selectedFriendIds.contains(friend.id()))
				.onValueChange((checkbox, selected) -> toggle(friend.id(), selected))
				.maxWidth(ROW_WIDTH)
				.build()));
		inviteButton = button(Component.translatable("pumpkin_friends.invite"), this::invite);
		inviteButton.active = canInvite();
		content.addChild(inviteButton);
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
		client.send(new Share(List.copyOf(selectedFriendIds)));
		selectedFriendIds.clear();
		rebuildWidgets();
	}

	/** Online-Freunde, die noch nicht Gast der Sitzung sind. */
	private static Set<String> invitableFriendIds(Snapshot snapshot) {
		Set<String> guestIds = snapshot.session().stream().flatMap(session -> session.guests().stream())
			.map(Snapshot.Guest::id).collect(Collectors.toSet());
		return snapshot.onlineFriends().stream().map(Snapshot.Friend::id).filter(id -> !guestIds.contains(id))
			.collect(Collectors.toCollection(LinkedHashSet::new));
	}

	private void addFriendList(LinearLayout content, Snapshot snapshot) {
		content.addChild(heading("pumpkin_friends.section.friends"));
		if (snapshot.friends().isEmpty()) {
			content.addChild(text(Component.translatable("pumpkin_friends.no_friends")));
		}
		for (Snapshot.Friend friend : snapshot.friends()) {
			content.addChild(text(Component.translatable("pumpkin_friends.row", Component.literal(friend.name()),
				Component.translatable("pumpkin_friends.presence." + lowercase(friend.presence())))));
		}
	}

	private void addInvites(LinearLayout content, Snapshot snapshot) {
		if (snapshot.invites().isEmpty()) {
			return;
		}
		content.addChild(heading("pumpkin_friends.section.invites"));
		for (Snapshot.Invite invite : snapshot.invites()) {
			content.addChild(text(Component.translatable("pumpkin_friends.invite_row",
				Component.literal(invite.fromName()), Component.literal(invite.title()))));
		}
		content.addChild(text(Component.translatable("pumpkin_friends.join_in_launcher")));
	}

	private StringWidget heading(String key) {
		return text(Component.translatable(key));
	}

	private StringWidget text(Component message) {
		return new StringWidget(message, font).setMaxWidth(ROW_WIDTH);
	}

	private static Button button(Component label, Runnable action) {
		return Button.builder(label, pressed -> action.run()).width(ROW_WIDTH).build();
	}

	private static String lowercase(Enum<?> value) {
		return value.name().toLowerCase(Locale.ROOT);
	}

	/** Alles, was der Bildschirm zeigt; ändert sich etwas davon, wird er neu aufgebaut. */
	private record View(boolean connected, Snapshot snapshot, boolean canPublish, OptionalInt publishedPort) {
	}
}
