package dev.laux.pumpkin.bridge.protocol;

import static dev.laux.pumpkin.bridge.Fixtures.Direction.LAUNCHER_TO_MOD;
import static dev.laux.pumpkin.bridge.Fixtures.Direction.MOD_TO_LAUNCHER;
import static org.junit.jupiter.api.Assertions.assertEquals;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.laux.pumpkin.bridge.Fixtures;
import dev.laux.pumpkin.bridge.Fixtures.Line;
import java.util.List;
import org.junit.jupiter.api.Test;

/** hints.jsonl: what the mod tells the launcher besides requests, and the keep-alive in both directions. */
class HintsFixturesTest {
	private static final List<Line> FROM_MOD = Fixtures.read("hints.jsonl", MOD_TO_LAUNCHER);
	private static final List<Line> FROM_LAUNCHER = Fixtures.read("hints.jsonl", LAUNCHER_TO_MOD);

	@Test
	void theModHintsEncodeExactlyAsInTheFixture() {
		List<ModFrame> frames = List.of(new ModFrame.LanOpened(50123), new ModFrame.LanClosed(),
			new ModFrame.Ready(List.of("hub", "share")), new ModFrame.Ping(), new ModFrame.Pong());

		assertEquals(frames.size(), FROM_MOD.size());
		for (int index = 0; index < frames.size(); index++) {
			JsonObject encoded = new JsonParser().parse(FrameCodec.encode(frames.get(index))).getAsJsonObject();
			assertEquals(FROM_MOD.get(index).message(), encoded, FROM_MOD.get(index).type());
		}
	}

	@Test
	void theLauncherKeepAliveDecodes() {
		List<LauncherFrame> frames = FROM_LAUNCHER.stream().map(line -> FrameCodec.decode(line.wire()).orElseThrow()).toList();

		assertEquals(List.of(new LauncherFrame.Pong(), new LauncherFrame.Ping()), frames);
	}
}
