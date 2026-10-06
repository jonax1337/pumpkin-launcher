package dev.laux.pumpkin.bridge.modules.friends.ui;

import java.util.Objects;
import dev.laux.pumpkin.bridge.runtime.Immutable;

import dev.laux.pumpkin.bridge.modules.friends.ui.model.HubCondition;
import dev.laux.pumpkin.bridge.modules.friends.ui.model.HubTab;

import dev.laux.pumpkin.bridge.modules.friends.FriendsClient;
import dev.laux.pumpkin.bridge.transport.LinkState;
import dev.laux.pumpkin.bridge.compat.GameScreens;
import dev.laux.pumpkin.bridge.compat.Text;
import dev.laux.pumpkin.bridge.compat.Widgets;
import dev.laux.pumpkin.bridge.protocol.json.WireNames;
import dev.laux.pumpkin.bridge.modules.friends.protocol.Ops;
import dev.laux.pumpkin.bridge.modules.friends.state.Friend;
import dev.laux.pumpkin.bridge.modules.friends.state.FriendNotice;
import dev.laux.pumpkin.bridge.modules.friends.state.Game;
import dev.laux.pumpkin.bridge.modules.friends.state.Invite;
import dev.laux.pumpkin.bridge.modules.friends.state.Join;
import dev.laux.pumpkin.bridge.modules.friends.state.Me;
import dev.laux.pumpkin.bridge.modules.friends.state.Requests;
import dev.laux.pumpkin.bridge.modules.friends.state.Session;
import dev.laux.pumpkin.bridge.modules.friends.state.TopicStore;
import dev.laux.pumpkin.bridge.ui.kit.PumpkinScreen;
import dev.laux.pumpkin.bridge.ui.kit.Row;
import dev.laux.pumpkin.bridge.ui.model.Painter;
import dev.laux.pumpkin.bridge.ui.model.PumpkinTheme;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import net.minecraft.client.gui.screens.Screen;

/**
 * The Friends module below the Pumpkin home (docs/bridge/README.md, "In-game navigation and world behavior"): title and status line for every link state, the five tabs,
 * the scrolling body and the footer. Freunde and Anfragen render their rows here; Einladungen, Teilen and Optionen come
 * from their own tab classes (package U2b). The hub opens on the tab with pending items (Anfragen, else Einladungen,
 * else Freunde) and rebuilds itself whenever the launcher's state changes; a rebuild keeps text, focus, scroll position
 * and tab (docs/bridge/README.md, "In-game navigation and world behavior").
 */
public class FriendsScreen extends PumpkinScreen {
	/** docs/bridge/README.md, "Operations and consent", host.invite: at most seven guests share one world. */
	static final int MAX_GUESTS = 7;
	private static final int ACTION_WIDTH = 68;
	private static final int OPEN_WIDTH = 130;

	private final FriendsClient client;
	private final InvitesTab invites;
	private final ShareTab share;
	private final OptionsTab options;
	private Snapshot shown;
	private HubCondition condition;
	private boolean opened;
	private String headerStatus = "";

	public FriendsScreen(Screen parent, FriendsClient client) {
		super("pumpkin_bridge.friends.title", parent);
		this.client = client;
		this.invites = new InvitesTab(client, this);
		this.share = new ShareTab(ShareLink.to(client));
		this.options = new OptionsTab(client);
	}

	@Override
	protected List<String> tabLabels() {
		refreshView();
		chooseOpeningTabOnce();
		return Arrays.stream(HubTab.values()).map(this::tabTitle).collect(Immutable.toList());
	}

	/** The first build opens on pending items (docs/bridge/README.md, "In-game navigation and world behavior"); afterwards the keeper holds the player's tab. */
	private void chooseOpeningTabOnce() {
		if (!opened) {
			opened = true;
			state().rememberSelectedTab(HubTab.openingTab(shown.incoming().size(), shown.invites().size()).ordinal());
		}
	}

