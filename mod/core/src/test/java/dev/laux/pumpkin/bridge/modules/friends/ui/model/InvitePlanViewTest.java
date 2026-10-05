package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.laux.pumpkin.bridge.modules.friends.protocol.Results.PlanVerdict;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** Every verdict of {@code invite.plan} maps to one body of the InviteScreen (INGAME 6.2 "Einladungen"). */
class InvitePlanViewTest {
	@ParameterizedTest(name = "{0} joins from here: {1}, reason: {2}")
	@CsvSource({
		"READY,true,",
		"MISSING_CONTENT,false,pumpkin_bridge.invite.verdict.missingContent",
		"VERSION_UNSUPPORTED,false,pumpkin_bridge.invite.verdict.versionUnsupported",
		"NO_INSTANCE,false,pumpkin_bridge.invite.verdict.noInstance"})
	void mapsEveryVerdict(PlanVerdict verdict, boolean joinFromHere, String reasonKey) {
		InvitePlanView view = InvitePlanView.of(verdict);

		assertEquals(joinFromHere, view.joinFromHere());
		if (reasonKey == null) {
			assertNull(view.reasonKey());
		} else {
			assertEquals(reasonKey, view.reasonKey());
		}
	}

	@Test
	void onlyAReadyPlanJoinsFromTheRunningGame() {
		assertTrue(InvitePlanView.of(PlanVerdict.READY).joinFromHere());
		for (PlanVerdict verdict : PlanVerdict.values()) {
			if (verdict == PlanVerdict.READY) {
				continue;
			}
			assertFalse(InvitePlanView.of(verdict).joinFromHere(), verdict + " must not join from here");
		}
	}
}
