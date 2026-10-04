package dev.laux.pumpkin.friends.ui;

import java.util.function.BooleanSupplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The soft-failure guard of the in-game UI (INGAME 4.2): the mod must never throw into the game. Every entry point
 * that calls game code runs through here. The first failure is logged once and disables the mod's UI for the rest of
 * the session; after that new UI work is skipped. This is the {@code require = 0} philosophy of the pause-menu hook
 * extended to everything the hook itself cannot cover.
 *
 * <p>Era mismatches surface as {@link LinkageError}s ({@code NoSuchMethodError} and friends), not just as
 * {@link RuntimeException}s, so the guard catches both.
 */
public final class UiSession {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_friends");

	private static volatile boolean off;

	private UiSession() {
	}

	/** True once a failure has disabled the mod's UI for this session. */
	public static boolean off() {
		return off;
	}

	/**
	 * Runs the mod's UI work while the UI is on. Nothing ever propagates to the caller (the game): after the first
	 * failure the call is a no-op.
	 */
	public static void run(Runnable work) {
		if (off) {
			return;
		}
		try {
			work.run();
		} catch (RuntimeException | LinkageError failure) {
			disable(failure);
		}
	}

	/**
	 * Asks for an outcome and never throws; {@code false} when the action fails. Unlike {@link #run} the action still
	 * runs while the UI is off, because callers route vanilla behaviour through it that must keep working, above all
	 * the escape key.
	 */
	public static boolean attempt(BooleanSupplier action) {
		try {
			return action.getAsBoolean();
		} catch (RuntimeException | LinkageError failure) {
			disable(failure);
			return false;
		}
	}

	/**
	 * Logs the failure and switches the mod's UI off for the session. For the entry point whose body cannot run
	 * through {@link #run} without a lambda inside a mixin, the {@code PauseScreenMixin}.
	 */
	public static void disable(Throwable failure) {
		if (off) {
			return;
		}
		off = true;
		LOG.warn("Pumpkin Friends: disabling the in-game UI for this session", failure);
	}

	/** Tests only: turns the UI back on. */
	static void resetForTest() {
		off = false;
	}
}
