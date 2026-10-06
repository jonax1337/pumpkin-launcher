package dev.laux.pumpkin.bridge.protocol;

import static dev.laux.pumpkin.bridge.Fixtures.Direction.LAUNCHER_TO_MOD;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.laux.pumpkin.bridge.Fixtures;
import dev.laux.pumpkin.bridge.Fixtures.Line;
import dev.laux.pumpkin.bridge.protocol.json.WireNames;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Closing;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Notify;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/** events.jsonl: every notice kind and every closing reason. */
class EventFixturesTest {
	private static final List<LauncherFrame> EVENTS = Fixtures.read("events.jsonl", LAUNCHER_TO_MOD).stream()
		.map(Line::wire).map(wire -> FrameCodec.decode(wire).orElseThrow()).toList();

	@Test
	void noticesCarryTheirKindAndTheOptionalName() {
		List<Notify> notices = EVENTS.stream().filter(Notify.class::isInstance).map(Notify.class::cast).toList();

		assertEquals(new Notify(NotifyKind.REQUEST_RECEIVED, Optional.of("Sam")), notices.get(0));
		assertEquals(new Notify(NotifyKind.SESSION_ENDED, Optional.empty()), notices.get(5));
		assertEquals(new Notify(NotifyKind.SCOPE_DENIED, Optional.empty()), notices.get(7));
	}

	@Test
	void everyNoticeKindOfTheAllowListIsShownByAFixture() {
		Set<NotifyKind> shown = EVENTS.stream().filter(Notify.class::isInstance).map(event -> ((Notify) event).kind())
			.collect(Collectors.toSet());

		assertEquals(EnumSet.allOf(NotifyKind.class), shown);
	}

	@Test
	void everyClosingReasonIsShownByAFixtureAndOnlyBridgeStoppedLetsTheModComeBack() {
		Set<ClosingReason> shown = EVENTS.stream().filter(Closing.class::isInstance).map(event -> ((Closing) event).reason())
			.collect(Collectors.toSet());

		assertEquals(EnumSet.allOf(ClosingReason.class), shown);
		assertFalse(ClosingReason.BRIDGE_STOPPED.isFinal());
		assertTrue(ClosingReason.LAUNCH_ENDED.isFinal() && ClosingReason.REPLACED.isFinal());
	}

	@Test
	void aNoticeKindOutsideTheAllowListIsDropped() {
		String line = "{\"type\":\"event\",\"event\":\"notify\",\"kind\":\"friendBirthday\",\"name\":\"Alex\"}";

		assertTrue(FrameCodec.decode(line).isEmpty());
	}

	@Test
	void anEventOfAnotherSortIsDropped() {
		assertTrue(FrameCodec.decode("{\"type\":\"event\",\"event\":\"shutdown\"}").isEmpty());
	}

	@Test
	void theAllowListMatchesTheKindsTheLauncherDocuments() {
		List<String> documented = List.of("requestReceived", "inviteReceived", "friendOnline", "guestJoined", "guestLeft",
			"sessionEnded", "joinEnded", "scopeDenied");

		assertEquals(documented, Arrays.stream(NotifyKind.values()).map(WireNames::of).toList());
	}
}
