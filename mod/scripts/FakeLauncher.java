import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Plays the launcher side of the mod channel, protocol 2 (docs/friends/INGAME.md, 5.3), so the mod can be tried without the
 * launcher: {@code java scripts/FakeLauncher.java}, then set the printed environment variables and start the game.
 * It keeps the limits of the real bridge (hello within 2 s and 1 KiB, 16 KiB lines, 20 messages per second, 8 requests in
 * flight, ping every 10 s, 30 s of silence closes), pushes the topics, and answers the operations a player can try from the
 * pause menu. It is a test tool: it reads the mod's lines with patterns, not with a JSON parser, and checks less strictly.
 */
public final class FakeLauncher {
	private static final int PROTOCOL = 2;
	private static final int PRE_WELCOME_LINE_BYTES = 1024;
	private static final int MOD_LINE_BYTES = 16 * 1024;
	private static final int MESSAGES_PER_SECOND = 20;
	private static final int MAX_IN_FLIGHT = 8;
	private static final int PING_SECONDS = 10;
	private static final int SILENCE_SECONDS = 30;
	private static final int HELLO_SECONDS = 2;
	private static final int MAX_GUESTS = 7;

	private static final Pattern STRING_MEMBER = Pattern.compile("\"(%s)\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
	private static final Pattern PORT = Pattern.compile("\"port\"\\s*:\\s*(\\d+)");
	private static final Pattern FRIENDS_LIST = Pattern.compile("\"friends\"\\s*:\\s*\\[([^\\]]*)]");
	private static final Pattern QUOTED = Pattern.compile("\"([^\"]*)\"");
	private static final Pattern ACCEPT = Pattern.compile("\"accept\"\\s*:\\s*(true|false)");

	private final String token = randomToken();
	private final Map<String, Friend> friends = new LinkedHashMap<>();
	private final Map<String, String> guests = new LinkedHashMap<>();
	private final List<String> inviteTitles = new ArrayList<>();
	private final List<String> incomingRequests = new ArrayList<>();
	private final Map<String, Integer> revisions = new LinkedHashMap<>();
	private final Deque<Long> inboundTimes = new ArrayDeque<>();
	private final Map<String, Boolean> grantedScopes = new LinkedHashMap<>();
	private final Map<String, String> pendingByScope = new LinkedHashMap<>();
	private int inFlight;
	private int lanPort;
	private String nextError;
	private volatile Link link;

	private FakeLauncher() {
		String sectionSign = Character.toString(0xA7);
		String rightToLeftOverride = Character.toString(0x202E);
		friends.put("f1", new Friend("jeb_", "853c80ef3c3749fdaa49938b674adae6", "online"));
		friends.put("f2", new Friend(sectionSign + "cRot" + rightToLeftOverride + "evil", null, "online"));
		friends.put("f3", new Friend("Notch", "069a79f444e94726a5befca90e38aaf5", "offline"));
	}

	public static void main(String[] args) throws IOException {
		new FakeLauncher().run();
	}

	private static String randomToken() {
		byte[] bytes = new byte[32];
		new SecureRandom().nextBytes(bytes);
		return HexFormat.of().formatHex(bytes);
	}

	private void run() throws IOException {
		try (ServerSocket server = new ServerSocket(0, 4, InetAddress.getLoopbackAddress())) {
			printEnvironment(server.getLocalPort());
			startThread(this::readCommands, "commands");
			startThread(this::pingRegularly, "pings");
			while (true) {
				Socket mod = server.accept();
				startThread(() -> serve(mod), "connection");
			}
		}
	}

	private void printEnvironment(int port) {
		System.out.println("PowerShell:");
		System.out.printf("  $env:PUMPKIN_IPC_PORT='%d'; $env:PUMPKIN_IPC_TOKEN='%s'; $env:PUMPKIN_IPC_PROTOCOL='%d'%n",
			port, token, PROTOCOL);
		System.out.println("sh:");
		System.out.printf("  export PUMPKIN_IPC_PORT=%d PUMPKIN_IPC_TOKEN=%s PUMPKIN_IPC_PROTOCOL=%d%n", port, token, PROTOCOL);
		System.out.println("Commands: allow, deny, invite, request, online, offline, error <code>, closing [reason], quit");
	}

	private static void startThread(Runnable task, String name) {
		Thread thread = new Thread(task, name);
		thread.setDaemon(true);
		thread.start();
	}

	// ---- one connection -------------------------------------------------------------------------------------------

	private void serve(Socket mod) {
		try (mod) {
			OutputStream connection = mod.getOutputStream();
			InputStream in = mod.getInputStream();
			mod.setSoTimeout(HELLO_SECONDS * 1000);
			String hello = readLine(in, PRE_WELCOME_LINE_BYTES);
			System.out.println("<- " + hello);
			if (!welcome(mod, connection, hello)) {
				return;
			}
			mod.setSoTimeout(SILENCE_SECONDS * 1000);
			converse(in);
		} catch (SocketTimeoutException silent) {
			System.out.println("   The mod was silent for too long: connection closed");
		} catch (IOException ended) {
			System.out.println("   Connection ended: " + ended.getMessage());
		} finally {
			dropLink(mod);
		}
	}

	/** Checks the hello like the bridge does and answers with {@code welcome} or {@code reject}. */
	private boolean welcome(Socket mod, OutputStream connection, String hello) throws IOException {
		if (!hello.contains("\"protocol\":" + PROTOCOL)) {
			return rejectWith(connection, "protocol");
		}
		if (!hello.contains("\"token\":\"" + token + "\"")) {
			return rejectWith(connection, "token");
		}
		synchronized (this) {
			if (link != null) {
				return rejectWith(connection, "duplicate");
			}
			link = new Link(mod, connection);
		}
		resetPerConnectionState();
		send("{\"type\":\"welcome\",\"protocol\":" + PROTOCOL + ",\"launcher\":\"fake\",\"scopes\":{\"share\":\"ask\",\"social\":\"ask\"}}");
		pushAllTopics();
		return true;
	}

	private boolean rejectWith(OutputStream connection, String reason) throws IOException {
		sendTo(connection, "{\"type\":\"reject\",\"reason\":\"" + reason + "\"}");
		return false;
	}

	private synchronized void resetPerConnectionState() {
		inboundTimes.clear();
		inFlight = 0;
		pendingByScope.clear();
	}

	private void converse(InputStream in) throws IOException {
		while (true) {
			String line = readLine(in, MOD_LINE_BYTES);
			System.out.println("<- " + line);
			if (!withinMessageBudget()) {
				System.out.println("   More than " + MESSAGES_PER_SECOND + " messages in a second: connection closed");
				return;
			}
			handle(line);
		}
	}

	private synchronized boolean withinMessageBudget() {
		long now = System.nanoTime();
		while (!inboundTimes.isEmpty() && now - inboundTimes.peekFirst() >= 1_000_000_000L) {
			inboundTimes.pollFirst();
		}
		inboundTimes.addLast(now);
		return inboundTimes.size() <= MESSAGES_PER_SECOND;
	}

	private synchronized void dropLink(Socket mod) {
		if (link != null && link.socket() == mod) {
			link = null;
			lanPort = 0;
			System.out.println("   Mod disconnected");
		}
	}

	// ---- what the mod sends ---------------------------------------------------------------------------------------

	private synchronized void handle(String line) throws IOException {
		switch (stringMember("type", line)) {
			case "ping" -> send("{\"type\":\"pong\"}");
			case "pong", "ready" -> { }
			case "lanOpened" -> {
				lanPort = Integer.parseInt(first(PORT, line));
				System.out.println("   LAN port reported: " + lanPort);
				push("game");
			}
			case "lanClosed" -> {
				lanPort = 0;
				System.out.println("   LAN closed");
				push("game");
			}
			case "req" -> request(stringMember("id", line), stringMember("op", line), line);
			default -> System.out.println("   unknown message");
		}
	}

	private void request(String id, String op, String line) throws IOException {
		if (inFlight >= MAX_IN_FLIGHT) {
			fail(id, "busy");
			return;
		}
		if (nextError != null) {
			String code = nextError;
			nextError = null;
			fail(id, code);
			return;
		}
		switch (op) {
			case "state.sync" -> {
				pushAllTopics();
				succeed(id);
			}
			case "launcher.open" -> {
				System.out.println("   The launcher would open its window now");
				succeed(id);
			}
			case "host.invite" -> hostInvite(id, quotedValues(first(FRIENDS_LIST, line)));
			case "host.kick" -> hostKick(id, stringMember("friend", line));
			case "host.stop" -> hostStop(id);
			case "request.answer" -> answerRequest(id, first(ACCEPT, line));
			case "request.cancel", "invite.decline", "join.leave" -> succeed(id);
			case "friend.addByName" -> addByName(id, stringMember("name", line));
			default -> fail(id, "unsupportedOp");
		}
	}

	private void hostInvite(String id, List<String> aliases) throws IOException {
		if (lanPort == 0) {
			fail(id, "lanPortUnknown");
		} else if (grantedScopes.getOrDefault("share", false)) {
			addGuests(id, aliases);
		} else {
			askForScope(id, "share", String.join(",", aliases));
		}
	}

	private void addGuests(String id, List<String> aliases) throws IOException {
		List<String> invited = aliases.stream().filter(friends::containsKey).toList();
		if (guests.size() + invited.size() > MAX_GUESTS) {
			fail(id, "guestLimit");
			return;
		}
		invited.forEach(alias -> guests.put(alias, "invited"));
		push("session");
		succeed(id);
		for (String alias : invited) {
			guests.put(alias, "connected");
			notifyMod("guestJoined", friends.get(alias).name());
		}
		push("session");
	}

	private void hostKick(String id, String alias) throws IOException {
		if (guests.remove(alias) == null) {
			fail(id, "unknownFriend");
			return;
		}
		succeed(id);
		notifyMod("guestLeft", friends.get(alias).name());
		push("session");
	}

	private void hostStop(String id) throws IOException {
		guests.clear();
		succeed(id);
		notifyMod("sessionEnded", null);
		push("session");
	}

	private void answerRequest(String id, String accept) throws IOException {
		if (incomingRequests.isEmpty()) {
			fail(id, "notFound");
			return;
		}
		String name = incomingRequests.remove(0);
		if (accept.equals("true")) {
			friends.put("f" + (friends.size() + 1), new Friend(name, null, "offline"));
		}
		succeed(id);
		push("requests");
		push("friends");
	}

	private void addByName(String id, String name) throws IOException {
		if (!grantedScopes.getOrDefault("social", false)) {
			askForScope(id, "social", name);
			return;
		}
		completeAddByName(id, name);
	}

	private void completeAddByName(String id, String name) throws IOException {
		boolean known = friends.values().stream().anyMatch(friend -> friend.name().equalsIgnoreCase(name));
		if (known) {
			succeed(id);
		} else {
			fail(id, "nameUnknown");
		}
	}

	private void askForScope(String id, String scope, String argument) throws IOException {
		inFlight++;
		pendingByScope.put(scope, id + "|" + argument);
		send("{\"type\":\"pending\",\"id\":\"" + id + "\",\"prompt\":\"scope\",\"scope\":\"" + scope + "\"}");
		System.out.println("   First " + scope + " action of this start: type 'allow' or 'deny'");
	}

	// ---- what the console commands do -----------------------------------------------------------------------------

	private void readCommands() {
		BufferedReader console = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
		try {
			for (String command = console.readLine(); command != null; command = console.readLine()) {
				runCommand(command.trim());
			}
		} catch (IOException consoleClosed) {
			System.out.println("Console closed: " + consoleClosed.getMessage());
		}
	}

	private synchronized void runCommand(String command) throws IOException {
		if (link == null && !command.equals("quit")) {
			System.out.println("   No mod connected");
			return;
		}
		String[] words = command.split("\\s+", 2);
		switch (words[0]) {
			case "allow" -> answerPending(true);
			case "deny" -> answerPending(false);
			case "invite" -> {
				inviteTitles.add("Island world");
				notifyMod("inviteReceived", "jeb_");
				push("invites");
			}
			case "request" -> {
				incomingRequests.add("Dream");
				notifyMod("requestReceived", "Dream");
				push("requests");
			}
			case "online", "offline" -> setPresence("f3", words[0]);
			case "error" -> {
				nextError = words.length > 1 ? words[1] : "internal";
				System.out.println("   The next request is answered with " + nextError);
			}
			case "closing" -> send("{\"type\":\"event\",\"event\":\"closing\",\"reason\":\""
				+ (words.length > 1 ? words[1] : "bridgeStopped") + "\"}");
			case "quit" -> System.exit(0);
			default -> System.out.println("   Commands: allow, deny, invite, request, online, offline, error <code>, closing [reason], quit");
		}
	}

	private void answerPending(boolean allow) throws IOException {
		if (pendingByScope.isEmpty()) {
			System.out.println("   Nothing waits for an answer");
			return;
		}
		Map.Entry<String, String> waiting = pendingByScope.entrySet().iterator().next();
		pendingByScope.remove(waiting.getKey());
		String[] idAndArgument = waiting.getValue().split("\\|", 2);
		inFlight--;
		if (!allow) {
			fail(idAndArgument[0], "denied");
			notifyMod("scopeDenied", null);
			return;
		}
		grantedScopes.put(waiting.getKey(), true);
		if (waiting.getKey().equals("share")) {
			addGuests(idAndArgument[0], List.of(idAndArgument[1].split(",")));
		} else {
			completeAddByName(idAndArgument[0], idAndArgument[1]);
		}
	}

	private void setPresence(String alias, String presence) throws IOException {
		Friend friend = friends.get(alias);
		friends.put(alias, new Friend(friend.name(), friend.mcUuid(), presence));
		push("friends");
		if (presence.equals("online")) {
			notifyMod("friendOnline", friend.name());
		}
	}

	private void pingRegularly() {
		while (true) {
			try {
				Thread.sleep(PING_SECONDS * 1000L);
				synchronized (this) {
					if (link != null) {
						send("{\"type\":\"ping\"}");
					}
				}
			} catch (InterruptedException | IOException stopped) {
				return;
			}
		}
	}

	// ---- topics and frames ----------------------------------------------------------------------------------------

	private void pushAllTopics() throws IOException {
		for (String topic : List.of("me", "friends", "requests", "invites", "session", "join", "game", "codes", "blocked")) {
			push(topic);
		}
	}

	private void push(String topic) throws IOException {
		int revision = revisions.merge(topic, 1, Integer::sum);
		send("{\"type\":\"state\",\"topic\":\"" + topic + "\",\"rev\":" + revision + ",\"value\":" + valueOf(topic) + "}");
	}

	private String valueOf(String topic) {
		return switch (topic) {
			case "me" -> "{\"enabled\":true,\"availability\":\"available\",\"network\":\"online\",\"fingerprint\":\"ab12 cd34\"}";
			case "friends" -> friendsJson();
			case "requests" -> requestsJson();
			case "invites" -> invitesJson();
			case "session" -> guests.isEmpty() ? "null" : "{\"guests\":[" + guestsJson() + "]}";
			case "game" -> "{\"hostable\":true,\"reason\":null,\"lan\":" + (lanPort == 0 ? "null" : "{\"port\":" + lanPort + "}") + "}";
			default -> topic.equals("join") ? "null" : "[]";
		};
	}

	private String friendsJson() {
		List<String> entries = new ArrayList<>();
		friends.forEach((alias, friend) -> entries.add("{\"id\":\"" + alias + "\",\"name\":" + json(friend.name())
			+ ",\"mcUuid\":" + json(friend.mcUuid()) + ",\"presence\":\"" + friend.presence() + "\"}"));
		return "[" + String.join(",", entries) + "]";
	}

	private String guestsJson() {
		List<String> entries = new ArrayList<>();
		guests.forEach((alias, state) -> entries.add("{\"id\":\"" + alias + "\",\"name\":" + json(friends.get(alias).name())
			+ ",\"state\":\"" + state + "\"}"));
		return String.join(",", entries);
	}

	private String invitesJson() {
		List<String> entries = new ArrayList<>();
		for (int index = 0; index < inviteTitles.size(); index++) {
			entries.add("{\"id\":\"i" + index + "\",\"fromName\":\"jeb_\",\"title\":" + json(inviteTitles.get(index)) + "}");
		}
		return "[" + String.join(",", entries) + "]";
	}

	private String requestsJson() {
		List<String> entries = new ArrayList<>();
		for (int index = 0; index < incomingRequests.size(); index++) {
			entries.add("{\"id\":\"r" + index + "\",\"name\":" + json(incomingRequests.get(index)) + ",\"mcName\":"
				+ json(incomingRequests.get(index)) + ",\"fingerprint\":\"ab12 cd34\"}");
		}
		return "{\"incoming\":[" + String.join(",", entries) + "],\"outgoing\":[]}";
	}

	private void notifyMod(String kind, String name) throws IOException {
		send("{\"type\":\"event\",\"event\":\"notify\",\"kind\":\"" + kind + "\""
			+ (name == null ? "" : ",\"name\":" + json(name)) + "}");
	}

	private void succeed(String id) throws IOException {
		send("{\"type\":\"res\",\"id\":\"" + id + "\",\"ok\":true,\"result\":{}}");
	}

	private void fail(String id, String code) throws IOException {
		send("{\"type\":\"res\",\"id\":\"" + id + "\",\"ok\":false,\"error\":{\"code\":\"" + code + "\",\"params\":{}}}");
	}

	private void send(String line) throws IOException {
		Link current = link;
		if (current != null) {
			sendTo(current.out, line);
		}
	}

	private static void sendTo(OutputStream connection, String line) throws IOException {
		System.out.println("-> " + line);
		connection.write((line + "\n").getBytes(StandardCharsets.UTF_8));
		connection.flush();
	}

	/** Reads one line of at most {@code limit} bytes including the line ending, like the bridge does. */
	private static String readLine(InputStream in, int limit) throws IOException {
		ByteArrayOutputStream line = new ByteArrayOutputStream();
		for (int next = in.read(); next != '\n'; next = in.read()) {
			if (next < 0) {
				throw new IOException("the mod closed the connection");
			}
			line.write(next);
			if (line.size() + 1 > limit) {
				throw new IOException("line longer than " + limit + " bytes");
			}
		}
		return line.toString(StandardCharsets.UTF_8);
	}

	/** JSON string; everything outside printable ASCII becomes an escape so the test names arrive unchanged. */
	private static String json(String value) {
		if (value == null) {
			return "null";
		}
		StringBuilder escaped = new StringBuilder("\"");
		value.chars().forEach(c -> {
			if (c >= 0x20 && c < 0x7F && c != '"' && c != '\\') {
				escaped.append((char) c);
			} else {
				escaped.append('\\').append('u').append(String.format("%04x", c));
			}
		});
		return escaped.append('"').toString();
	}

	private static String stringMember(String name, String line) {
		Matcher matcher = Pattern.compile(String.format(STRING_MEMBER.pattern(), name)).matcher(line);
		return matcher.find() ? matcher.group(2) : "";
	}

	private static String first(Pattern pattern, String line) {
		Matcher matcher = pattern.matcher(line);
		return matcher.find() ? matcher.group(1) : "";
	}

	private static List<String> quotedValues(String list) {
		return QUOTED.matcher(list).results().map(match -> match.group(1)).toList();
	}

	private record Friend(String name, String mcUuid, String presence) {
	}

	private record Link(Socket socket, OutputStream out) {
	}
}
