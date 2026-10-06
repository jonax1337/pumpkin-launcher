package dev.laux.pumpkin.bridge.transport;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.FileSystemNotFoundException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.CodeSource;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.Optional;
import org.apache.logging.log4j.Logger;
import org.apache.logging.log4j.LogManager;

/**
 * The build id the mod announces in {@code hello} (docs/bridge/README.md): the first 16 hex characters of the SHA-256 of the
 * jar file this code runs from. A jar cannot contain its own hash, so it is computed at run time. Anything that does not run
 * from a {@code .jar} file (a development environment running from class folders) announces {@value #DEV}.
 */
public final class BuildId {
	public static final String DEV = "dev";
	public static final int PREFIX_CHARS = 16;

	private static final Logger LOG = LogManager.getLogger("pumpkin_bridge");
	private static final int READ_BUFFER_BYTES = 8192;

	private BuildId() {
	}

	/** The build id of the jar that holds the mod's own classes. */
	public static String ofOwnJar() {
		return ofClass(BuildId.class);
	}

	static String ofClass(Class<?> anchor) {
		return locationOf(anchor).map(BuildId::ofLocation).orElse(DEV);
	}

	public static String ofLocation(Path location) {
		if (!isJarFile(location)) {
			return DEV;
		}
		try {
			return sha256Prefix(location);
		} catch (IOException unreadable) {
			LOG.warn("Pumpkin Bridge: cannot read {} to compute the build id: {}", location, unreadable.getMessage());
			return DEV;
		}
	}

	private static Optional<Path> locationOf(Class<?> anchor) {
		try {
			CodeSource source = anchor.getProtectionDomain().getCodeSource();
			if (source == null || source.getLocation() == null) {
				return Optional.empty();
			}
			return Optional.of(java.nio.file.Paths.get(fileUriOf(source.getLocation().toURI())));
		} catch (URISyntaxException | IllegalArgumentException | FileSystemNotFoundException | SecurityException unusable) {
			return Optional.empty();
		}
	}

	/** Loaders may hand out {@code jar:file:/x.jar!/} instead of {@code file:/x.jar}. */
	private static URI fileUriOf(URI location) throws URISyntaxException {
		if (!"jar".equals(location.getScheme())) {
			return location;
		}
		String inner = location.getRawSchemeSpecificPart();
		int separator = inner.indexOf("!/");
		return new URI(separator < 0 ? inner : inner.substring(0, separator));
	}

	private static boolean isJarFile(Path location) {
		return Files.isRegularFile(location) && location.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".jar");
	}

	private static String sha256Prefix(Path jar) throws IOException {
		MessageDigest digest = newSha256();
		try (InputStream in = Files.newInputStream(jar)) {
			byte[] buffer = new byte[READ_BUFFER_BYTES];
			for (int read = in.read(buffer); read >= 0; read = in.read(buffer)) {
				digest.update(buffer, 0, read);
			}
		}
		StringBuilder hex = new StringBuilder();
		for (byte value : digest.digest()) {
			hex.append(String.format("%02x", value));
		}
		return hex.substring(0, PREFIX_CHARS);
	}

	private static MessageDigest newSha256() {
		try {
			return MessageDigest.getInstance("SHA-256");
		} catch (NoSuchAlgorithmException missing) {
			throw new IllegalStateException("Every Java runtime has SHA-256", missing);
		}
	}
}
