package dev.laux.pumpkin.friends.json;

import java.util.Arrays;
import java.util.Optional;

/** The wire spelling of enum constants: {@code AWAITING_ANSWER} travels as {@code awaitingAnswer} (serde camelCase on the Rust side). */
public final class WireNames {
	private WireNames() {
	}

	public static String of(Enum<?> constant) {
		StringBuilder wire = new StringBuilder();
		boolean upperNext = false;
		for (char letter : constant.name().toCharArray()) {
			if (letter == '_') {
				upperNext = true;
			} else {
				wire.append(upperNext ? letter : Character.toLowerCase(letter));
				upperNext = false;
			}
		}
		return wire.toString();
	}

	public static <E extends Enum<E>> Optional<E> parse(Class<E> type, String wire) {
		return Arrays.stream(type.getEnumConstants()).filter(constant -> of(constant).equals(wire)).findFirst();
	}
}
