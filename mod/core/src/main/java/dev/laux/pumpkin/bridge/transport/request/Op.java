package dev.laux.pumpkin.bridge.transport.request;

import java.util.Objects;

import com.google.gson.JsonObject;
import dev.laux.pumpkin.bridge.protocol.json.JsonFields;
import java.time.Duration;
import java.util.function.Function;

/** One operation of docs/bridge/README.md, "Operations and consent" with its arguments, the time the mod waits for it, and how its result is read. */
public final class Op<T> {
	private final String name;
	private final JsonObject args;
	private final Duration timeout;
	private final Function<JsonFields, T> resultReader;

	public Op(String name, JsonObject args, Duration timeout, Function<JsonFields, T> resultReader) {
		this.name = name;
		this.args = args;
		this.timeout = timeout;
		this.resultReader = resultReader;
	}

	public String name() {
		return name;
	}

	public JsonObject args() {
		return args;
	}

	public Duration timeout() {
		return timeout;
	}

	public Function<JsonFields, T> resultReader() {
		return resultReader;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof Op<?>)) {
			return false;
		}
		Op<?> that = (Op<?>) other;
		return Objects.equals(name, that.name)
			&& Objects.equals(args, that.args)
			&& Objects.equals(timeout, that.timeout)
			&& Objects.equals(resultReader, that.resultReader);
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(name);
		hash = 31 * hash + Objects.hashCode(args);
		hash = 31 * hash + Objects.hashCode(timeout);
		hash = 31 * hash + Objects.hashCode(resultReader);
		return hash;
	}

	@Override
	public String toString() {
		return "Op[name=" + name + ", args=" + args + ", timeout=" + timeout + ", resultReader=" + resultReader + "]";
	}
}
