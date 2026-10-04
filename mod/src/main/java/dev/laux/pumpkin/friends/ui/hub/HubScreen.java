package dev.laux.pumpkin.friends.ui.hub;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.bridge.LinkState;
import dev.laux.pumpkin.friends.compat.GameScreens;
import dev.laux.pumpkin.friends.compat.Text;
import dev.laux.pumpkin.friends.compat.Widgets;
import dev.laux.pumpkin.friends.json.WireNames;
import dev.laux.pumpkin.friends.request.Ops;
import dev.laux.pumpkin.friends.state.Friend;
import dev.laux.pumpkin.friends.state.FriendNotice;
import dev.laux.pumpkin.friends.state.Game;
import dev.laux.pumpkin.friends.state.Invite;
import dev.laux.pumpkin.friends.state.Me;
import dev.laux.pumpkin.friends.state.Requests;
import dev.laux.pumpkin.friends.state.Session;
import dev.laux.pumpkin.friends.state.TopicStore;
import dev.laux.pumpkin.friends.ui.kit.PumpkinScreen;
import dev.laux.pumpkin.friends.ui.kit.Row;
import dev.laux.pumpkin.friends.ui.model.Painter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import net.minecraft.client.gui.screens.Screen;

/**
 * The hub behind the pause-menu button (INGAME 6.1 to 6.3): title and status line for every link state, the five tabs,
 * the scrolling body and the footer. Freunde and Anfragen render their rows here; Einladungen, Teilen and Optionen come
 * from their own tab classes (package U2b). The hub opens on the tab with pending items (Anfragen, else Einladungen,
 * else Freunde) and rebuilds itself whenever the launcher's state changes; a rebuild keeps text, focus, scroll position
 * and tab (INGAME 6.5).
 */
public class HubScreen extends PumpkinScreen {
	/** INGAME 5.4, host.invite: at most seven guests share one world. */
	static final int MAX_GUESTS = 7;
	private static final int ACTION_WIDTH = 68;
	private static final int OPEN_WIDTH = 130;

	private final BridgeClient client;
	private final RetryCooldown deliverCooldown = new RetryCooldown();
	private final InvitesTab invites;
	private final ShareTab share;
	private final OptionsTab options;
	private Snapshot shown;
	private HubCondition condition;
	private boolean opened;

	public HubScreen(Screen parent, BridgeClient client) {
		super(Text.translate("pumpkin_friends.title"), parent);
		this.client = client;
		this.invites = new InvitesTab(client, this);
		this.share = new ShareTab(ShareLink.to(client));
		this.options = new OptionsTab(client);
	}

	@Override
	protected List<String> tabLabels() {
		refreshView();
		chooseOpeningTabOnce();
		return Arrays.stream(HubTab.values()).map(this::tabTitle).toList();
	}

	/** The first build opens on pending items (INGAME 6.1); afterwards the keeper holds the player's tab. */
	private void chooseOpeningTabOnce() {
		if (!opened) {
			opened = true;
			state().rememberSelectedTab(HubTab.openingTab(shown.requests().incoming().size(), shown.invites().size()).ordinal());
		}
	}

	@Override
	protected List<Row> rows(int tab) {
		refreshView();
		if (!condition.showsContent()) {
			return conditionRows();
		}
		return switch (HubTab.values()[tab]) {
			case FRIENDS -> friendRows();
			case REQUESTS -> requestRows();
			case INVITES -> invites.rows();
			case SHARE -> share.rows();
			case OPTIONS -> options.rows();
		};
	}

	@Override
	protected String statusLine() {
		return condition == null || condition.statusKey().isEmpty() ? "" : Text.translate(condition.statusKey());
	}

	@Override
	protected Optional<FooterButton> extraFooterButton() {
		return switch (currentTab()) {
			case FRIENDS -> Optional.of(new FooterButton(Text.translate("pumpkin_friends.friends.add"), this::openAddFriend));
			case REQUESTS -> delivering()
				? Optional.of(new FooterButton(Text.translate("pumpkin_friends.requests.deliverNow"), this::deliverNow))
				: Optional.empty();
			default -> Optional.empty();
		};
	}

	@Override
	protected void onTick() {
		super.onTick();
		if (!snapshot().equals(shown)) {
			rebuildWidgets();
		}
		refreshDeliverButton();
	}

	/** The render proof of the Teilen tab: it logs every state it has shown once (the dev proof of package U2b). */
	@Override
	protected void paint(Painter painter) {
		super.paint(painter);
		if (condition != null && condition.showsContent() && currentTab() == HubTab.SHARE) {
			share.onRendered(width, height);
		}
	}

	private HubTab currentTab() {
		return HubTab.values()[Math.max(0, Math.min(selectedTab(), HubTab.values().length - 1))];
	}

	private void refreshView() {
		shown = snapshot();
		condition = HubCondition.of(shown.link(), shown.awaitingDialog(), shown.me());
	}

	private String tabTitle(HubTab tab) {
		int badge = tab.badge(shown.requests(), shown.invites());
		String label = Text.translate(tab.labelKey());
		return badge == 0 ? label : label + " (" + badge + ")";
	}

	private List<Row> conditionRows() {
		List<Row> rows = new ArrayList<>();
		rows.add(Row.text(Text.translate(condition.statusKey())));
		if (condition.offersLauncherOpen()) {
			rows.add(Row.fullWidth("hub.openLauncher", Widgets.button(Text.translate("pumpkin_friends.open_launcher"),
				OPEN_WIDTH, () -> client.request(Ops.launcherOpen(condition.openTarget())))));
		}
		return rows;
	}

	// ---- Freunde (INGAME 6.2) ----

