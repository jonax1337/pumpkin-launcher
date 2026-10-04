package dev.laux.pumpkin.friends.protocol;

import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;

/**
 * A failed operation: the code and its parameters. A coarse code names its cause in {@code reason} (for example
 * {@code badRequest} with {@code nameInvalid}); numbers and versions travel as {@code max}, {@code min}, {@code days},
 * {@code missing} and {@code extra}. Parameters arrive as text.
 */
public record OpError(ErrorCode code, Map<String, String> params) {
	public OpError {
		params = Map.copyOf(params);
	}

	public static OpError of(ErrorCode code) {
		return new OpError(code, Map.of());
	}

	public Optional<String> param(String name) {
		return Optional.ofNullable(params.get(name));
	}

	/** The cause a coarse code names, for example {@code nameInvalid}. */
	public Optional<String> reason() {
		return param("reason");
	}

	/** A numeric parameter such as {@code max} or {@code days}; empty when it is absent or not a number. */
	public OptionalInt intParam(String name) {
		return param(name).map(OpError::parseInt).orElse(OptionalInt.empty());
	}

	private static OptionalInt parseInt(String text) {
		try {
			return OptionalInt.of(Integer.parseInt(text));
		} catch (NumberFormatException notANumber) {
			return OptionalInt.empty();
		}
	}
}
