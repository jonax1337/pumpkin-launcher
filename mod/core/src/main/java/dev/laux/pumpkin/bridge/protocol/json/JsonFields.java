package dev.laux.pumpkin.bridge.protocol.json;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;

/**
 * Strict reading of one JSON object from the launcher: a missing or wrongly typed field throws {@link MalformedJson}
 * instead of yielding a default, so a half-valid message is rejected as a whole. Explicit {@code null} counts as absent.
 */
public final class JsonFields {
	private final JsonObject object;

	private JsonFields(JsonObject object) {
		this.object = object;
	}

	public static JsonFields parseLine(String line) {
		try {
			return of(JsonParser.parseString(line));
		} catch (JsonParseException notJson) {
			throw new MalformedJson("not JSON: " + notJson.getMessage());
		}
	}

	public static JsonFields of(JsonElement element) {
		if (element == null || !element.isJsonObject()) {
			throw new MalformedJson("a JSON object was expected");
		}
		return new JsonFields(element.getAsJsonObject());
	}

	/** The elements of a JSON array, each of which must be an object. */
	public static List<JsonFields> objectsOf(JsonElement array) {
		if (array == null || !array.isJsonArray()) {
			throw new MalformedJson("a JSON array was expected");
		}
		List<JsonFields> objects = new ArrayList<>();
		for (JsonElement element : array.getAsJsonArray()) {
			objects.add(of(element));
		}
		return objects;
	}

	public JsonObject raw() {
		return object;
	}

	public boolean has(String key) {
		return present(key).isPresent();
	}

	public String string(String key) {
		return optionalString(key).orElseThrow(() -> missing(key));
	}

	public Optional<String> optionalString(String key) {
		return present(key).map(value -> {
			if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
				throw wrongType(key, "a string");
			}
			return value.getAsString();
		});
	}

	public boolean bool(String key) {
		JsonElement value = present(key).orElseThrow(() -> missing(key));
		if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean()) {
			throw wrongType(key, "a boolean");
		}
		return value.getAsBoolean();
	}

	public long number(String key) {
		return optionalNumber(key).orElseThrow(() -> missing(key));
	}

	public int integer(String key) {
		return toInt(key, number(key));
	}

	public Optional<Long> optionalNumber(String key) {
		return present(key).map(value -> {
			if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
				throw wrongType(key, "a number");
			}
			return toWholeNumber(key, value.getAsJsonPrimitive());
		});
	}

	public OptionalInt optionalInteger(String key) {
		return optionalNumber(key).map(number -> OptionalInt.of(toInt(key, number))).orElse(OptionalInt.empty());
	}

	public JsonFields object(String key) {
		return optionalObject(key).orElseThrow(() -> missing(key));
	}

	public Optional<JsonFields> optionalObject(String key) {
		return present(key).map(JsonFields::of);
	}

	public List<JsonFields> objects(String key) {
		return objectsOf(present(key).orElseThrow(() -> missing(key)));
	}

	public List<String> strings(String key) {
		JsonElement array = present(key).orElseThrow(() -> missing(key));
		if (!array.isJsonArray()) {
			throw wrongType(key, "an array");
		}
		List<String> strings = new ArrayList<>();
		for (JsonElement element : (JsonArray) array) {
			if (!element.isJsonPrimitive() || !element.getAsJsonPrimitive().isString()) {
				throw wrongType(key, "an array of strings");
			}
			strings.add(element.getAsString());
		}
		return strings;
	}

	/** The raw value, which may be an explicit {@code null}; the field itself must exist. */
	public JsonElement element(String key) {
		JsonElement value = object.get(key);
		if (value == null) {
			throw missing(key);
		}
		return value;
	}

	public <E extends Enum<E>> E enumValue(String key, Class<E> type) {
		return optionalEnum(key, type).orElseThrow(() -> missing(key));
	}

	public <E extends Enum<E>> Optional<E> optionalEnum(String key, Class<E> type) {
		return optionalString(key).map(wire -> WireNames.parse(type, wire)
			.orElseThrow(() -> new MalformedJson("unknown " + type.getSimpleName() + " in '" + key + "'")));
	}

	/** Every member as text; numbers and booleans keep their JSON spelling, nested values are skipped. */
	public Map<String, String> textMembers() {
		Map<String, String> members = new LinkedHashMap<>();
		object.asMap().forEach((key, value) -> {
			if (value.isJsonPrimitive()) {
				members.put(key, value.getAsString());
			}
		});
		return members;
	}

	private Optional<JsonElement> present(String key) {
		JsonElement value = object.get(key);
		return value == null || value.isJsonNull() ? Optional.empty() : Optional.of(value);
	}

	private static long toWholeNumber(String key, JsonPrimitive number) {
		try {
			return number.getAsBigDecimal().longValueExact();
		} catch (ArithmeticException fractional) {
			throw wrongType(key, "a whole number");
		}
	}

	private static int toInt(String key, long number) {
		if (number < Integer.MIN_VALUE || number > Integer.MAX_VALUE) {
			throw wrongType(key, "a 32-bit number");
		}
		return (int) number;
	}

	private static MalformedJson missing(String key) {
		return new MalformedJson("field '" + key + "' is missing");
	}

	private static MalformedJson wrongType(String key, String expected) {
		return new MalformedJson("field '" + key + "' is not " + expected);
	}
}
