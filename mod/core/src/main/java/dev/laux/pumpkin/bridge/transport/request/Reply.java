package dev.laux.pumpkin.bridge.transport.request;

import java.util.Objects;

import dev.laux.pumpkin.bridge.protocol.ErrorCode;
import dev.laux.pumpkin.bridge.protocol.OpError;
import java.util.Optional;

/** The final answer to a request. */
public interface Reply<T> {
	/** The error of a failed reply; empty for a success. */
	Optional<OpError> error();

	static <T> Reply<T> failure(ErrorCode code) {
		return new Failure<>(OpError.of(code));
	}

	public static final class Success<T> implements Reply<T> {
		private final T value;

		public Success(T value) {
			this.value = value;
		}

		public T value() {
			return value;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Success<?>)) {
				return false;
			}
			Success<?> that = (Success<?>) other;
			return Objects.equals(value, that.value);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(value);
			return hash;
		}

		@Override
		public String toString() {
			return "Success[value=" + value + "]";
		}

		@Override
		public Optional<OpError> error() {
			return Optional.empty();
		}
	}

	public static final class Failure<T> implements Reply<T> {
		private final OpError failure;

		public Failure(OpError failure) {
			this.failure = failure;
		}

		public OpError failure() {
			return failure;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Failure<?>)) {
				return false;
			}
			Failure<?> that = (Failure<?>) other;
			return Objects.equals(failure, that.failure);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(failure);
			return hash;
		}

		@Override
		public String toString() {
			return "Failure[failure=" + failure + "]";
		}

		@Override
		public Optional<OpError> error() {
			return Optional.of(failure);
		}
	}
}
