package dev.laux.pumpkin.bridge.protocol;

import java.util.Objects;
import dev.laux.pumpkin.bridge.runtime.Immutable;

import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;

/**
 * A failed operation: the code and its parameters. A coarse code names its cause in {@code reason} (for example
 * {@code badRequest} with {@code nameInvalid}); numbers and versions travel as {@code max}, {@code min}, {@code days},
 * {@code missing} and {@code extra}. Parameters arrive as text.
 */
public final class OpError {
	private final ErrorCode code;
	private final Map<String, String> params;

	public OpError(ErrorCode code, Map<String, String> params) {
		params = Immutable.copyMap(params);
		this.code = code;
		this.params = params;
	}

	public ErrorCode code() {
		return code;
	}

	public Map<String, String> params() {
		return params;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof OpError)) {
			return false;
		}
		OpError that = (OpError) other;
		return Objects.equals(code, that.code)
			&& Objects.equals(params, that.params);
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(code);
		hash = 31 * hash + Objects.hashCode(params);
		return hash;
	}

	@Override
	public String toString() {
		return "OpError[code=" + code + ", params=" + params + "]";
	}


	public static OpError of(ErrorCode code) {
		return new OpError(code, java.util.Collections.emptyMap());
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
