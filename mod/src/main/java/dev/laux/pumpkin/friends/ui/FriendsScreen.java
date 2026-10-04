package dev.laux.pumpkin.friends.ui;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.compat.LanControl;
import dev.laux.pumpkin.friends.compat.Toasts;
import dev.laux.pumpkin.friends.request.Op;
import dev.laux.pumpkin.friends.request.Ops;
import dev.laux.pumpkin.friends.request.Reply;
import dev.laux.pumpkin.friends.state.Friend;
import dev.laux.pumpkin.friends.state.Invite;
import dev.laux.pumpkin.friends.state.Session;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
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
	private final BridgeClient client;
	private final Set<String> selectedFriendIds = new LinkedHashSet<>();
	private HeaderAndFooterLayout layout;
	private ScrollableLayout body;
	// Nur gesetzt, wenn Einladen möglich ist; dann gibt es auch die Kästchen, die es umschalten.
	private Button inviteButton;
	private View shown;

	public FriendsScreen(Screen parent, BridgeClient client) {
		super(Component.translatable("pumpkin_friends.title"));
		this.parent = parent;
		this.client = client;
	}

	@Override
	protected void init() {
		shown = currentView();
		selectedFriendIds.retainAll(invitableFriendIds(shown));
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
		return new View(client.isConnected(), client.topics().friends(), client.topics().session(), client.topics().invites(),
			client.isAwaitingLauncherDialog(), LanControl.canPublish(minecraft), LanControl.publishedPort(minecraft));
	}

	private void addSections(LinearLayout content) {
		if (!shown.connected()) {
			content.addChild(text(Component.translatable("pumpkin_friends.disconnected")));
			return;
		}
		if (shown.awaitingConfirmation()) {
			content.addChild(text(Component.translatable("pumpkin_friends.confirm_in_launcher")));
		}
		addHosting(content);
		addFriendList(content);
		addInvites(content);
	}

	private void addHosting(LinearLayout content) {
		if (shown.canPublish()) {
			content.addChild(button(Component.translatable("pumpkin_friends.open_to_friends"), this::publish));
			return;
		}
		if (shown.publishedPort().isEmpty()) {
			return;
		}
		shown.session().ifPresent(session -> addGuests(content, session));
		addInviteChoices(content);
	}

	private void publish() {
		if (!LanControl.publish(minecraft)) {
			Toasts.showSystem(minecraft, Component.translatable("pumpkin_friends.publish_failed"));
		}
	}

	private void addGuests(LinearLayout content, Session session) {
		content.addChild(heading("pumpkin_friends.section.guests"));
		for (Session.Guest guest : session.guests()) {
			LinearLayout row = LinearLayout.horizontal().spacing(SPACING);
			row.addChild(text(Component.translatable("pumpkin_friends.row", Component.literal(guest.name()),
				Component.translatable("pumpkin_friends.guest." + lowercase(guest.state())))).setMaxWidth(ROW_WIDTH / 2));
			row.addChild(Button.builder(Component.translatable("pumpkin_friends.kick"),
				button -> run(Ops.hostKick(guest.id()))).width(Button.SMALL_WIDTH).build());
			content.addChild(row);
		}
		content.addChild(button(Component.translatable("pumpkin_friends.stop_sharing"), this::stopSharing));
	}

	private void stopSharing() {
		run(Ops.hostStop());
		LanControl.unpublish(minecraft);
	}

	private void addInviteChoices(LinearLayout content) {
		Set<String> invitable = invitableFriendIds(shown);
		if (invitable.isEmpty()) {
			return;
		}
		content.addChild(heading("pumpkin_friends.section.invite"));
		shown.friends().stream().filter(friend -> invitable.contains(friend.id()))
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
		run(Ops.hostInvite(List.copyOf(selectedFriendIds), false));
		selectedFriendIds.clear();
		rebuildWidgets();
	}

	/** Sends the operation; if the launcher refuses or does not answer, the player sees why as a toast. */
	private void run(Op<?> operation) {
		client.request(operation).reply().thenAccept(this::showFailure);
	}

	private void showFailure(Reply<?> reply) {
		reply.error().ifPresent(error -> Toasts.showError(minecraft, error));
	}

	/** Online-Freunde, die noch nicht Gast der Sitzung sind. */
	private static Set<String> invitableFriendIds(View view) {
		Set<String> guestIds = view.session().stream().flatMap(session -> session.guests().stream())
			.map(Session.Guest::id).collect(Collectors.toSet());
		return view.friends().stream().filter(Friend::isOnline).map(Friend::id).filter(id -> !guestIds.contains(id))
			.collect(Collectors.toCollection(LinkedHashSet::new));
	}

	private void addFriendList(LinearLayout content) {
		content.addChild(heading("pumpkin_friends.section.friends"));
		if (shown.friends().isEmpty()) {
			content.addChild(text(Component.translatable("pumpkin_friends.no_friends")));
		}
		for (Friend friend : shown.friends()) {
			content.addChild(text(Component.translatable("pumpkin_friends.row", Component.literal(friend.name()),
				Component.translatable("pumpkin_friends.presence." + lowercase(friend.presence())))));
		}
	}

	private void addInvites(LinearLayout content) {
		if (shown.invites().isEmpty()) {
			return;
		}
		content.addChild(heading("pumpkin_friends.section.invites"));
		for (Invite invite : shown.invites()) {
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
	private record View(boolean connected, List<Friend> friends, Optional<Session> session, List<Invite> invites,
			boolean awaitingConfirmation, boolean canPublish, OptionalInt publishedPort) {
	}
}