	@Override
	protected List<Row> rows(int tab) {
		refreshView();
		if (!condition.showsContent()) {
			return conditionRows();
		}
		switch (HubTab.values()[tab]) {
			case FRIENDS:
				return friendRows();
			case REQUESTS:
				return requestRows();
			case INVITES:
				return invites.rows();
			case SHARE:
				return share.rows();
			case OPTIONS:
				return options.rows();
			default:
				throw new IncompatibleClassChangeError();
		}
	}

	@Override
	protected String statusLine() {
		return headerStatus;
	}

	@Override
	protected Optional<FooterButton> extraFooterButton() {
		if (condition == null || !condition.showsContent()) {
			return Optional.empty();
		}
		switch (currentTab()) {
			case FRIENDS:
				return Optional.of(new FooterButton(Text.translate("pumpkin_bridge.friends.add"), this::openAddFriend));
			case REQUESTS:
				return delivering()
				? Optional.of(new FooterButton(Text.translate("pumpkin_bridge.requests.deliverNow"), this::deliverNow))
				: Optional.empty();
			default:
				return Optional.empty();
		}
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
		condition = HubCondition.of(shown.link(), shown.awaitingDialog(), shown.me(), client.topics()::received);
		if (condition.showsContent()) {
			long online = shown.friends().stream().filter(Friend::isOnline).count();
			headerStatus = Text.translate("pumpkin_bridge.hub.summary", shown.friends().size(), online);
		} else {
			headerStatus = condition.statusKey().isEmpty() ? "" : Text.translate(condition.statusKey());
		}
	}

	private String tabTitle(HubTab tab) {
		// The badge counts entries only; the pushed cooldown would rename the tab every second.
		int badge = tab.badge(new Requests(shown.incoming(), shown.outgoing(), 0), shown.invites());
		String label = Text.translate(tab.labelKey());
		return badge == 0 ? label : label + " (" + badge + ")";
	}

	private List<Row> conditionRows() {
		List<Row> rows = new ArrayList<>();
		rows.add(Row.text(Text.translate(condition.statusKey())));
		if (condition.offersLauncherOpen()) {
			rows.add(Row.fullWidth("hub.openLauncher", Widgets.button(Text.translate("pumpkin_bridge.open_launcher"),
				OPEN_WIDTH, () -> client.request(Ops.launcherOpen(condition.openTarget())))));
		}
		return rows;
	}

	// ---- Freunde (docs/bridge/README.md, "In-game navigation and world behavior") ----

	private List<Row> friendRows() {
		if (shown.friends().isEmpty()) {
			return Immutable.list(Row.text(Text.translate("pumpkin_bridge.no_friends")));
		}
		List<Row> rows = new ArrayList<>();
		List<Friend> online = shown.friends().stream().filter(Friend::isOnline).collect(Immutable.toList());
		List<Friend> offline = shown.friends().stream().filter(friend -> !friend.isOnline()).collect(Immutable.toList());
		addFriendGroup(rows, online, "pumpkin_bridge.friends.group.online");
		addFriendGroup(rows, offline, "pumpkin_bridge.friends.group.offline");
		return rows;
	}

	private void addFriendGroup(List<Row> rows, List<Friend> friends, String titleKey) {
		if (friends.isEmpty()) {
			return;
		}
		rows.add(Row.heading(Text.translate(titleKey, friends.size())));
		for (Friend friend : friends) {
			rows.add(friendRow(friend));
		}
	}

	private Row friendRow(Friend friend) {
		String presence = WireNames.of(friend.presence());
		String detail = friend.notice().map(FriendsScreen::noticeText)
			.orElseGet(() -> Text.translate("pumpkin_bridge.friends.detail." + presence));
		Row row = Row.friend(friend.name(), friend.mcUuid(), detail,
			Text.translate("pumpkin_bridge.presence." + presence), presenceColor(friend.presence()));
		if (invitable(friend)) {
			row.withAction("friend.invite." + friend.id(), Widgets.button(Text.translate("pumpkin_bridge.invite"),
				ACTION_WIDTH, () -> HubOps.run(this, client, Ops.hostInvite(Immutable.list(friend.id()), false))));
		}
		return row;
	}

