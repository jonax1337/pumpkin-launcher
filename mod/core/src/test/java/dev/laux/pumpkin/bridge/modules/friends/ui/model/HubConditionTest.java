package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.laux.pumpkin.bridge.transport.LinkState;
import dev.laux.pumpkin.bridge.protocol.json.WireNames;
import dev.laux.pumpkin.bridge.protocol.RejectReason;
import dev.laux.pumpkin.bridge.protocol.Topic;
import dev.laux.pumpkin.bridge.modules.friends.protocol.Ops.OpenTarget;
import dev.laux.pumpkin.bridge.modules.friends.state.Me;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.function.Predicate;
import org.junit.jupiter.api.Test;

/**
 * Every state of INGAME 6.3 is reachable and says its text, its action and whether the tabs show content. The loading
 * state holds until the first push of every awaited topic (A27), not only of {@code me}.
 */
class HubConditionTest {
	private static final Me ENABLED = new Me(true, Me.Availability.AVAILABLE, Me.Network.ONLINE, Optional.of("ab12"),
		Me.Directory.ACTIVE, "Anna", false, Optional.empty());
	private static final LinkState.Connected CONNECTED = new LinkState.Connected("0.2.0", null);

	/** Answers for the topics the hub awaits: everything received except the named ones. */
	private static Predicate<Topic> without(Topic... missing) {
		return topic -> Arrays.stream(missing).noneMatch(topic::equals);
	}

	@Test
	void withoutALinkTheHubExplainsThatItConnects() {
		HubCondition condition = HubCondition.of(LinkState.OFFLINE, false, Optional.empty(), without());

		assertInstanceOf(HubCondition.Connecting.class, condition);
		assertEquals("pumpkin_bridge.hub.state.connecting", condition.statusKey());
		assertFalse(condition.showsContent());
		assertFalse(condition.offersLauncherOpen(), "there is nothing to open in the launcher about a broken link");
	}

	@Test
	void aRetryRefusalIsStillConnectingBecauseTheClientKeepsTrying() {
		assertInstanceOf(HubCondition.Connecting.class,
			HubCondition.of(new LinkState.Rejected(RejectReason.RETRY), false, Optional.empty(), without()));
	}

	@Test
	void aDialogInTheLauncherIsTheMostUrgentExplanationEvenBeforeTheStateArrives() {
		HubCondition condition = HubCondition.of(CONNECTED, true, Optional.empty(), without());

		assertInstanceOf(HubCondition.AwaitingConsent.class, condition);
		assertEquals("pumpkin_bridge.hub.state.awaiting", condition.statusKey());
		assertFalse(condition.showsContent());
		assertFalse(condition.offersLauncherOpen());
	}

	@Test
	void everyTerminalRefusalNamesItsTextAndOpensTheLauncher() {
		for (RejectReason reason : RejectReason.values()) {
			if (!reason.isTerminal()) {
				continue;
			}
			HubCondition condition = HubCondition.of(new LinkState.Rejected(reason), false, Optional.empty(), without());

			assertEquals(new HubCondition.Refused(reason), condition, reason.name());
			assertEquals("pumpkin_bridge.hub.state.reject." + WireNames.of(reason), condition.statusKey(), reason.name());
			assertFalse(condition.showsContent());
			assertTrue(condition.offersLauncherOpen(), reason.name());
		}
	}

	@Test
	void friendsSwitchedOffInTheLauncherOpensTheSettingsThere() {
		Me switchedOff = new Me(false, Me.Availability.AVAILABLE, Me.Network.ONLINE, Optional.empty(), Me.Directory.ACTIVE,
			"Anna", false, Optional.empty());

		HubCondition condition = HubCondition.of(CONNECTED, false, Optional.of(switchedOff), without());

		assertEquals(new HubCondition.SwitchedOff(), condition);
		assertEquals("pumpkin_bridge.hub.state.disabled", condition.statusKey());
		assertEquals(OpenTarget.SETTINGS, condition.openTarget());
		assertFalse(condition.showsContent());
		assertTrue(condition.offersLauncherOpen());
	}

	@Test
	void bothIdentitiesTheLauncherCannotServeHaveTheirOwnText() {
		for (Me.Availability availability : new Me.Availability[] {Me.Availability.IDENTITY_LOST, Me.Availability.NO_SECRET_STORE}) {
			Me identity = new Me(true, availability, Me.Network.ONLINE, Optional.empty(), Me.Directory.ACTIVE,
				"Anna", false, Optional.empty());

			HubCondition condition = HubCondition.of(CONNECTED, false, Optional.of(identity), without());

			assertEquals(new HubCondition.WithoutIdentity(availability), condition, availability.name());
			assertEquals("pumpkin_bridge.hub.state.unavailable." + WireNames.of(availability), condition.statusKey(),
				availability.name());
			assertFalse(condition.showsContent(), availability.name());
			assertTrue(condition.offersLauncherOpen(), availability.name());
		}
	}

	@Test
	void aConnectedLinkWithoutStateIsLoading() {
		HubCondition condition = HubCondition.of(CONNECTED, false, Optional.empty(), without());

		assertEquals(new HubCondition.Loading(), condition);
		assertEquals("pumpkin_bridge.hub.state.loading", condition.statusKey());
		assertFalse(condition.showsContent());
	}

	@Test
	void theHubLoadsUntilEveryAwaitedTopicArrivedOnce() {
		assertEquals(new HubCondition.Loading(), HubCondition.of(CONNECTED, false, Optional.of(ENABLED), without(Topic.JOIN)),
			"join is the last awaited topic");
		assertEquals(new HubCondition.Loading(), HubCondition.of(CONNECTED, false, Optional.of(ENABLED),
			without(Topic.ME, Topic.FRIENDS, Topic.REQUESTS, Topic.INVITES, Topic.SESSION, Topic.JOIN, Topic.GAME)));
	}

	@Test
	void theAwaitedTopicsAreTheOnesOfRa() {
		assertEquals(List.of(Topic.ME, Topic.FRIENDS, Topic.REQUESTS, Topic.INVITES, Topic.SESSION, Topic.JOIN,
			Topic.GAME), HubCondition.AWAITED);
	}

	@Test
	void anEnabledIdentityShowsContent() {
		HubCondition condition = HubCondition.of(CONNECTED, false, Optional.of(ENABLED), without());

		assertEquals(new HubCondition.Ready(), condition);
		assertTrue(condition.showsContent());
		assertEquals("", condition.statusKey());
		assertFalse(condition.offersLauncherOpen());
	}

	@Test
	void aDirectoryThatIsOffDoesNotBlockTheHub() {
		Me findableOff = new Me(true, Me.Availability.AVAILABLE, Me.Network.ONLINE, Optional.of("ab12"), Me.Directory.OFF,
			"Anna", false, Optional.empty());

		assertEquals(new HubCondition.Ready(), HubCondition.of(CONNECTED, false, Optional.of(findableOff), without()));
	}
}
