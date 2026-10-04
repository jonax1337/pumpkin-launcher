package dev.laux.pumpkin.friends.ui.hub;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.compat.Lan;
import dev.laux.pumpkin.friends.compat.Text;
import dev.laux.pumpkin.friends.compat.Toasts;
import dev.laux.pumpkin.friends.compat.Widgets;
import dev.laux.pumpkin.friends.request.Op;
import dev.laux.pumpkin.friends.request.Ops;
import dev.laux.pumpkin.friends.request.Reply;
import dev.laux.pumpkin.friends.state.Friend;
import dev.laux.pumpkin.friends.state.Game;
import dev.laux.pumpkin.friends.state.Join;
import dev.laux.pumpkin.friends.state.Session;
import dev.laux.pumpkin.friends.ui.kit.Row;
import dev.laux.pumpkin.friends.ui.model.Invitees;
import dev.laux.pumpkin.friends.ui.model.ShareControls;
import dev.laux.pumpkin.friends.ui.model.ShareModel;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import net.minecraft.client.gui.components.AbstractWidget;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The Teilen tab of the hub (INGAME 6.4): the state machine says which body the current game shows, this tab renders it
 * with the widget kit and sends the operations ({@code host.invite}, {@code host.kick}, {@code host.stop},
 * {@code join.leave}). The invite choices live in {@link ShareControls}, so they survive a resize. "Teilen beenden" ends
 * the session first and unpublishes the LAN world only where the era has {@code unpublishServer} (A2); older eras keep
 * the world open and say so.
 */
public final class ShareTab {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_friends");
	private static final int ACTION_WIDTH = 62;
	private static final int FULL_ROW_WIDTH = 110;

	private final BridgeClient client;
	private final ShareControls controls = new ShareControls();
	// Nur gesetzt, während die Zeilen dieses Baus laufen; die Schalter der gleichen Bauwirkung schalten ihn frei.
	private AbstractWidget inviteButton;
	private final Set<ShareModel.State> renderedOnce = EnumSet.noneOf(ShareModel.State.class);

	public ShareTab(BridgeClient client) {
		this.client = client;
	}

	/** The rows of the tab's current state; called once per widget build, so every widget is fresh. */
	public List<Row> rows() {
		inviteButton = null;
		ShareModel.State state = ShareModel.state(input());
		return switch (state) {
			case JOINED -> joinRows();
			case ON_SERVER -> List.of(Row.text(Text.translate("pumpkin_friends.share.on_server")));
			case NOT_HOSTABLE -> notHostableRows();
			case UNKNOWN -> List.of(Row.text(Text.translate("pumpkin_friends.share.unknown")));
			case SHARED_ELSEWHERE -> sharedElsewhereRows();
			case SESSION -> sessionRows();
			case PUBLISHED -> publishedRows();
			case WAITING_FOR_VERIFICATION -> List.of(Row.text(Text.translate("pumpkin_friends.share.waiting")));
			case NOT_PUBLISHED -> openRows();
		};
	}

	/** Logs one line per state the tab has rendered, the render proof of the dev run. */
	public void onRendered(int width, int height) {
		ShareModel.State state = ShareModel.state(input());
		if (renderedOnce.add(state)) {
			LOG.info("pumpkin_friends share tab rendered {} at {}x{}", state, width, height);
		}
	}

	private ShareModel.Input input() {
		// "Gerade teilt {Instanz}": die Themen tragen heute nicht, wer anders teilt (Abweichung im Bericht).
		return new ShareModel.Input(client.topics().game(), Lan.onMultiplayerServer(), client.topics().join(),
			client.topics().session().isPresent(), Lan.publishedPort().isPresent(), Optional.empty());
	}

	private List<Row> joinRows() {
		Join join = client.topics().join().orElseThrow();
		Row row = Row.text(Text.translate("pumpkin_friends.join.row", join.hostName(), pathName(join), rttName(join)));
		return List.of(row.withAction("join.leave", Widgets.button(Text.translate("pumpkin_friends.join.leave"),
			ACTION_WIDTH, () -> run(Ops.joinLeave()))));
	}

	private static String pathName(Join join) {
		return join.path().map(path -> Text.translate("pumpkin_friends.join.path." + lowercase(path)))
			.orElse(Text.translate("pumpkin_friends.join.path.unknown"));
	}

	private static String rttName(Join join) {
		return join.rttMs().isPresent() ? join.rttMs().getAsInt() + " ms"
			: Text.translate("pumpkin_friends.join.rtt_unknown");
	}

	private List<Row> notHostableRows() {
		Game.Unhostable reason = client.topics().game().reason().orElseThrow();
		String text = switch (reason.kind()) {
			case VERSION_UNSUPPORTED -> reason.minVersion()
				.map(min -> Text.translate("pumpkin_friends.share.reason.versionUnsupported", min))
				.orElseGet(() -> Text.translate("pumpkin_friends.share.reason.versionUnsupported.unknown"));
			case MS_ACCOUNT_REQUIRED -> Text.translate("pumpkin_friends.share.reason.msAccountRequired");
			case MANIFEST_INVALID -> Text.translate("pumpkin_friends.share.reason.manifestInvalid");
			case NOT_READY -> Text.translate("pumpkin_friends.share.unknown");
		};
		return List.of(Row.text(text));
	}

