package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import dev.laux.pumpkin.bridge.modules.friends.state.Invite;
import dev.laux.pumpkin.bridge.modules.friends.state.Requests;
import java.util.List;

/**
 * The five tabs of the hub (INGAME 6.2); the enum order is the tab order on screen. Freunde and Anfragen belong to
 * package U2a, Einladungen, Teilen and Optionen to U2b.
 */
public enum HubTab {
	FRIENDS("pumpkin_bridge.hub.tab.friends"),
	REQUESTS("pumpkin_bridge.hub.tab.requests"),
	INVITES("pumpkin_bridge.hub.tab.invites"),
	SHARE("pumpkin_bridge.hub.tab.share"),
	OPTIONS("pumpkin_bridge.hub.tab.options");

	private final String labelKey;

	HubTab(String labelKey) {
		this.labelKey = labelKey;
	}

	public String labelKey() {
		return labelKey;
	}

	/** How many open items the tab title announces ("Anfragen (n)", INGAME 6.2); tabs without a count carry none. */
	public int badge(Requests requests, List<Invite> invites) {
		return switch (this) {
			case REQUESTS -> requests.incoming().size() + requests.outgoing().size();
			case INVITES -> invites.size();
			default -> 0;
		};
	}

	/** The tab every entry point opens the hub on (INGAME 6.1): pending items first, else the friends. */
	public static HubTab openingTab(int incomingRequests, int invites) {
		if (incomingRequests > 0) {
			return REQUESTS;
		}
		return invites > 0 ? INVITES : FRIENDS;
	}
}
