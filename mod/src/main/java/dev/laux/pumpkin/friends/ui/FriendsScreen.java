package dev.laux.pumpkin.friends.ui;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.bridge.LinkState;
import dev.laux.pumpkin.friends.compat.Lan;
import dev.laux.pumpkin.friends.compat.Text;
import dev.laux.pumpkin.friends.state.Friend;
import dev.laux.pumpkin.friends.state.Game;
import dev.laux.pumpkin.friends.state.Invite;
import dev.laux.pumpkin.friends.state.Join;
import dev.laux.pumpkin.friends.state.Session;
import dev.laux.pumpkin.friends.ui.hub.InvitesTab;
import dev.laux.pumpkin.friends.ui.hub.OptionsTab;
import dev.laux.pumpkin.friends.ui.hub.ShareTab;
import dev.laux.pumpkin.friends.ui.kit.PumpkinScreen;
import dev.laux.pumpkin.friends.ui.kit.Row;
import dev.laux.pumpkin.friends.ui.model.Painter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.OptionalInt;
import net.minecraft.client.gui.screens.Screen;

/**
 * The friends screen from the pause menu, as the interim home of the hub tabs: the friend list stays here, Einladungen,
 * Teilen and Optionen (package U2b) hang as tabs beside it behind the same navigation. The hub of package U2 replaces
 * this screen; its tabs then take the three tab classes over unchanged. Rebuilds itself whenever the shown state changes.
 */
public final class FriendsScreen extends PumpkinScreen {
	private static final int FRIENDS_TAB = 0;
	private static final int INVITES_TAB = 1;
	private static final int SHARE_TAB = 2;
	private static final int OPTIONS_TAB = 3;

	private final BridgeClient client;
	private final InvitesTab invites;
	private final ShareTab share;
	private final OptionsTab options;
	private View shown;

	public FriendsScreen(Screen parent, BridgeClient client) {
		super(Text.translate("pumpkin_friends.title"), parent);
		this.client = client;
		this.invites = new InvitesTab(client, this);
		this.share = new ShareTab(client);
		this.options = new OptionsTab(client);
	}

	@Override
	protected List<String> tabLabels() {
		return List.of(Text.translate("pumpkin_friends.tab.friends"), Text.translate("pumpkin_friends.tab.invites"),
			Text.translate("pumpkin_friends.tab.share"), Text.translate("pumpkin_friends.tab.options"));
	}

	@Override
	protected List<Row> rows(int tab) {
		shown = currentView();
		if (!shown.connected()) {
			return List.of(Row.text(Text.translate("pumpkin_friends.disconnected")));
		}
		return switch (tab) {
			case INVITES_TAB -> invites.rows();
			case SHARE_TAB -> share.rows();
			case OPTIONS_TAB -> options.rows();
			default -> friendRows();
		};
	}

	@Override
	protected String statusLine() {
		return shown != null && shown.awaitingConfirmation() ? Text.translate("pumpkin_friends.confirm_in_launcher") : "";
	}

	@Override
	public void onTick() {
		super.onTick();
		if (!currentView().equals(shown)) {
			rebuildWidgets();
		}
	}

	@Override
	protected void paint(Painter painter) {
		super.paint(painter);
		if (shown != null && shown.connected() && selectedTab() == SHARE_TAB) {
			share.onRendered(width, height);
		}
	}

	private List<Row> friendRows() {
		List<Row> rows = new ArrayList<>();
		rows.add(Row.heading(Text.translate("pumpkin_friends.section.friends")));
		if (shown.friends().isEmpty()) {
			rows.add(Row.text(Text.translate("pumpkin_friends.no_friends")));
		}
		for (Friend friend : shown.friends()) {
			rows.add(Row.text(Text.translate("pumpkin_friends.row", friend.name(),
				Text.translate("pumpkin_friends.presence." + lowercase(friend.presence())))));
		}
		return rows;
	}

	private View currentView() {
		return new View(client.isConnected(), client.state(), client.topics().friends(), client.topics().invites(),
			client.topics().session(), client.topics().join(), client.topics().game(), Lan.canPublish(),
			Lan.publishedPort(), client.isAwaitingLauncherDialog());
	}

	private static String lowercase(Enum<?> value) {
		return value.name().toLowerCase(Locale.ROOT);
	}

	/** Alles, was die Reiter zeigen; ändert sich etwas davon, wird der Bildschirm neu aufgebaut. */
	private record View(boolean connected, LinkState link, List<Friend> friends, List<Invite> invites,
			Optional<Session> session, Optional<Join> join, Game game, boolean canPublish, OptionalInt publishedPort,
			boolean awaitingConfirmation) {
	}
}
