package dev.laux.pumpkin.bridge.ui.kit;

import dev.laux.pumpkin.bridge.ui.model.PixelIcon;
import dev.laux.pumpkin.bridge.ui.model.PumpkinTheme;
import java.io.IOException;
import java.io.InputStream;
import javax.imageio.ImageIO;

public final class BridgeIcons {
	public static final PixelIcon PUMPKIN = launcherLogo();
	// src/pixel/icon-data.ts, ICON_DATA.users.g7: the launcher's Friends icon.
	public static final PixelIcon FRIENDS = PixelIcon.mask(new String[] {
		".......", ".##.##.", ".##.##.", ".......", ".#####.", "#######", "......."
	}, PumpkinTheme.ACCENT);

	private BridgeIcons() {
	}

	private static PixelIcon launcherLogo() {
		try (InputStream image = BridgeIcons.class.getResourceAsStream("/assets/pumpkin_bridge/logo.png")) {
			if (image == null) {
				throw new IllegalStateException("Pumpkin Bridge launcher logo is missing");
			}
			return PixelIcon.image(ImageIO.read(image));
		} catch (IOException failure) {
			throw new IllegalStateException("Cannot read the Pumpkin Bridge launcher logo", failure);
		}
	}
}
