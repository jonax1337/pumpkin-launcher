package dev.laux.pumpkin.friends;

import dev.laux.pumpkin.friends.runtime.MainThread;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicInteger;

/** A main thread that runs tasks only when the test says so, like the game's tick. */
public final class ManualMainThread implements MainThread {
	private final ConcurrentLinkedQueue<Runnable> tasks = new ConcurrentLinkedQueue<>();

	@Override
	public void execute(Runnable task) {
		tasks.add(task);
	}

	/** Runs everything queued so far and returns how many tasks ran. */
	public int runPending() {
		AtomicInteger ran = new AtomicInteger();
		for (Runnable task = tasks.poll(); task != null; task = tasks.poll()) {
			task.run();
			ran.incrementAndGet();
		}
		return ran.get();
	}

	public boolean hasPending() {
		return !tasks.isEmpty();
	}
}
