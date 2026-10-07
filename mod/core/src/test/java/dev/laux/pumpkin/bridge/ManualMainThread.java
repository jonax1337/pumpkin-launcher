package dev.laux.pumpkin.bridge;

import dev.laux.pumpkin.bridge.runtime.MainThread;
import java.util.concurrent.ConcurrentLinkedQueue;

/** A main thread that runs tasks only when the test says so, like the game's tick. */
public final class ManualMainThread implements MainThread {
	private final ConcurrentLinkedQueue<Runnable> tasks = new ConcurrentLinkedQueue<>();

	@Override
	public void execute(Runnable task) {
		tasks.add(task);
	}

	/** Runs everything queued so far and returns how many tasks ran. */
	public int runPending() {
		int ran = 0;
		for (Runnable task = tasks.poll(); task != null; task = tasks.poll()) {
			task.run();
			ran++;
		}
		return ran;
	}

	public boolean hasPending() {
		return !tasks.isEmpty();
	}
}