	private static int presenceColor(Friend.Presence presence) {
		switch (presence) {
			case ONLINE:
				return PumpkinTheme.ONLINE;
			case PLAYING:
				return PumpkinTheme.PLAYING;
			case OFFLINE:
				return PumpkinTheme.OFFLINE;
			default:
				throw new IncompatibleClassChangeError();
		}
	}

	private static String noticeText(FriendNotice notice) {
		return notice instanceof FriendNotice.Renamed
			? Text.translate("pumpkin_bridge.friends.notice.renamed", ((FriendNotice.Renamed) notice).previousName())
			: Text.translate("pumpkin_bridge.friends.notice.identityChanged");
	}

	/**
	 * The quick invite of a friend row: the friend is online, not a guest yet, and the world is published, because
	 * {@code host.invite} shares the published LAN world (docs/bridge/README.md, "Operations and consent"). Publishing itself is the Teilen tab.
	 */
	private boolean invitable(Friend friend) {
		if (!friend.isOnline()) {
			return false;
		}
		List<Session.Guest> guests = shown.session().map(Session::guests).orElse(Immutable.list());
		boolean room = guests.size() < MAX_GUESTS && guests.stream().noneMatch(guest -> guest.id().equals(friend.id()));
		return room && shown.game().lanPort().isPresent();
	}

	private void openAddFriend() {
		GameScreens.show(new AddFriendScreen(this, client));
	}

	// ---- Anfragen (docs/bridge/README.md, "In-game navigation and world behavior") ----

	private List<Row> requestRows() {
		List<Row> rows = new ArrayList<>();
		if (shown.incoming().isEmpty() && shown.outgoing().isEmpty()) {
			return Immutable.list(Row.text(Text.translate("pumpkin_bridge.requests.empty")));
		}
		if (!shown.incoming().isEmpty()) {
			rows.add(Row.heading(Text.translate("pumpkin_bridge.requests.incoming")));
			shown.incoming().forEach(incoming -> rows.add(incomingRow(incoming)));
		}
		if (!shown.outgoing().isEmpty()) {
			rows.add(Row.heading(Text.translate("pumpkin_bridge.requests.outgoing")));
			shown.outgoing().forEach(outgoing -> rows.add(outgoingRow(outgoing)));
		}
		return rows;
	}

	private Row incomingRow(Requests.Incoming incoming) {
		String secondLine = incoming.mcName()
			.map(mcName -> Text.translate("pumpkin_bridge.requests.mc", mcName) + " · " + incoming.fingerprint())
			.orElse(incoming.fingerprint());
		return Row.twoLines(incoming.name(), secondLine)
			.withAction("request.accept." + incoming.id(), Widgets.button(Text.translate("pumpkin_bridge.requests.accept"),
				ACTION_WIDTH, () -> HubOps.run(this, client, Ops.requestAnswer(incoming.id(), true))))
			.withAction("request.decline." + incoming.id(), Widgets.button(Text.translate("pumpkin_bridge.requests.decline"),
				ACTION_WIDTH, () -> HubOps.run(this, client, Ops.requestAnswer(incoming.id(), false))));
	}

	private Row outgoingRow(Requests.Outgoing outgoing) {
		String state = Text.translate("pumpkin_bridge.requests.state." + WireNames.of(outgoing.state()));
		String line = outgoing.name()
			.map(name -> Text.translate("pumpkin_bridge.requests.row.named", name, state))
			.orElseGet(() -> Text.translate("pumpkin_bridge.requests.row.unnamed", state));
		return Row.text(line).withAction("request.withdraw." + outgoing.id(),
			Widgets.button(Text.translate("pumpkin_bridge.requests.withdraw"), ACTION_WIDTH,
				() -> HubOps.run(this, client, Ops.requestCancel(outgoing.id()))));
	}

	/** The footer offers the redelivery only while something waits for delivery. */
	private boolean delivering() {
		return shown.outgoing().stream().anyMatch(outgoing -> outgoing.state() == Requests.State.DELIVERING);
	}

	private void deliverNow() {
		if (deliverCooldownMillis() > 0) {
			return;
		}
		HubOps.run(this, client, Ops.friendsRetry());
	}

