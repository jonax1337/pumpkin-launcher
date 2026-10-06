package dev.laux.pumpkin.bridge.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** The hub layout at the five resolutions of docs/bridge/README.md, "In-game navigation and world behavior", compared with the reviewable golden lists. */
class HubLayoutGoldenTest {
	@ParameterizedTest(name = "{0}x{1}")
	@CsvSource({"320,240", "427,240", "480,270", "640,360", "960,540"})
	void layoutMatchesTheGoldenList(int width, int height) throws IOException {
		assertEquals(golden(width, height), LayoutDescription.of(width, height),
			"the layout at " + width + "x" + height + " differs from ui/golden/hub-" + width + "x" + height + ".txt");
	}

	private static String golden(int width, int height) throws IOException {
		String resource = "/ui/golden/hub-" + width + "x" + height + ".txt";
		try (InputStream in = HubLayoutGoldenTest.class.getResourceAsStream(resource)) {
			if (in == null) {
				throw new IOException("golden file missing: " + resource);
			}
			return new String(in.readAllBytes(), StandardCharsets.UTF_8).replace("\r\n", "\n");
		}
	}
}
