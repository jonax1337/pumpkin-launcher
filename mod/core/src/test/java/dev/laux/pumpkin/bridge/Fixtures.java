package dev.laux.pumpkin.bridge;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

/**
 * The shared golden lines of the launcher channel ({@code mod/fixtures/protocol}). The Rust tests read the same files; the
 * directory comes from the Gradle test property, never from a copy.
 */
public final class Fixtures {
	/** The token every fixture {@code hello} carries; {@link ScriptedLauncher} uses it as the launch token. */
	public static final String TOKEN = "0123456789abcdef".repeat(4);

	private static final String DIRECTORY_PROPERTY = "pumpkin.fixtures.protocol";

	private Fixtures() {
	}

	public enum Direction {
		MOD_TO_LAUNCHER,
		LAUNCHER_TO_MOD,
		NONE;

		static Direction of(String wire) {
			switch (wire) {
				case "modToLauncher":
					return MOD_TO_LAUNCHER;
				case "launcherToMod":
					return LAUNCHER_TO_MOD;
				case "none":
					return NONE;
				default:
					throw new IllegalArgumentException("unknown direction " + wire);
			}
		}
	}

	/** One fixture entry: who sends it and the exact wire message. */
	public record Line(String file, Direction direction, JsonObject message) {
		/** The message as it goes over the wire, without the line ending. */
		public String wire() {
			return message.toString();
		}

		public String type() {
			return message.get("type").getAsString();
		}

		public String id() {
			return message.get("id").getAsString();
		}
	}

	public static List<Line> read(String file) {
		try {
			return Files.readAllLines(directory().resolve(file), StandardCharsets.UTF_8).stream()
				.filter(text -> !text.isBlank())
				.map(text -> toLine(file, text))
				.toList();
		} catch (IOException unreadable) {
			throw new UncheckedIOException("fixture " + file, unreadable);
		}
	}

	/** The lines sent in one direction, in file order. */
	public static List<Line> read(String file, Direction direction) {
		return read(file).stream().filter(line -> line.direction() == direction).toList();
	}

	/** The single line of the file that goes in that direction. */
	public static Line only(String file, Direction direction) {
		List<Line> lines = read(file, direction);
		if (lines.size() != 1) {
			throw new IllegalStateException(file + " has " + lines.size() + " lines " + direction);
		}
		return lines.get(0);
	}

	public static List<String> fileNames() {
		try (Stream<Path> files = Files.list(directory())) {
			return files.map(path -> path.getFileName().toString()).filter(name -> name.endsWith(".jsonl")).sorted().toList();
		} catch (IOException unreadable) {
			throw new UncheckedIOException("fixture directory", unreadable);
		}
	}

	private static Line toLine(String file, String text) {
		JsonObject entry = new JsonParser().parse(text).getAsJsonObject();
		return new Line(file, Direction.of(entry.get("direction").getAsString()), entry.getAsJsonObject("line"));
	}

	private static Path directory() {
		String configured = System.getProperty(DIRECTORY_PROPERTY);
		if (configured == null) {
			throw new IllegalStateException("system property " + DIRECTORY_PROPERTY + " is not set; run the tests through Gradle");
		}
		return Path.of(configured);
	}
}
