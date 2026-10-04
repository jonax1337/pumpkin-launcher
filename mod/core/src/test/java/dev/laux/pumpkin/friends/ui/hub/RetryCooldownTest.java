package dev.laux.pumpkin.friends.ui.hub;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** The ten-second pause between two "Jetzt zustellen" presses (friends.retry). */
class RetryCooldownTest {
	@Test
	void aFreshScreenCanDeliverAtOnce() {
		assertTrue(new RetryCooldown().canSend(0));
	}

	@Test
	void afterAPressTheNextTenSecondsBelongToTheLauncher() {
		RetryCooldown cooldown = new RetryCooldown();
		cooldown.markSent(1_000);

		assertFalse(cooldown.canSend(10_000), "the last millisecond of the pause");
		assertTrue(cooldown.canSend(11_000), "the first millisecond after it");
	}

	@Test
	void theRemainingTimeCountsDownToZero() {
		RetryCooldown cooldown = new RetryCooldown();
		cooldown.markSent(1_000);

		assertEquals(9_000, cooldown.remainingMillis(2_000));
		assertEquals(0, cooldown.remainingMillis(11_000));
	}

	@Test
	void beforeTheFirstPressNothingIsLeftToWait() {
		assertEquals(0, new RetryCooldown().remainingMillis(5_000));
	}

	@Test
	void aLaterPressMovesThePause() {
		RetryCooldown cooldown = new RetryCooldown();
		cooldown.markSent(1_000);
		cooldown.markSent(20_000);

		assertFalse(cooldown.canSend(29_999));
		assertTrue(cooldown.canSend(30_000));
	}
}
