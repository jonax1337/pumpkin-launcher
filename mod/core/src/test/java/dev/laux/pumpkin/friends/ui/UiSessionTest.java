package dev.laux.pumpkin.friends.ui;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The soft-failure guard of the in-game UI (INGAME 4.2): a failure never throws, is logged once and switches the UI off. */
class UiSessionTest {
	@BeforeEach
	void turnTheUiOn() {
		UiSession.resetForTest();
	}

	@Test
	void runsUiWorkWhileTheUiIsOn() {
		AtomicInteger runs = new AtomicInteger();
		UiSession.run(runs::incrementAndGet);
		assertEquals(1, runs.get());
		assertFalse(UiSession.off());
	}

	@Test
	void aRuntimeExceptionSwitchesTheUiOffForTheRestOfTheSession() {
		UiSession.run(() -> {
			throw new IllegalStateException("era mismatch");
		});
		assertTrue(UiSession.off());
		AtomicInteger runs = new AtomicInteger();
		UiSession.run(runs::incrementAndGet);
		assertEquals(0, runs.get());
	}

	@Test
	void aLinkageErrorSwitchesTheUiOffToo() {
		UiSession.run(() -> {
			throw new NoSuchMethodError("net/minecraft/client/gui/screens/Screen.method_25498");
		});
		assertTrue(UiSession.off());
	}

	@Test
	void attemptAnswersFalseWhenTheActionFails() {
		boolean answered = UiSession.attempt(() -> {
			throw new NoSuchMethodError("net/minecraft/client/gui/screens/Screen.method_25402");
		});
		assertFalse(answered);
		assertTrue(UiSession.off());
	}

	@Test
	void attemptStillAnswersAfterTheUiIsOff() {
		UiSession.run(() -> {
			throw new IllegalStateException("era mismatch");
		});
		assertTrue(UiSession.attempt(() -> true));
		assertFalse(UiSession.attempt(() -> false));
	}

	@Test
	void attemptNeverThrowsAfterTheUiIsOffEither() {
		UiSession.run(() -> {
			throw new IllegalStateException("era mismatch");
		});
		boolean answered = UiSession.attempt(() -> {
			throw new RuntimeException("the vanilla path is broken too");
		});
		assertFalse(answered);
	}
}
