package dev.laux.pumpkin.friends.request;

import static dev.laux.pumpkin.friends.Fixtures.Direction.LAUNCHER_TO_MOD;
import static dev.laux.pumpkin.friends.Fixtures.Direction.MOD_TO_LAUNCHER;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonElement;
import com.google.gson.JsonParser;
import dev.laux.pumpkin.friends.Fixtures;
import dev.laux.pumpkin.friends.Fixtures.Line;
import dev.laux.pumpkin.friends.json.JsonFields;
import dev.laux.pumpkin.friends.protocol.FrameCodec;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Response;
import dev.laux.pumpkin.friends.protocol.Limits;
import dev.laux.pumpkin.friends.protocol.ModFrame;
import dev.laux.pumpkin.friends.request.Ops.OpenTarget;
import dev.laux.pumpkin.friends.request.Results.CodeCreated;
import dev.laux.pumpkin.friends.request.Results.Done;
import dev.laux.pumpkin.friends.request.Results.InvitePlan;
import dev.laux.pumpkin.friends.request.Results.JoinHere;
import dev.laux.pumpkin.friends.request.Results.PlanAlternative;
import dev.laux.pumpkin.friends.request.Results.PlanVerdict;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * ops.jsonl, ops-join-failed.jsonl, request-response.jsonl and the requests of pending.jsonl: every request line is what
 * {@link Ops} builds, and every operation of INGAME 5.4 has a builder.
 */
class OpsFixturesTest {
	private static final List<String> FILES = List.of("ops.jsonl", "ops-join-failed.jsonl", "request-response.jsonl", "pending.jsonl");

	/** The operation each fixture request stands for, by request id. */
	private static final Map<String, Op<?>> OPS_BY_REQUEST_ID = Map.ofEntries(
		Map.entry("o01", Ops.stateSync()),
		Map.entry("o02", Ops.launcherOpen(OpenTarget.REQUESTS)),
		Map.entry("o03", Ops.requestAnswer("r1", true)),
		Map.entry("o04", Ops.requestCancel("r2")),
		Map.entry("o05", Ops.friendAddByName("Notch")),
		Map.entry("o06", Ops.inviteDecline("i1")),
		Map.entry("o07", Ops.invitePlan("i1")),
		Map.entry("o08", Ops.inviteJoinHere("i1")),
		Map.entry("o09", Ops.joinLeave()),
		Map.entry("o10", Ops.hostInvite(List.of("f1", "f2"), true)),
		Map.entry("o11", Ops.hostKick("f1")),
		Map.entry("o12", Ops.hostStop()),
		Map.entry("o13", Ops.friendAddByCode("pumpkin-EXAMPLE")),
		Map.entry("o14", Ops.codeCreate()),
		Map.entry("o15", Ops.codeRevoke("c1")),
		Map.entry("o16", Ops.friendRename("f1", Optional.of("Kumpel"))),
		Map.entry("o17", Ops.friendRemove("f1")),
		Map.entry("o18", Ops.friendBlock("f1")),
		Map.entry("o19", Ops.blockedUnblock("f3")),
		Map.entry("o20", Ops.friendAcknowledge("f1")),
		Map.entry("o21", Ops.friendsRetry()),
		Map.entry("o22", Ops.joinFailed()),
		Map.entry("a1", Ops.hostStop()),
		Map.entry("a2", Ops.friendAddByName("Notch")),
		Map.entry("a3", Ops.hostInvite(List.of("f1"), false)),
		Map.entry("b1", Ops.hostInvite(List.of("f1", "f2"), true)),
		Map.entry("b2", Ops.friendAddByName("Notch")));

	static Stream<Line> requestLines() {
		return FILES.stream().flatMap(file -> Fixtures.read(file, MOD_TO_LAUNCHER).stream());
	}

	@ParameterizedTest(name = "{0}")
	@MethodSource("requestLines")
	void everyFixtureRequestIsExactlyWhatOpsBuilds(Line line) {
		Op<?> op = OPS_BY_REQUEST_ID.get(line.id());

		ModFrame.Req request = new ModFrame.Req(line.id(), op.name(), op.args());

		assertEquals(line.message(), JsonParser.parseString(FrameCodec.encode(request)), line.file() + " " + line.id());
	}

	@Test
	void everyOperationOfTheTableIsInTheFixtures() {
		Set<String> fixtureOps = requestLines().map(line -> line.message().get("op").getAsString()).collect(Collectors.toSet());

		assertEquals(22, fixtureOps.size());
		assertEquals(fixtureOps, publicOpFactories(), "Ops has a factory the fixtures do not show, or the other way round");
	}