	private List<Row> sharedElsewhereRows() {
		String instance = input().sharingInstance().orElse("");
		return List.of(Row.text(Text.translate("pumpkin_friends.share.elsewhere", instance)));
	}

	private List<Row> openRows() {
		return List.of(Row.fullWidth("share.open", Widgets.button(Text.translate("pumpkin_friends.open_to_friends"),
			FULL_ROW_WIDTH, this::openWorld)));
	}

	/** Öffnet die Welt für Freunde und wartet dann auf die Bestätigung des Ports durch den Launcher (INGAME 6.4). */
	private void openWorld() {
		if (!Lan.publish()) {
			Toasts.showSystem(Text.translate("pumpkin_friends.publish_failed"));
		}
	}

	private List<Row> publishedRows() {
		List<Row> rows = new ArrayList<>();
		rows.add(Row.text(Text.translate("pumpkin_friends.share.published", client.topics().game().lanPort().getAsInt())));
		addInviteSection(rows, "pumpkin_friends.section.invite");
		return rows;
	}

	private List<Row> sessionRows() {
		List<Row> rows = new ArrayList<>();
		client.topics().session().ifPresent(session -> addGuests(rows, session));
		rows.add(Row.fullWidth("share.stop", Widgets.button(Text.translate("pumpkin_friends.stop_sharing"),
			FULL_ROW_WIDTH, this::stopSharing)));
		if (!Lan.canUnpublish()) {
			rows.add(Row.text(Text.translate("pumpkin_friends.lan_stays_open")));
		}
		addInviteSection(rows, "pumpkin_friends.share.invite_more");
		return rows;
	}

	private void addGuests(List<Row> rows, Session session) {
		rows.add(Row.heading(Text.translate("pumpkin_friends.section.guests")));
		for (Session.Guest guest : session.guests()) {
			rows.add(Row.text(Text.translate("pumpkin_friends.row", guest.name(),
					Text.translate("pumpkin_friends.guest." + lowercase(guest.state()))))
				.withAction("guest.reinvite." + guest.id(), Widgets.button(Text.translate("pumpkin_friends.share.reinvite"),
					ACTION_WIDTH, () -> run(Ops.hostInvite(List.of(guest.id()), controls.showsWorldName()))))
				.withAction("guest.kick." + guest.id(), Widgets.button(Text.translate("pumpkin_friends.kick"),
					ACTION_WIDTH, () -> run(Ops.hostKick(guest.id())))));
		}
	}

	/** The toggles of the invitable friends (max 7), the "Weltname zeigen" toggle and the [Einladen] button. */
	private void addInviteSection(List<Row> rows, String headingKey) {
		List<Friend> invitable = Invitees.of(client.topics().friends(), client.topics().session());
		controls.retainAll(invitable.stream().map(Friend::id).collect(Collectors.toSet()));
		if (invitable.isEmpty()) {
			return;
		}
		rows.add(Row.heading(Text.translate(headingKey)));
		for (Friend friend : invitable) {
			rows.add(Row.fullWidth("share.toggle." + friend.id(), Widgets.toggle(friend.name(),
				controls.isSelected(friend.id()), selected -> toggleFriend(friend.id(), selected))));
		}
		rows.add(Row.fullWidth("share.show_world", Widgets.toggle(Text.translate("pumpkin_friends.share.show_world"),
			controls.showsWorldName(), ignored -> controls.toggleShowWorldName())));
		inviteButton = Widgets.button(Text.translate("pumpkin_friends.invite"), FULL_ROW_WIDTH, this::invite);
		inviteButton.active = controls.canInvite();
		rows.add(Row.fullWidth("share.invite", inviteButton));
	}

	private void toggleFriend(String friend, boolean selected) {
		controls.set(friend, selected);
		if (inviteButton != null) {
			inviteButton.active = controls.canInvite();
		}
	}

	private void invite() {
		run(Ops.hostInvite(controls.selection(), controls.showsWorldName()));
	}

	/** Erst die Sitzung im Launcher beenden, dann - wo die Zeit es hergibt - die Welt aus dem LAN nehmen (A2). */
	private void stopSharing() {
		client.request(Ops.hostStop()).reply().thenAccept(ShareTab::endSharing);
	}

	private static void endSharing(Reply<?> reply) {
		reply.error().ifPresentOrElse(Toasts::showError, Lan::unpublish);
	}

	/** Sends the operation; if the launcher refuses or does not answer, the player sees why as a toast. */
	private void run(Op<?> operation) {
		client.request(operation).reply().thenAccept(reply -> reply.error().ifPresent(Toasts::showError));
	}

	private static String lowercase(Enum<?> value) {
		return value.name().toLowerCase(Locale.ROOT);
	}
}
