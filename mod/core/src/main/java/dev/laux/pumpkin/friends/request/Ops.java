package dev.laux.pumpkin.friends.request;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import dev.laux.pumpkin.friends.json.JsonFields;
import dev.laux.pumpkin.friends.json.WireNames;
import dev.laux.pumpkin.friends.protocol.Limits;
import dev.laux.pumpkin.friends.request.Results.CodeCreated;
import dev.laux.pumpkin.friends.request.Results.Done;
import dev.laux.pumpkin.friends.request.Results.InvitePlan;
import dev.laux.pumpkin.friends.request.Results.JoinHere;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;

/**
 * The operations of INGAME 5.4. Friends are named by the aliases of the topics ({@code f1}, {@code f2}, ...), never by peer id.
 * Operations that wait for the directory, a plan or a dialog get the longer timeout.
 */
public final class Ops {
	private Ops() {
	}

	public enum OpenTarget {
		FRIENDS,
		REQUESTS,
		INVITES,
		SETTINGS
	}

	public static Op<Done> stateSync() {
		return quick("state.sync", new JsonObject());
	}

	public static Op<Done> launcherOpen(OpenTarget target) {
		return quick("launcher.open", args("target", WireNames.of(target)));
	}

	public static Op<Done> requestAnswer(String requestId, boolean accept) {
		JsonObject args = args("id", requestId);
		args.addProperty("accept", accept);
		return quick("request.answer", args);
	}

	public static Op<Done> requestCancel(String requestId) {
		return quick("request.cancel", args("id", requestId));
	}

	public static Op<Done> friendAddByName(String name) {
		return slow("friend.addByName", args("name", name), Done::read);
	}

	public static Op<Done> inviteDecline(String inviteId) {
		return quick("invite.decline", args("id", inviteId));
	}

	public static Op<InvitePlan> invitePlan(String inviteId) {
		return slow("invite.plan", args("id", inviteId), InvitePlan::read);
	}

	public static Op<JoinHere> inviteJoinHere(String inviteId) {
		return slow("invite.joinHere", args("id", inviteId), JoinHere::read);
	}

	public static Op<Done> joinLeave() {
		return quick("join.leave", new JsonObject());
	}

	/** The game could not connect to the world that {@code invite.joinHere} named. */
	public static Op<Done> joinFailed() {
		return quick("join.failed", new JsonObject());
	}

	public static Op<Done> hostInvite(List<String> friends, boolean showWorld) {
		JsonArray aliases = new JsonArray();
		friends.forEach(aliases::add);
		JsonObject args = new JsonObject();
		args.add("friends", aliases);
		args.addProperty("showWorld", showWorld);
		return slow("host.invite", args, Done::read);
	}

	public static Op<Done> hostKick(String friend) {
		return quick("host.kick", args("friend", friend));
	}

	public static Op<Done> hostStop() {
		return quick("host.stop", new JsonObject());
	}

	public static Op<Done> friendAddByCode(String code) {
		return slow("friend.addByCode", args("code", code), Done::read);
	}

	public static Op<CodeCreated> codeCreate() {
		return slow("code.create", new JsonObject(), CodeCreated::read);
	}

	public static Op<Done> codeRevoke(String codeId) {
		return quick("code.revoke", args("id", codeId));
	}

	/** No {@code alias} takes the nickname away. */
	public static Op<Done> friendRename(String friend, Optional<String> alias) {
		JsonObject args = args("friend", friend);
		args.add("alias", alias.<JsonElement>map(JsonPrimitive::new).orElse(JsonNull.INSTANCE));
		return quick("friend.rename", args);
	}

	public static Op<Done> friendRemove(String friend) {
		return quick("friend.remove", args("friend", friend));
	}

	public static Op<Done> friendBlock(String friend) {
		return quick("friend.block", args("friend", friend));
	}

	public static Op<Done> blockedUnblock(String blockedId) {
		return quick("blocked.unblock", args("id", blockedId));
	}

	public static Op<Done> friendAcknowledge(String friend) {
		return quick("friend.acknowledge", args("id", friend));
	}

	public static Op<Done> friendsRetry() {
		return quick("friends.retry", new JsonObject());
	}

	private static Op<Done> quick(String name, JsonObject args) {
		return new Op<>(name, args, Limits.REQUEST_TIMEOUT, Done::read);
	}

	private static <T> Op<T> slow(String name, JsonObject args, Function<JsonFields, T> reader) {
		return new Op<>(name, args, Limits.SLOW_REQUEST_TIMEOUT, reader);
	}

	private static JsonObject args(String key, String value) {
		JsonObject args = new JsonObject();
		args.addProperty(key, value);
		return args;
	}
}
