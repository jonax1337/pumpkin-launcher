package dev.laux.pumpkin.bridge.modules.friends.ui;

import dev.laux.pumpkin.bridge.compat.Text;
import dev.laux.pumpkin.bridge.modules.friends.FriendsClient;
import dev.laux.pumpkin.bridge.modules.friends.state.Friend;
import dev.laux.pumpkin.bridge.modules.friends.state.Me;
import dev.laux.pumpkin.bridge.modules.friends.state.Requests;
import dev.laux.pumpkin.bridge.modules.friends.state.Invite;
import dev.laux.pumpkin.bridge.transport.LinkState;
import dev.laux.pumpkin.bridge.ui.kit.BridgeIcons;
import dev.laux.pumpkin.bridge.ui.kit.BridgeModule;
import dev.laux.pumpkin.bridge.ui.model.PixelIcon;
import java.util.List;
import java.util.Optional;
import net.minecraft.client.gui.screens.Screen;

public final class FriendsModule implements BridgeModule {
	private final FriendsClient client;
	private FriendsScreen screen;
	private LinkState shownLink;
	private List<Friend> shownFriends;
	private Optional<Me> shownMe;
	private Requests shownRequests;
	private List<Invite> shownInvites;
	private String summary = "";

	public FriendsModule(FriendsClient client) {
		this.client = client;
	}

	@Override
	public String id() {
		return "friends";
	}

	@Override
	public String title() {
		return Text.translate("pumpkin_bridge.home.friends.title");
	}

	@Override
	public String description() {
		return Text.translate("pumpkin_bridge.home.friends.description");
	}

	@Override
	public String summary() {
		dev.laux.pumpkin.bridge.modules.friends.state.TopicStore topics = client.topics();
		List<Friend> friends = topics.friends();
		Optional<Me> me = topics.me();
		Requests requests = topics.requests();
		List<Invite> invites = topics.invites();
		if (!client.state().equals(shownLink) || !friends.equals(shownFriends) || !me.equals(shownMe)
			|| !requests.equals(shownRequests) || !invites.equals(shownInvites)) {
			shownLink = client.state();
			shownFriends = friends;
			shownMe = me;
			shownRequests = requests;
			shownInvites = invites;
			summary = currentSummary(friends, me, requests, invites);
		}
		return summary;
	}

	private String currentSummary(List<Friend> friends, Optional<Me> me, Requests requests, List<Invite> invites) {
		if (!client.isConnected()) {
			return Text.translate("pumpkin_bridge.home.friends.offline");
		}
		if (!me.isPresent()) {
			return Text.translate("pumpkin_bridge.home.friends.loading");
		}
		if (!me.get().enabled()) {
			return Text.translate("pumpkin_bridge.home.friends.disabled");
		}
		int pending = requests.incoming().size() + invites.size();
		long online = friends.stream().filter(Friend::isOnline).count();
		return Text.translate(pending == 0 ? "pumpkin_bridge.home.friends.online" : "pumpkin_bridge.home.friends.pending", online, pending);
	}

	@Override
	public PixelIcon icon() {
		return BridgeIcons.FRIENDS;
	}

	@Override
	public Screen screen(Screen parent) {
		if (screen == null) {
			screen = new FriendsScreen(parent, client);
		}
		return screen;
	}
}