	@Test
	void theBuildersAreExactlyTheOperationsOfTable54() {
		List<String> table54 = List.of("state.sync", "launcher.open", "request.answer", "request.cancel", "friend.addByName",
			"invite.decline", "invite.plan", "invite.joinHere", "join.leave", "join.failed", "host.invite", "host.kick", "host.stop",
			"friend.addByCode", "code.create", "code.revoke", "friend.rename", "friend.remove", "friend.block", "blocked.unblock",
			"friend.acknowledge", "friends.retry");

		assertEquals(Set.copyOf(table54), publicOpFactories());
	}

	@Test
	void successfulResultsReadWithTheReaderOfTheirOperation() {
		for (String file : FILES) {
			Map<String, Line> requestsById = Fixtures.read(file, MOD_TO_LAUNCHER).stream()
				.collect(Collectors.toMap(Line::id, line -> line));
			for (Line answer : Fixtures.read(file, LAUNCHER_TO_MOD)) {
				if (answer.type().equals("res") && answer.message().get("ok").getAsBoolean()) {
					assertTrue(requestsById.containsKey(answer.id()), file + " res without req " + answer.id());
					OPS_BY_REQUEST_ID.get(answer.id()).resultReader().apply(JsonFields.of(answer.message().get("result")));
				}
			}
		}
	}

	@Test
	void invitePlanKeepsVerdictCountsAndAlternatives() {
		JsonFields result = JsonFields.of(resultOf("o07"));

		assertEquals(new InvitePlan(PlanVerdict.MISSING_CONTENT, 2, 1,
			List.of(new PlanAlternative("Welt A", true), new PlanAlternative("Welt B", false))), InvitePlan.read(result));
	}

	@Test
	void joinHereKeepsTheLoopbackTarget() {
		assertEquals(new JoinHere("127.1.2.3", 25565), JoinHere.read(JsonFields.of(resultOf("o08"))));
	}

	@Test
	void codeCreateKeepsTheWholeCodeThatIsShownOnce() {
		assertEquals(new CodeCreated("c1", "pumpkin-EXAMPLE"), CodeCreated.read(JsonFields.of(resultOf("o14"))));
	}

	@Test
	void anOperationWithoutDataReadsAsDone() {
		assertEquals(Done.DONE, Ops.hostStop().resultReader().apply(JsonFields.of(resultOf("o12"))));
	}

	@Test
	void removingANicknameSendsAnExplicitNullAlias() {
		Op<Done> removal = Ops.friendRename("f1", Optional.empty());

		assertEquals("{\"friend\":\"f1\",\"alias\":null}", removal.args().toString());
	}

	@Test
	void operationsThatAskTheDirectoryOrTheLauncherDialogWaitLongerThanTheQuickOnes() {
		assertEquals(Limits.REQUEST_TIMEOUT, Ops.hostStop().timeout());
		assertEquals(Limits.SLOW_REQUEST_TIMEOUT, Ops.friendAddByName("x").timeout());
		assertEquals(Limits.SLOW_REQUEST_TIMEOUT, Ops.hostInvite(List.of(), false).timeout());
		assertEquals(Limits.SLOW_REQUEST_TIMEOUT, Ops.invitePlan("i1").timeout());
	}

	private static JsonElement resultOf(String id) {
		Response response = (Response) FrameCodec.decode(Fixtures.read("ops.jsonl", LAUNCHER_TO_MOD).stream()
			.filter(line -> line.id().equals(id)).findFirst().orElseThrow().wire()).orElseThrow();
		return response.result().orElseThrow().raw();
	}

	private static Set<String> publicOpFactories() {
		return Stream.of(Ops.class.getDeclaredMethods())
			.filter(method -> Modifier.isPublic(method.getModifiers()) && Op.class.equals(method.getReturnType()))
			.map(OpsFixturesTest::nameOfOpBuiltBy)
			.collect(Collectors.toSet());
	}

	/** Calls the factory with placeholder arguments and reads the wire name from the operation it returns. */
	private static String nameOfOpBuiltBy(Method factory) {
		Object[] arguments = new Object[factory.getParameterCount()];
		Class<?>[] types = factory.getParameterTypes();
		for (int index = 0; index < types.length; index++) {
			arguments[index] = placeholderOf(types[index]);
		}
		try {
			return ((Op<?>) factory.invoke(null, arguments)).name();
		} catch (ReflectiveOperationException failure) {
			throw new IllegalStateException(factory.getName(), failure);
		}
	}

	private static Object placeholderOf(Class<?> type) {
		if (type == String.class) {
			return "x";
		}
		if (type == boolean.class) {
			return false;
		}
		if (type == List.class) {
			return List.of();
		}
		if (type == Optional.class) {
			return Optional.empty();
		}
		return OpenTarget.FRIENDS;
	}
}
