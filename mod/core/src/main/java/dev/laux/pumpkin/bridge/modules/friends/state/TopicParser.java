package dev.laux.pumpkin.bridge.modules.friends.state;

import dev.laux.pumpkin.bridge.runtime.Immutable;

import com.google.gson.JsonElement;
import dev.laux.pumpkin.bridge.protocol.json.JsonFields;
import dev.laux.pumpkin.bridge.protocol.json.MalformedJson;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.function.Function;

/**
 * Reads the value of a topic into the typed models. Every text a player controls goes through {@link Sanitize} here, so
 * nothing downstream ever sees raw launcher text. A value that does not fit throws {@link MalformedJson} and leaves the
 * previous value in place.
 */
final class TopicParser {
	private static final int MAX_ID_CHARS = 64;

	private TopicParser() {
	}

	static Me me(JsonElement value) {
		JsonFields fields = JsonFields.of(value);
		return new Me(fields.bool("enabled"), fields.enumValue("availability", Me.Availability.class),
			fields.enumValue("network", Me.Network.class), fields.optionalString("fingerprint").map(Sanitize::title),
			fields.enumValue("directory", Me.Directory.class), Sanitize.name(fields.string("displayName")),
			fields.bool("findableByName"), fields.optionalString("relayHost").map(Sanitize::host));
	}

	static List<Friend> friends(JsonElement value) {
		return list(value, fields -> new Friend(id(fields, "id"), Sanitize.name(fields.string("name")),
			fields.optionalString("mcUuid").flatMap(Sanitize::mcUuid), fields.enumValue("presence", Friend.Presence.class),
			fields.optionalObject("notice").flatMap(TopicParser::notice)));
	}

	static Requests requests(JsonElement value) {
		JsonFields fields = JsonFields.of(value);
		return new Requests(
			list(fields.objects("incoming"), TopicParser::incomingRequest),
			list(fields.objects("outgoing"), TopicParser::outgoingRequest),
			fields.number("retryCooldownMs"));
	}

	static List<Invite> invites(JsonElement value) {
		return list(value, fields -> new Invite(id(fields, "id"), Sanitize.name(fields.string("fromName")),
			Sanitize.title(fields.string("title"))));
	}

	static Optional<Session> session(JsonElement value) {
		return optional(value, fields -> new Session(list(fields.objects("guests"), guest -> new Session.Guest(id(guest, "id"),
			Sanitize.name(guest.string("name")), guest.enumValue("state", Session.State.class)))));
	}

	static Optional<Join> join(JsonElement value) {
		return optional(value, fields -> new Join(id(fields, "inviteId"), Sanitize.name(fields.string("hostName")),
			fields.enumValue("state", Join.Phase.class), fields.optionalEnum("path", Join.Path.class),
			fields.optionalInteger("rttMs")));
	}

	static Game game(JsonElement value) {
		JsonFields fields = JsonFields.of(value);
		OptionalInt lanPort = fields.optionalObject("lan").map(lan -> OptionalInt.of(lan.integer("port"))).orElse(OptionalInt.empty());
		return new Game(fields.bool("hostable"), fields.optionalObject("reason").map(TopicParser::unhostable), lanPort,
			fields.bool("sharedElsewhere"));
	}

	static List<Code> codes(JsonElement value) {
		return list(value, fields -> new Code(id(fields, "id"), Sanitize.name(fields.string("tail")),
			fields.number("expiresAt"), fields.bool("used")));
	}

	static List<Blocked> blocked(JsonElement value) {
		return list(value, fields -> new Blocked(id(fields, "id"), Sanitize.name(fields.string("name"))));
	}

	/**
	 * A notice type this mod does not know (a newer launcher) is left out instead of making the whole friends list malformed:
	 * the launcher alone decides what the player has to review, so a missing hint never lets the mod do more.
	 */
	private static Optional<FriendNotice> notice(JsonFields fields) {
		switch (fields.string("type")) {
			case "renamed":
				return Optional.of(new FriendNotice.Renamed(Sanitize.name(fields.string("previousName"))));
			case "identityChanged":
				return Optional.of(new FriendNotice.IdentityChanged());
			default:
				return Optional.empty();
		}
	}

	private static Requests.Incoming incomingRequest(JsonFields fields) {
		return new Requests.Incoming(id(fields, "id"), Sanitize.name(fields.string("name")),
			fields.optionalString("mcName").map(Sanitize::name), Sanitize.title(fields.string("fingerprint")));
	}

	private static Requests.Outgoing outgoingRequest(JsonFields fields) {
		return new Requests.Outgoing(id(fields, "id"), fields.optionalString("name").map(Sanitize::name),
			fields.enumValue("state", Requests.State.class));
	}

	private static Game.Unhostable unhostable(JsonFields fields) {
		return new Game.Unhostable(fields.enumValue("type", Game.Unhostable.Kind.class),
			fields.optionalString("min").map(Sanitize::name));
	}

	private static <T> List<T> list(JsonElement array, Function<JsonFields, T> reader) {
		return list(JsonFields.objectsOf(array), reader);
	}

	private static <T> List<T> list(List<JsonFields> objects, Function<JsonFields, T> reader) {
		return objects.stream().map(reader).collect(Immutable.toList());
	}

	/** A JSON null means "nothing", for the topics that can be absent. */
	private static <T> Optional<T> optional(JsonElement value, Function<JsonFields, T> reader) {
		return value.isJsonNull() ? Optional.empty() : Optional.of(reader.apply(JsonFields.of(value)));
	}

	private static String id(JsonFields fields, String key) {
		String id = fields.string(key);
		if (id.isEmpty() || id.length() > MAX_ID_CHARS) {
			throw new MalformedJson("'" + key + "' is not a usable id");
		}
		return id;
	}
}
