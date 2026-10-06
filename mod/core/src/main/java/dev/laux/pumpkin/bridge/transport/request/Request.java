package dev.laux.pumpkin.bridge.transport.request;

import dev.laux.pumpkin.bridge.protocol.Scope;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.apache.logging.log4j.Logger;
import org.apache.logging.log4j.LogManager;

/**
 * An operation on its way. Everything observable here happens on the main thread: {@link #reply()} completes there and
 * dependent stages run there, so UI code may continue straight from it.
 */
public final class Request<T> {
	private static final Logger LOG = LogManager.getLogger("pumpkin_bridge");

	private final CompletableFuture<Reply<T>> reply = new CompletableFuture<>();
	private Optional<Scope> awaitedScope = Optional.empty();
	private Consumer<Scope> pendingListener = scope -> { };

	/** Completes exactly once, with a success, an error of the launcher, or a local error ({@code timeout}, {@code busy}, {@code disconnected}). */
	public CompletableFuture<Reply<T>> reply() {
		return reply;
	}

	/** The scope of the launcher dialog the player has to answer, while there is one. */
	public Optional<Scope> awaitedScope() {
		return awaitedScope;
	}

	/** Runs the listener when the launcher shows its dialog, or at once if it already does. */
	public void whenPending(Consumer<Scope> listener) {
		pendingListener = listener;
		awaitedScope.ifPresent(this::tell);
	}

	void markPending(Scope scope) {
		if (reply.isDone()) {
			return;
		}
		awaitedScope = Optional.of(scope);
		tell(scope);
	}

	void complete(Reply<T> outcome) {
		awaitedScope = Optional.empty();
		reply.complete(outcome);
	}

	private void tell(Scope scope) {
		try {
			pendingListener.accept(scope);
		} catch (RuntimeException failure) {
			LOG.warn("Pumpkin Bridge: pending listener failed", failure);
		}
	}
}
