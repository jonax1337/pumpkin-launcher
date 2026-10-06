package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.laux.pumpkin.bridge.modules.friends.state.Invite;
import dev.laux.pumpkin.bridge.modules.friends.state.Requests;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** Tab order, badges and the opening tab of the hub (docs/bridge/README.md, "In-game navigation and world behavior"). */
class HubTabTest {
	private final Requests onlyOutgoing = new Requests(List.of(),
		List.of(new Requests.Outgoing("r3", Optional.empty(), Requests.State.DELIVERING)), 0);

	@Test
	void theTabsAppearInTheOrderOfTheDesign() {
		assertEquals(List.of(HubTab.FRIENDS, HubTab.REQUESTS, HubTab.INVITES, HubTab.SHARE, HubTab.OPTIONS),
			List.of(HubTab.values()));
	}

	@Test
	void theAnfragenBadgeCountsEveryOpenRequestAndEinladungenTheInvites() {
		Requests requests = new Requests(
			List.of(new Requests.Incoming("r1", "Sam", Optional.empty(), "ab12"),
				new Requests.Incoming("r2", "Alex", Optional.empty(), "cd34")),
			List.of(new Requests.Outgoing("r3", Optional.of("Kim"), Requests.State.DELIVERING)), 0);
		List<Invite> invites = List.of(new Invite("i1", "Sam", "Insel"));

		assertEquals(3, HubTab.REQUESTS.badge(requests, invites));
		assertEquals(1, HubTab.INVITES.badge(requests, invites));
		assertEquals(0, HubTab.FRIENDS.badge(requests, invites), "Freunde carries no badge");
		assertEquals(0, HubTab.SHARE.badge(requests, invites));
		assertEquals(0, HubTab.OPTIONS.badge(requests, invites));
	}

	@Test
	void theHubOpensOnRequestsOnlyForIncomingOnes() {
		assertEquals(HubTab.REQUESTS, HubTab.openingTab(1, 0));
		assertEquals(HubTab.REQUESTS, HubTab.openingTab(2, 3), "incoming requests outrank invites");
		assertEquals(HubTab.INVITES, HubTab.openingTab(0, 1), "without incoming requests invites come first");
		assertEquals(HubTab.FRIENDS, HubTab.openingTab(0, 0));
		assertEquals(HubTab.FRIENDS, HubTab.openingTab(onlyOutgoing.incoming().size(), 0),
			"outgoing requests do not open the tab");
	}

	@Test
	void everyTabNamesItsLabelKey() {
		for (HubTab tab : HubTab.values()) {
			assertEquals("pumpkin_bridge.hub.tab." + tab.name().toLowerCase(Locale.ROOT), tab.labelKey());
		}
	}

	@Test
	void aTabWithoutOpenItemsCountsNothing() {
		Requests none = Requests.NONE;

		assertEquals(0, HubTab.REQUESTS.badge(none, List.of()));
		assertEquals(0, HubTab.INVITES.badge(none, List.of()));
	}
}
