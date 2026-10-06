package dev.laux.pumpkin.bridge.modules.friends.ui;

import dev.laux.pumpkin.bridge.runtime.Immutable;

import dev.laux.pumpkin.bridge.modules.friends.compat.Lan;
import dev.laux.pumpkin.bridge.compat.Text;
import dev.laux.pumpkin.bridge.compat.Toasts;
import dev.laux.pumpkin.bridge.compat.Widgets;
import dev.laux.pumpkin.bridge.transport.request.Op;
import dev.laux.pumpkin.bridge.modules.friends.protocol.Ops;
import dev.laux.pumpkin.bridge.transport.request.Reply;
import dev.laux.pumpkin.bridge.protocol.OpError;
import dev.laux.pumpkin.bridge.modules.friends.state.Friend;
import dev.laux.pumpkin.bridge.modules.friends.state.Game;
import dev.laux.pumpkin.bridge.modules.friends.state.Join;
import dev.laux.pumpkin.bridge.modules.friends.state.Session;
import dev.laux.pumpkin.bridge.ui.kit.Row;
import dev.laux.pumpkin.bridge.modules.friends.ui.model.Invitees;
import dev.laux.pumpkin.bridge.modules.friends.ui.model.ShareControls;
import dev.laux.pumpkin.bridge.modules.friends.ui.model.ShareModel;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import net.minecraft.client.gui.components.AbstractWidget;
import org.apache.logging.log4j.Logger;
import org.apache.logging.log4j.LogManager;

/**
 * The Teilen tab of the hub (docs/bridge/README.md, "In-game navigation and world behavior"): the state machine says which body the current game shows, this tab renders it
 * with the widget kit and sends the operations ({@code host.invite}, {@code host.kick}, {@code host.stop},
 * {@code join.leave}). The invite choices live in {@link ShareControls}, so they survive a resize. "Teilen beenden" ends
 * the session first and unpublishes the LAN world only where the era has {@code unpublishServer} (A2); older eras keep
 * the world open and say so.
 */
public final class ShareTab {
	private static final Logger LOG = LogManager.getLogger("pumpkin_bridge");
	private static final int ACTION_WIDTH = 62;
	private static final int FULL_ROW_WIDTH = 110;

	private final ShareLink link;
	private final ShareControls controls = new ShareControls();
	// Nur gesetzt, während die Zeilen dieses Baus laufen; die Schalter der gleichen Bauwirkung schalten ihn frei.
	private AbstractWidget inviteButton;
	private final Set<ShareModel.State> renderedOnce = EnumSet.noneOf(ShareModel.State.class);

	public ShareTab(ShareLink link) {
		this.link = link;
	}

	/** The rows of the tab's current state; called once per widget build, so every widget is fresh. */
	public List<Row> rows() {
		inviteButton = null;
		ShareModel.State state = ShareModel.state(input());
		switch (state) {
			case JOINED:
				return joinRows();
			case ON_SERVER:
				return Immutable.list(Row.text(Text.translate("pumpkin_bridge.share.on_server")));
			case NOT_HOSTABLE:
				return notHostableRows();
			case UNKNOWN:
				return Immutable.list(Row.text(Text.translate("pumpkin_bridge.share.unknown")));
			case SHARED_ELSEWHERE:
				return sharedElsewhereRows();
			case SESSION:
				return sessionRows();
			case PUBLISHED:
				return publishedRows();
			case WAITING_FOR_VERIFICATION:
				return Immutable.list(Row.text(Text.translate("pumpkin_bridge.share.waiting")));
			case NOT_PUBLISHED:
				return openRows();
			default:
				throw new IncompatibleClassChangeError();
		}
	}

	/** Logs one line per state the tab has rendered, the render proof of the dev run. */
	public void onRendered(int width, int height) {
		ShareModel.State state = ShareModel.state(input());
		if (renderedOnce.add(state)) {
			LOG.info("pumpkin_bridge share tab rendered {} at {}x{}", state, width, height);
		}
	}

	private ShareModel.Input input() {
		return new ShareModel.Input(link.topics().game(), Lan.onMultiplayerServer(), link.topics().join(),
			link.topics().session().isPresent(), Lan.publishedPort().isPresent(), link.topics().game().sharedElsewhere());
	}

	private List<Row> joinRows() {
		Join join = link.topics().join().get();
		Row row = Row.text(Text.translate("pumpkin_bridge.join.row", join.hostName(), pathName(join), rttName(join)));
		return Immutable.list(row.withAction("join.leave", Widgets.button(Text.translate("pumpkin_bridge.join.leave"),
			ACTION_WIDTH, () -> run(Ops.joinLeave()))));
	}

	private static String pathName(Join join) {
		return join.path().map(path -> Text.translate("pumpkin_bridge.join.path." + lowercase(path)))
			.orElse(Text.translate("pumpkin_bridge.join.path.unknown"));
	}

	private static String rttName(Join join) {
		return join.rttMs().isPresent() ? join.rttMs().getAsInt() + " ms"
			: Text.translate("pumpkin_bridge.join.rtt_unknown");
	}

