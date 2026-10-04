package dev.laux.pumpkin.friends.request;

import dev.laux.pumpkin.friends.protocol.ErrorCode;
import dev.laux.pumpkin.friends.protocol.OpError;
import java.util.Optional;

/** The final answer to a request. */
public sealed interface Reply<T> {
	/** The error of a failed reply; empty for a success. */
	Optional<OpError> error();

	static <T> Reply<T> failure(ErrorCode code) {
		return new Failure<>(OpError.of(code));
	}

	record Success<T>(T value) implements Reply<T> {
		@Override
		public Optional<OpError> error() {
			return Optional.empty();
		}
	}

	record Failure<T>(OpError failure) implements Reply<T> {
		@Override
		public Optional<OpError> error() {
			return Optional.of(failure);
		}
	}
}