	private List<Row> friendRows() {
		List<Row> rows = new ArrayList<>();
		if (shown.friends().isEmpty()) {
			return List.of(Row.text(Text.translate("pumpkin_friends.no_friends")));
		}
		for (Friend friend : shown.friends()) {
			rows.add(friendRow(friend));
		}
		return rows;
	}

	private Row friendRow(Friend friend) {
		Row row = Row.twoLines(friend.name(), subLineOf(friend));
		if (invitable(friend)) {
			row.withAction("friend.invite." + friend.id(), Widgets.button(Text.translate("pumpkin_friends.invite"),
				ACTION_WIDTH, () -> HubOps.run(this, client, Ops.hostInvite(List.of(friend.id()), false))));
		}
		return row;
	}

	private static String subLineOf(Friend friend) {
		String presence = Text.translate("pumpkin_friends.presence." + WireNames.of(friend.presence()));
		return friend.notice().map(notice -> presence + " · " + noticeText(notice)).orElse(presence);
	}

	private static String noticeText(FriendNotice notice) {
		return notice instanceof FriendNotice.Renamed renamed
			? Text.translate("pumpkin_friends.friends.notice.renamed", renamed.previousName())
			: Text.translate("pumpkin_friends.friends.notice.identityChanged");
	}

	/**
	 * The quick invite of a friend row: the friend is online, not a guest yet, and the world is published, because
	 * {@code host.invite} shares the published LAN world (INGAME 5.4). Publishing itself is the Teilen tab.
	 */
	private boolean invitable(Friend friend) {
		if (!friend.isOnline()) {
			return false;
		}
		List<Session.Guest> guests = shown.session().map(Session::guests).orElse(List.of());
		boolean room = guests.size() < MAX_GUESTS && guests.stream().noneMatch(guest -> guest.id().equals(friend.id()));
		return room && shown.game().lanPort().isPresent();
	}

	private void openAddFriend() {
		GameScreens.show(new AddFriendScreen(this, client));
	}

	// ---- Anfragen (INGAME 6.2) ----

	private List<Row> requestRows() {
		List<Row> rows = new ArrayList<>();
		Requests requests = shown.requests();
		if (requests.incoming().isEmpty() && requests.outgoing().isEmpty()) {
			return List.of(Row.text(Text.translate("pumpkin_friends.requests.empty")));
		}
		if (!requests.incoming().isEmpty()) {
			rows.add(Row.heading(Text.translate("pumpkin_friends.requests.incoming")));
			requests.incoming().forEach(incoming -> rows.add(incomingRow(incoming)));
		}
		if (!requests.outgoing().isEmpty()) {
			rows.add(Row.heading(Text.translate("pumpkin_friends.requests.outgoing")));
			requests.outgoing().forEach(outgoing -> rows.add(outgoingRow(outgoing)));
		}
		return rows;
	}

	private Row incomingRow(Requests.Incoming incoming) {
		String secondLine = incoming.mcName()
			.map(mcName -> Text.translate("pumpkin_friends.requests.mc", mcName) + " · " + incoming.fingerprint())
			.orElse(incoming.fingerprint());
		return Row.twoLines(incoming.name(), secondLine)
			.withAction("request.accept." + incoming.id(), Widgets.button(Text.translate("pumpkin_friends.requests.accept"),
				ACTION_WIDTH, () -> HubOps.run(this, client, Ops.requestAnswer(incoming.id(), true))))
			.withAction("request.decline." + incoming.id(), Widgets.button(Text.translate("pumpkin_friends.requests.decline"),
				ACTION_WIDTH, () -> HubOps.run(this, client, Ops.requestAnswer(incoming.id(), false))));
	}

	private Row outgoingRow(Requests.Outgoing outgoing) {
		String state = Text.translate("pumpkin_friends.requests.state." + WireNames.of(outgoing.state()));
		String line = outgoing.name()
			.map(name -> Text.translate("pumpkin_friends.requests.row.named", name, state))
			.orElseGet(() -> Text.translate("pumpkin_friends.requests.row.unnamed", state));
		return Row.text(line).withAction("request.withdraw." + outgoing.id(),
			Widgets.button(Text.translate("pumpkin_friends.requests.withdraw"), ACTION_WIDTH,
				() -> HubOps.run(this, client, Ops.requestCancel(outgoing.id()))));
	}

	/** The footer offers the redelivery only while something waits for delivery. */
	private boolean delivering() {
		return shown.requests().outgoing().stream().anyMatch(outgoing -> outgoing.state() == Requests.State.DELIVERING);
	}

	private void deliverNow() {
		long now = System.currentTimeMillis();
		if (!deliverCooldown.canSend(now)) {
			return;
		}
		deliverCooldown.markSent(now);
		HubOps.run(this, client, Ops.friendsRetry());
	}

	/** The deliver button greys out for the cooldown; the other tabs' footer actions are not its business. */
	private void refreshDeliverButton() {
		if (currentTab() == HubTab.REQUESTS) {
			extraFooterWidget().ifPresent(button -> button.active = deliverCooldown.canSend(System.currentTimeMillis()));
		}
	}

	private Snapshot snapshot() {
		TopicStore topics = client.topics();
		return new Snapshot(client.state(), client.isAwaitingLauncherDialog(), topics.me(), topics.friends(), topics.requests(),
			topics.invites(), topics.session(), topics.game());
	}

	/** Everything the hub shows; a change of any of it rebuilds the screen. */
	private record Snapshot(LinkState link, boolean awaitingDialog, Optional<Me> me, List<Friend> friends, Requests requests,
			List<Invite> invites, Optional<Session> session, Game game) {
	}
}
