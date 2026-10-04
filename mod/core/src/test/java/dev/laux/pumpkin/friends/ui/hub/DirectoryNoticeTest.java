package dev.laux.pumpkin.friends.ui.hub;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.laux.pumpkin.friends.json.WireNames;
import dev.laux.pumpkin.friends.state.Me;
import org.junit.jupiter.api.Test;

/** The directory line of the "Per Name" tab (INGAME 6.2): the states the launcher shows, with their texts. */
class DirectoryNoticeTest {
	@Test
	void anActiveDirectorySaysNothing() {
		assertEquals(DirectoryNotice.NONE, DirectoryNotice.of(Me.Directory.ACTIVE));
		assertEquals("", DirectoryNotice.NONE.key());
		assertFalse(DirectoryNotice.NONE.offersLauncherOpen());
	}

	@Test
	void anOwnFindabilityThatIsOffIsInformationOnly() {
		DirectoryNotice notice = DirectoryNotice.of(Me.Directory.OFF);

		assertEquals("pumpkin_friends.add.directory.off", notice.key());
		assertFalse(notice.offersLauncherOpen(), "sending by name works regardless of the own findability");
	}

	@Test
	void theStatesWhereByNameCannotWorkOfferTheLauncher() {
		for (Me.Directory directory : new Me.Directory[] {Me.Directory.UNREACHABLE, Me.Directory.NOT_ALLOWED, Me.Directory.UNAVAILABLE}) {
			DirectoryNotice notice = DirectoryNotice.of(directory);

			assertEquals("pumpkin_friends.add.directory." + WireNames.of(directory), notice.key(), directory.name());
			assertTrue(notice.offersLauncherOpen(), directory.name());
		}
	}
}
