package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

/** The invite choices of the Teilen tab: the guest limit of seven and the "Weltname zeigen" toggle (docs/bridge/README.md, "In-game navigation and world behavior"). */
class ShareControlsTest {
	@Test
	void settingAFriendSelectsAndDeselectsIt() {
		ShareControls controls = new ShareControls();
		assertTrue(controls.set("f1", true));
		assertTrue(controls.isSelected("f1"));
		assertTrue(controls.canInvite());
		assertEquals(List.of("f1"), controls.selection());
		assertTrue(controls.set("f1", false));
		assertFalse(controls.isSelected("f1"));
		assertFalse(controls.canInvite());
	}

	@Test
	void theEighthFriendStaysUnselected() {
		ShareControls controls = new ShareControls();
		for (int number = 1; number <= Invitees.GUEST_LIMIT; number++) {
			assertTrue(controls.set("f" + number, true), "friend " + number + " must be selectable");
		}

		assertFalse(controls.set("f8", true));
		assertFalse(controls.isSelected("f8"));
		assertEquals(Invitees.GUEST_LIMIT, controls.selection().size());
	}

	@Test
	void theWorldNameToggleFlips() {
		ShareControls controls = new ShareControls();
		assertFalse(controls.showsWorldName());
		controls.toggleShowWorldName();
		assertTrue(controls.showsWorldName());
		controls.toggleShowWorldName();
		assertFalse(controls.showsWorldName());
	}

	@Test
	void friendsThatAreNoLongerInvitableLeaveTheSelection() {
		ShareControls controls = new ShareControls();
		controls.set("f1", true);
		controls.set("f2", true);
		controls.retainAll(List.of("f2"));
		assertEquals(List.of("f2"), controls.selection());
	}
}
