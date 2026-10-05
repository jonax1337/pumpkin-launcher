package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The Minecraft-name shape of the "Per Name" field (BYNAME 9.3) and what is sent. */
class AddFriendFormTest {
	@Test
	void lettersDigitsAndTheUnderscoreAreAMinecraftName() {
		assertTrue(AddFriendForm.isMcName("Notch"));
		assertTrue(AddFriendForm.isMcName("jeb_"));
		assertTrue(AddFriendForm.isMcName("S"));
		assertTrue(AddFriendForm.isMcName("a1_B2_c3"));
		assertTrue(AddFriendForm.isMcName("n".repeat(16)), "sixteen characters are allowed");
	}

	@Test
	void everythingElseIsNot() {
		assertFalse(AddFriendForm.isMcName(""));
		assertFalse(AddFriendForm.isMcName("n".repeat(17)), "seventeen characters are one too many");
		assertFalse(AddFriendForm.isMcName("Jürgen"), "no umlauts");
		assertFalse(AddFriendForm.isMcName("Notch "));
		assertFalse(AddFriendForm.isMcName("Notch-"));
		assertFalse(AddFriendForm.isMcName("§cNotch"));
		assertFalse(AddFriendForm.isMcName("Max Mustermann"));
	}

	@Test
	void theNameToSendIsTheTrimmedInput() {
		AddFriendForm form = new AddFriendForm();

		form.edit("  Notch  ");

		assertEquals(Optional.of("Notch"), form.nameToSend());
		assertEquals("  Notch  ", form.typed(), "the field keeps what the player typed");
	}

	@Test
	void aBlankFieldSendsNothing() {
		AddFriendForm form = new AddFriendForm();
		form.edit("   ");

		assertEquals(Optional.empty(), form.nameToSend());
	}
}