	private List<Row> notHostableRows() {
		Game.Unhostable reason = link.topics().game().reason().get();
		String text;
		switch (reason.kind()) {
			case VERSION_UNSUPPORTED:
				text = reason.minVersion()
				.map(min -> Text.translate("pumpkin_bridge.share.reason.versionUnsupported", min))
				.orElseGet(() -> Text.translate("pumpkin_bridge.share.reason.versionUnsupported.unknown"));
				break;
			case MS_ACCOUNT_REQUIRED:
				text = Text.translate("pumpkin_bridge.share.reason.msAccountRequired");
				break;
			case MANIFEST_INVALID:
				text = Text.translate("pumpkin_bridge.share.reason.manifestInvalid");
				break;
			case NOT_READY:
				text = Text.translate("pumpkin_bridge.share.unknown");
				break;
			default:
				throw new IncompatibleClassChangeError();
		}
		return Immutable.list(Row.text(text));
	}

	private List<Row> sharedElsewhereRows() {
		return Immutable.list(Row.text(Text.translate("pumpkin_bridge.share.elsewhere.unnamed")));
	}

	private List<Row> openRows() {
		return Immutable.list(Row.fullWidth("share.open", Widgets.button(Text.translate("pumpkin_bridge.open_to_friends"),
			FULL_ROW_WIDTH, this::openWorld)));
	}

	/** Öffnet die Welt für Freunde und wartet dann auf die Bestätigung des Ports durch den Launcher (docs/bridge/README.md, "In-game navigation and world behavior"). */
	private void openWorld() {
		if (!Lan.publish()) {
			Toasts.showSystem(Text.translate("pumpkin_bridge.publish_failed"));
		}
	}

	private List<Row> publishedRows() {
		List<Row> rows = new ArrayList<>();
		rows.add(Row.text(Text.translate("pumpkin_bridge.share.published", link.topics().game().lanPort().getAsInt())));
		addInviteSection(rows, "pumpkin_bridge.section.invite");
		return rows;
	}

	private List<Row> sessionRows() {
		List<Row> rows = new ArrayList<>();
		link.topics().session().ifPresent(session -> addGuests(rows, session));
		rows.add(Row.fullWidth("share.stop", Widgets.button(Text.translate("pumpkin_bridge.stop_sharing"),
			FULL_ROW_WIDTH, this::stopSharing)));
		if (!Lan.canUnpublish()) {
			rows.add(Row.text(Text.translate("pumpkin_bridge.lan_stays_open")));
		}
		addInviteSection(rows, "pumpkin_bridge.share.invite_more");
		return rows;
	}

	private void addGuests(List<Row> rows, Session session) {
		rows.add(Row.heading(Text.translate("pumpkin_bridge.section.guests")));
		for (Session.Guest guest : session.guests()) {
			rows.add(Row.text(Text.translate("pumpkin_bridge.row", guest.name(),
					Text.translate("pumpkin_bridge.guest." + lowercase(guest.state()))))
				.withAction("guest.reinvite." + guest.id(), Widgets.button(Text.translate("pumpkin_bridge.share.reinvite"),
					ACTION_WIDTH, () -> run(Ops.hostInvite(Immutable.list(guest.id()), controls.showsWorldName()))))
				.withAction("guest.kick." + guest.id(), Widgets.button(Text.translate("pumpkin_bridge.kick"),
					ACTION_WIDTH, () -> run(Ops.hostKick(guest.id())))));
		}
	}

	/** The toggles of the invitable friends (max 7), the "Weltname zeigen" toggle and the [Einladen] button. */
	private void addInviteSection(List<Row> rows, String headingKey) {
		List<Friend> invitable = Invitees.of(link.topics().friends(), link.topics().session());
		controls.retainAll(invitable.stream().map(Friend::id).collect(Collectors.toSet()));
		if (invitable.isEmpty()) {
			return;
		}
		rows.add(Row.heading(Text.translate(headingKey)));
		for (Friend friend : invitable) {
			rows.add(Row.fullWidth("share.toggle." + friend.id(), Widgets.toggle(friend.name(),
				controls.isSelected(friend.id()), selected -> toggleFriend(friend.id(), selected))));
		}
		rows.add(Row.fullWidth("share.show_world", Widgets.toggle(Text.translate("pumpkin_bridge.share.show_world"),
			controls.showsWorldName(), ignored -> controls.toggleShowWorldName())));
		inviteButton = Widgets.button(Text.translate("pumpkin_bridge.invite"), FULL_ROW_WIDTH, this::invite);
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
		link.ask(Ops.hostStop()).thenAccept(ShareTab::endSharing);
	}

	private static void endSharing(Reply<?> reply) {
		Optional<OpError> error = reply.error();
		if (error.isPresent()) {
			Toasts.showError(error.get());
		} else {
			Lan.unpublish();
		}
	}

	/** Sends the operation; if the launcher refuses or does not answer, the player sees why as a toast. */
	private void run(Op<?> operation) {
		link.ask(operation).thenAccept(reply -> reply.error().ifPresent(Toasts::showError));
	}

	private static String lowercase(Enum<?> value) {
		return value.name().toLowerCase(Locale.ROOT);
	}
}
