package dev.laux.pumpkin.friends.request;

import com.google.gson.JsonObject;
import dev.laux.pumpkin.friends.json.JsonFields;
import java.time.Duration;
import java.util.function.Function;

/** One operation of INGAME 5.4 with its arguments, the time the mod waits for it, and how its result is read. */
public record Op<T>(String name, JsonObject args, Duration timeout, Function<JsonFields, T> resultReader) {
}