	/** The launcher's own cooldown (docs/bridge/README.md), pushed with the requests topic; it re-pushes about once a second. */
	private long deliverCooldownMillis() {
		return client.topics().retryCooldownMillis(System.currentTimeMillis());
	}

	/** The deliver button greys out for the cooldown; the other tabs' footer actions are not its business. */
	private void refreshDeliverButton() {
		if (currentTab() == HubTab.REQUESTS) {
			extraFooterWidget().ifPresent(button -> button.active = deliverCooldownMillis() == 0);
		}
	}

	private Snapshot snapshot() {
		TopicStore topics = client.topics();
		return new Snapshot(client.state(), client.isAwaitingLauncherDialog(), topics.me(), topics.friends(),
			topics.requests().incoming(), topics.requests().outgoing(), topics.invites(), topics.session(), topics.join(),
			topics.game());
	}

	/**
	 * Everything the hub shows; a change of any of it rebuilds the screen. The requests go in as lists, not as one
	 * value: the pushed cooldown ticks every second and must grey the footer button, not rebuild the screen.
	 */
	private static final class Snapshot {
		private final LinkState link;
		private final boolean awaitingDialog;
		private final Optional<Me> me;
		private final List<Friend> friends;
		private final List<Requests.Incoming> incoming;
		private final List<Requests.Outgoing> outgoing;
		private final List<Invite> invites;
		private final Optional<Session> session;
		private final Optional<Join> join;
		private final Game game;

		private Snapshot(LinkState link, boolean awaitingDialog, Optional<Me> me, List<Friend> friends, List<Requests.Incoming> incoming, List<Requests.Outgoing> outgoing, List<Invite> invites, Optional<Session> session, Optional<Join> join, Game game) {
			this.link = link;
			this.awaitingDialog = awaitingDialog;
			this.me = me;
			this.friends = friends;
			this.incoming = incoming;
			this.outgoing = outgoing;
			this.invites = invites;
			this.session = session;
			this.join = join;
			this.game = game;
		}

		public LinkState link() {
			return link;
		}

		public boolean awaitingDialog() {
			return awaitingDialog;
		}

		public Optional<Me> me() {
			return me;
		}

		public List<Friend> friends() {
			return friends;
		}

		public List<Requests.Incoming> incoming() {
			return incoming;
		}

		public List<Requests.Outgoing> outgoing() {
			return outgoing;
		}

		public List<Invite> invites() {
			return invites;
		}

		public Optional<Session> session() {
			return session;
		}

		public Optional<Join> join() {
			return join;
		}

		public Game game() {
			return game;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Snapshot)) {
				return false;
			}
			Snapshot that = (Snapshot) other;
			return Objects.equals(link, that.link)
				&& awaitingDialog == that.awaitingDialog
				&& Objects.equals(me, that.me)
				&& Objects.equals(friends, that.friends)
				&& Objects.equals(incoming, that.incoming)
				&& Objects.equals(outgoing, that.outgoing)
				&& Objects.equals(invites, that.invites)
				&& Objects.equals(session, that.session)
				&& Objects.equals(join, that.join)
				&& Objects.equals(game, that.game);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(link);
			hash = 31 * hash + Boolean.hashCode(awaitingDialog);
			hash = 31 * hash + Objects.hashCode(me);
			hash = 31 * hash + Objects.hashCode(friends);
			hash = 31 * hash + Objects.hashCode(incoming);
			hash = 31 * hash + Objects.hashCode(outgoing);
			hash = 31 * hash + Objects.hashCode(invites);
			hash = 31 * hash + Objects.hashCode(session);
			hash = 31 * hash + Objects.hashCode(join);
			hash = 31 * hash + Objects.hashCode(game);
			return hash;
		}

		@Override
		public String toString() {
			return "Snapshot[link=" + link + ", awaitingDialog=" + awaitingDialog + ", me=" + me + ", friends=" + friends + ", incoming=" + incoming + ", outgoing=" + outgoing + ", invites=" + invites + ", session=" + session + ", join=" + join + ", game=" + game + "]";
		}
	}
}
