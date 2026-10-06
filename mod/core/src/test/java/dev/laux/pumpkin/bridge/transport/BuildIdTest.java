package dev.laux.pumpkin.bridge.transport;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** A6: the build id is the start of the SHA-256 of the jar the mod runs from, or "dev" when it does not run from a jar. */
class BuildIdTest {
	private static final String ANCHOR_RESOURCE = "BuildIdTest$Anchor.class";

	@TempDir
	Path folder;

	/** A class with no dependencies that tests load from a jar, from nowhere, or from a class folder. */
	public static final class Anchor {
	}

	@Test
	void aJarFileGivesTheFirstSixteenHexCharactersOfItsSha256() throws Exception {
		Path jar = Files.write(folder.resolve("pumpkin_bridge.jar"), "not really a jar".getBytes(StandardCharsets.UTF_8));

		String id = BuildId.ofLocation(jar);

		assertEquals(sha256Of(jar).substring(0, 16), id);
		assertTrue(id.matches("[0-9a-f]{16}"), id);
	}

	@Test
	void theIdChangesWithTheContentOfTheJar() throws Exception {
		Path first = Files.write(folder.resolve("a.jar"), new byte[] {1});
		Path second = Files.write(folder.resolve("b.jar"), new byte[] {2});

		assertNotEquals(BuildId.ofLocation(first), BuildId.ofLocation(second));
	}

	@Test
	void theFileExtensionMayBeInCapitals() throws Exception {
		Path jar = Files.write(folder.resolve("MOD.JAR"), new byte[] {7});

		assertEquals(sha256Of(jar).substring(0, 16), BuildId.ofLocation(jar));
	}

	@Test
	void aDirectoryIsDev() throws IOException {
		assertEquals("dev", BuildId.ofLocation(Files.createDirectory(folder.resolve("classes"))));
	}

	@Test
	void aDirectoryThatIsNamedLikeAJarIsStillDev() throws IOException {
		assertEquals("dev", BuildId.ofLocation(Files.createDirectory(folder.resolve("looks-like.jar"))));
	}

	@Test
	void aFileThatIsNotAJarIsDev() throws IOException {
		assertEquals("dev", BuildId.ofLocation(Files.write(folder.resolve("mod.zip"), new byte[] {1})));
	}

	@Test
	void aJarThatIsGoneIsDev() {
		assertEquals("dev", BuildId.ofLocation(folder.resolve("gone.jar")));
	}

	@Test
	void aClassRunningFromAJarGivesTheHashOfThatJar() throws Exception {
		Path jar = jarWithAnchor();

		try (URLClassLoader loader = new URLClassLoader(new URL[] {jar.toUri().toURL()}, null)) {
			Class<?> fromJar = loader.loadClass(Anchor.class.getName());

			assertEquals(sha256Of(jar).substring(0, 16), BuildId.ofClass(fromJar));
		}
	}

	@Test
	void aClassWithoutACodeSourceIsDev() throws IOException {
		Class<?> orphan = new Definer().define(anchorBytes());

		assertEquals("dev", BuildId.ofClass(orphan));
	}

	@Test
	void aClassFromAClassFolderIsDev() {
		assertEquals("dev", BuildId.ofClass(Anchor.class));
	}

	@Test
	void theOwnJarOfTheTestsIsDevBecauseTheyRunFromClassFolders() {
		assertEquals("dev", BuildId.ofOwnJar());
	}

	private Path jarWithAnchor() throws IOException {
		Path jar = folder.resolve("with-anchor.jar");
		try (OutputStream file = Files.newOutputStream(jar); JarOutputStream out = new JarOutputStream(file)) {
			out.putNextEntry(new JarEntry(Anchor.class.getName().replace('.', '/') + ".class"));
			out.write(anchorBytes());
			out.closeEntry();
		}
		return jar;
	}

	private static byte[] anchorBytes() throws IOException {
		try (InputStream in = BuildIdTest.class.getResourceAsStream(ANCHOR_RESOURCE)) {
			return in.readAllBytes();
		}
	}

	private static String sha256Of(Path file) throws Exception {
		return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file)));
	}

	private static final class Definer extends ClassLoader {
		Class<?> define(byte[] bytes) {
			return defineClass(null, bytes, 0, bytes.length);
		}
	}
}
