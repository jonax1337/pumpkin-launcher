package dev.laux.pumpkin.friends.ui.hub;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.laux.pumpkin.friends.bridge.LinkState;
import dev.laux.pumpkin.friends.json.WireNames;
import dev.laux.pumpkin.friends.protocol.RejectReason;
import dev.laux.pumpkin.friends.request.Ops.OpenTarget;
import dev.laux.pumpkin.friends.state.Me;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** Every state of INGAME 6.3 is reachable and says its text, its action and whether the tabs show content. */
class HubConditionTest {
	private static final Me ENABLED = new Me(true, Me.Availability.AVAILABLE, Me.Network.ONLINE, Optional.of("ab12"), Me.Directory.ACTIVE);

	@Test
	void withoutALinkTheHubExplainsThatItConnects() {
		HubCondition condition = HubCondition.of(LinkState.OFFLINE, false, Optional.empty());

		assertInstanceOf(HubCondition.Connecting.class, condition);
		assertEquals("pumpkin_friends.hub.state.connecting", condition.statusKey());
		assertFalse(condition.showsContent());
		assertFalse(condition.offersLauncherOpen(), "there is nothing to open in the launcher about a broken link");
	}

	@Test
	void aRetryRefusalIsStillConnectingBecauseTheClientKeepsTrying() {
		assertInstanceOf(HubCondition.Connecting.class, HubCondition.of(new LinkState.Rejected(RejectReason.RETRY), false,
			Optional.empty()));
	}

	@Test
	void aDialogInTheLauncherIsTheMostUrgentExplanationEvenBeforeTheStateArrives() {
		HubCondition condition = HubCondition.of(new LinkState.Connected("2.0.1", null), true, Optional.empty());

		assertInstanceOf(HubCondition.AwaitingConsent.class, condition);
		assertEquals("pumpkin_friends.hub.state.awaiting", condition.statusKey());
		assertFalse(condition.showsContent());
		assertFalse(condition.offersLauncherOpen());
	}

	@Test
	void everyTerminalRefusalNamesItsTextAndOpensTheLauncher() {
		for (RejectReason reason : RejectReason.values()) {
			if (!reason.isTerminal()) {
				continue;
			}
			HubCondition condition = HubCondition.of(new LinkState.Rejected(reason), false, Optional.empty());

			assertEquals(new HubCondition.Refused(reason), condition, reason.name());
			assertEquals("pumpkin_friends.hub.state.reject." + WireNames.of(reason), condition.statusKey(), reason.name());
			assertFalse(condition.showsContent());
			assertTrue(condition.offersLauncherOpen(), reason.name());
		}
	}

	@Test
	void friendsSwitchedOffInTheLauncherOpensTheSettingsThere() {
		Me switchedOff = new Me(false, Me.Availability.AVAILABLE, Me.Network.ONLINE, Optional.empty(), Me.Directory.ACTIVE);

		HubCondition condition = HubCondition.of(new LinkState.Connected("2.0.1", null), false, Optional.of(switchedOff));

		assertEquals(new HubCondition.SwitchedOff(), condition);
		assertEquals("pumpkin_friends.hub.state.disabled", condition.statusKey());
		assertEquals(OpenTarget.SETTINGS, condition.openTarget());
		assertFalse(condition.showsContent());
		assertTrue(condition.offersLauncherOpen());
	}

	@Test
	void bothIdentitiesTheLauncherCannotServeHaveTheirOwnText() {
		for (Me.Availability availability : new Me.Availability[] {Me.Availability.IDENTITY_LOST, Me.Availability.NO_SECRET_STORE}) {
			Me identity = new Me(true, availability, Me.Network.ONLINE, Optional.empty(), Me.Directory.ACTIVE);

			HubCondition condition = HubCondition.of(new LinkState.Connected("2.0.1", null), false, Optional.of(identity));

			assertEquals(new HubCondition.WithoutIdentity(availability), condition, availability.name());
			assertEquals("pumpkin_friends.hub.state.unavailable." + WireNames.of(availability), condition.statusKey(),
				availability.name());
			assertFalse(condition.showsContent(), availability.name());
			assertTrue(condition.offersLauncherOpen(), availability.name());
		}
	}

	@Test
	void aConnectedLinkWithoutStateIsLoading() {
		HubCondition condition = HubCondition.of(new LinkState.Connected("2.0.1", null), false, Optional.empty());

		assertEquals(new HubCondition.Loading(), condition);
		assertEquals("pumpkin_friends.hub.state.loading", condition.statusKey());
		assertFalse(condition.showsContent());
	}

	@Test
	void anEnabledIdentityShowsContent() {
		HubCondition condition = HubCondition.of(new LinkState.Connected("2.0.1", null), false, Optional.of(ENABLED));

		assertEquals(new HubCondition.Ready(), condition);
		assertTrue(condition.showsContent());
		assertEquals("", condition.statusKey());
		assertFalse(condition.offersLauncherOpen());
	}

	@Test
	void aDirectoryThatIsOffDoesNotBlockTheHub() {
		Me findableOff = new Me(true, Me.Availability.AVAILABLE, Me.Network.ONLINE, Optional.of("ab12"), Me.Directory.OFF);

		assertEquals(new HubCondition.Ready(), HubCondition.of(new LinkState.Connected("2.0.1", null), false, Optional.of(findableOff)));
	}
}
