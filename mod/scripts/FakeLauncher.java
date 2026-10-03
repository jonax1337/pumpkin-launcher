import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Spielt die Launcher-Seite der Mod-Brücke (SPEC 7) für die GUI-Checkliste in mod/README.md. Ohne Abhängigkeiten:
 * {@code java scripts/FakeLauncher.java}, dann die ausgegebenen Umgebungsvariablen setzen und das Spiel starten.
 * Nur ein Testwerkzeug: es prüft die Nachrichten der Mod nicht so streng wie der echte Launcher.
 */
public final class FakeLauncher {
	private static final Pattern TYPE = Pattern.compile("\"type\"\\s*:\\s*\"([A-Za-z]+)\"");
	private static final Pattern STRING_LIST = Pattern.compile("\"friendIds\"\\s*:\\s*\\[([^\\]]*)]");
	private static final Pattern FRIEND_ID = Pattern.compile("\"friendId\"\\s*:\\s*\"([^\"]*)\"");
	private static final Pattern PORT = Pattern.compile("\"port\"\\s*:\\s*(\\d+)");
	private static final Pattern QUOTED = Pattern.compile("\"([^\"]*)\"");

	private final String token = randomToken();
	private final Map<String, Friend> friends = new LinkedHashMap<>();
	private final Map<String, String> guests = new LinkedHashMap<>();
	private final List<String> invites = new ArrayList<>();
	private List<String> pendingShare = List.of();
	private boolean shareAllowed;
	private volatile OutputStream out;

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
		try (ServerSocket server = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
			printEnvironment(server.getLocalPort());
			Thread commands = new Thread(this::readCommands, "commands");
			commands.setDaemon(true);
			commands.start();
			while (true) {
				try (Socket mod = server.accept()) {
					serve(mod);
				} catch (IOException ended) {
					System.out.println("Verbindung beendet: " + ended.getMessage());
				}
				out = null;
				shareAllowed = false;
			}
		}
	}

	private void printEnvironment(int port) {
		System.out.println("PowerShell:");
		System.out.printf("  $env:PUMPKIN_IPC_PORT='%d'; $env:PUMPKIN_IPC_TOKEN='%s'; $env:PUMPKIN_IPC_PROTOCOL='1'%n",
			port, token);
		System.out.println("sh:");
		System.out.printf("  export PUMPKIN_IPC_PORT=%d PUMPKIN_IPC_TOKEN=%s PUMPKIN_IPC_PROTOCOL=1%n", port, token);
		System.out.println("Befehle: allow, deny, invite, online, offline, error <code>, quit");
	}

	private void serve(Socket mod) throws IOException {
		BufferedReader in = new BufferedReader(new InputStreamReader(mod.getInputStream(), StandardCharsets.UTF_8));
		OutputStream connection = mod.getOutputStream();
		for (String line = in.readLine(); line != null; line = in.readLine()) {
			System.out.println("<- " + line);
			if (out == null) {
				greet(connection, line);
			} else {
				handle(line);
			}
		}
	}

	private void greet(OutputStream connection, String hello) throws IOException {
		if (!hello.contains("\"token\":\"" + token + "\"")) {
			sendTo(connection, "{\"type\":\"reject\",\"reason\":\"token\"}");
			throw new IOException("falsches Token");
		}
		out = connection;
		send("{\"type\":\"welcome\",\"protocol\":1,\"launcher\":\"fake\"}");
		sendSnapshot();
	}

	private synchronized void handle(String line) throws IOException {
		switch (type(line)) {
			case "ping" -> send("{\"type\":\"pong\"}");
			case "lanOpened" -> System.out.println("   LAN-Port gemeldet: " + first(PORT, line));
			case "lanClosed" -> System.out.println("   LAN geschlossen");
			case "share" -> share(quotedValues(first(STRING_LIST, line)));
			case "kick" -> kick(first(FRIEND_ID, line));
			case "stopSharing" -> stopSharing();
			default -> System.out.println("   unbekannt");
		}
	}

	private void share(List<String> friendIds) throws IOException {
		if (shareAllowed) {
			addGuests(friendIds);
			return;
		}
		pendingShare = friendIds;
		notifyMod("confirmInLauncher", null);
		System.out.println("   Erstes Teilen dieses Starts: 'allow' oder 'deny' eingeben");
	}

	private void addGuests(List<String> requestedIds) throws IOException {
		List<String> friendIds = requestedIds.stream().filter(friends::containsKey).toList();
		for (String id : friendIds) {
			guests.put(id, "invited");
		}
		sendSnapshot();
		for (String id : friendIds) {
			guests.put(id, "connected");
			notifyMod("guestJoined", friends.get(id));
		}
		sendSnapshot();
	}

	private void kick(String friendId) throws IOException {
		guests.remove(friendId);
		notifyMod("guestLeft", friends.get(friendId));
		sendSnapshot();
	}

	private void stopSharing() throws IOException {
		guests.clear();
		notifyMod("sessionEnded", null);
		sendSnapshot();
	}

	private void readCommands() {
		BufferedReader console = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
		try {
			for (String command = console.readLine(); command != null; command = console.readLine()) {
				runCommand(command.trim());
			}
		} catch (IOException consoleClosed) {
			System.out.println("Konsole geschlossen: " + consoleClosed.getMessage());
		}
	}

	private synchronized void runCommand(String command) throws IOException {
		if (out == null && !command.equals("quit")) {
			System.out.println("   Keine Mod verbunden");
			return;
		}
		String[] words = command.split("\\s+", 2);
		switch (words[0]) {
			case "allow" -> {
				shareAllowed = true;
				addGuests(pendingShare);
			}
			case "deny" -> send("{\"type\":\"error\",\"code\":\"denied\",\"ref\":null}");
			case "invite" -> {
				invites.add("Inselwelt");
				notifyMod("inviteReceived", friends.get("f1"));
				sendSnapshot();
			}
			case "online", "offline" -> setPresence("f3", words[0]);
			case "error" -> send("{\"type\":\"error\",\"code\":\"" + words[words.length - 1] + "\",\"ref\":null}");
			case "quit" -> System.exit(0);
			default -> System.out.println("   Befehle: allow, deny, invite, online, offline, error <code>, quit");
		}
	}

	private void setPresence(String friendId, String presence) throws IOException {
		Friend friend = friends.get(friendId);
		friends.put(friendId, new Friend(friend.name(), friend.mcUuid(), presence));
		if (presence.equals("online")) {
			notifyMod("friendOnline", friend);
		}
		sendSnapshot();
	}

	private void notifyMod(String event, Friend friend) throws IOException {
		String name = friend == null ? "null" : json(friend.name());
		String mcUuid = friend == null ? "null" : json(friend.mcUuid());
		send("{\"type\":\"notify\",\"event\":\"" + event + "\",\"name\":" + name + ",\"mcUuid\":" + mcUuid + "}");
	}

	private void sendSnapshot() throws IOException {
		List<String> friendJson = new ArrayList<>();
		friends.forEach((id, friend) -> friendJson.add("{\"id\":\"" + id + "\",\"name\":" + json(friend.name())
			+ ",\"mcUuid\":" + json(friend.mcUuid()) + ",\"presence\":\"" + friend.presence() + "\"}"));
		List<String> guestJson = new ArrayList<>();
		guests.forEach((id, state) -> guestJson.add("{\"id\":\"" + id + "\",\"name\":" + json(friends.get(id).name())
			+ ",\"state\":\"" + state + "\"}"));
		String session = guests.isEmpty() ? "null" : "{\"guests\":[" + String.join(",", guestJson) + "]}";
		List<String> inviteJson = new ArrayList<>();
		for (int i = 0; i < invites.size(); i++) {
			inviteJson.add("{\"id\":\"i" + i + "\",\"fromName\":\"jeb_\",\"title\":" + json(invites.get(i)) + "}");
		}
		send("{\"type\":\"snapshot\",\"friends\":[" + String.join(",", friendJson) + "],\"session\":" + session
			+ ",\"invites\":[" + String.join(",", inviteJson) + "]}");
	}

	private void send(String line) throws IOException {
		sendTo(out, line);
	}

	private static void sendTo(OutputStream connection, String line) throws IOException {
		System.out.println("-> " + line);
		connection.write((line + "\n").getBytes(StandardCharsets.UTF_8));
		connection.flush();
	}

	/** JSON-String; alles außerhalb von druckbarem ASCII als Escape, damit die Testnamen unverändert ankommen. */
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

	private static String type(String line) {
		Matcher matcher = TYPE.matcher(line);
		return matcher.find() ? matcher.group(1) : "";
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
}
