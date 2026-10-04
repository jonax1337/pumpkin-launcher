package dev.laux.pumpkin.friends.protocol;

import java.util.Map;
import java.util.Optional;

/** A failed operation: the code and its parameters, for example {@code max} of {@code guestLimit} or {@code min} of {@code versionUnsupported}. */
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
}
