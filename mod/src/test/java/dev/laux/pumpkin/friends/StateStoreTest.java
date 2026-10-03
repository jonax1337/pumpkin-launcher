package dev.laux.pumpkin.friends;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.laux.pumpkin.friends.bridge.Messages;
import dev.laux.pumpkin.friends.state.Snapshot;
import dev.laux.pumpkin.friends.state.StateStore;
import dev.laux.pumpkin.friends.state.StateStore.Alert;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class StateStoreTest {
	private static final Messages.Friend ALEX = new Messages.Friend("f1", "Alex", null, "online");

	private final StateStore store = new StateStore();

	@BeforeEach
	void connect() {
		store.connected();
	}

	@Test
	void startsEmptyAndDisconnected() {
		StateStore fresh = new StateStore();

		assertFalse(fresh.isConnected());
		assertEquals(Snapshot.EMPTY, fresh.snapshot());
	}

	@Test
	void appliesSnapshotsOnlyWhenDrained() {
		store.received(snapshot(List.of(ALEX), null));
		assertEquals(Snapshot.EMPTY, store.snapshot());

		store.drain();

		assertEquals(List.of(new Snapshot.Friend("f1", "Alex", Optional.empty(), Snapshot.Presence.ONLINE)),
			store.snapshot().friends());
	}

	@Test
	void dropsEntriesWithoutIdAndToleratesMissingLists() {
		store.received(new Messages.SnapshotUpdate(
			Arrays.asList(null, new Messages.Friend(null, "Ghost", null, "online"), ALEX), null, null));

		store.drain();

		assertEquals(List.of("f1"), store.snapshot().friends().stream().map(Snapshot.Friend::id).toList());
		assertEquals(List.of(), store.snapshot().invites());
		assertEquals(Optional.empty(), store.snapshot().session());
	}

	@Test
	void unknownPresenceCountsAsOffline() {
		store.received(snapshot(List.of(new Messages.Friend("f2", "Bea", null, "away")), null));

		store.drain();

		assertEquals(Snapshot.Presence.OFFLINE, store.snapshot().friends().getFirst().presence());
		assertEquals(List.of(), store.snapshot().onlineFriends());
	}

	@Test
	void notifyBecomesAnAlertWithSanitizedName() {
		store.received(new Messages.Notify("guestLeft", "§lAlex", "ABC"));

		assertEquals(List.of(new Alert("pumpkin_friends.notify.guestLeft", Optional.of("lAlex"), Optional.empty())),
			store.drain());
	}

	@Test
	void unknownNotifyEventsAndErrorCodesAreIgnored() {
		store.received(new Messages.Notify("somethingNew", "Alex", null));
		store.received(new Messages.ErrorReport("somethingNew", null));
		store.received(new Messages.ErrorReport(null, null));

		assertEquals(List.of(), store.drain());
	}

	@Test
	void confirmInLauncherShowsUntilTheSessionChanges() {
		store.received(snapshot(List.of(ALEX), null));
		store.received(new Messages.Notify("confirmInLauncher", null, null));
		store.drain();
		assertTrue(store.snapshot().awaitingConfirmation());

		store.received(snapshot(List.of(ALEX), null));
		store.drain();
		assertTrue(store.snapshot().awaitingConfirmation());

		store.received(snapshot(List.of(ALEX), new Messages.Session(List.of(new Messages.Guest("f1", "Alex", "invited")))));
		store.drain();
		assertFalse(store.snapshot().awaitingConfirmation());
	}

	@Test
	void anErrorEndsTheConfirmationHint() {
		store.received(new Messages.Notify("confirmInLauncher", null, null));
		store.received(new Messages.ErrorReport("denied", null));

		store.drain();

		assertFalse(store.snapshot().awaitingConfirmation());
	}

	@Test
	void disconnectClearsTheStateAndPendingMessages() {
		store.received(snapshot(List.of(ALEX), null));
		store.drain();
		store.received(new Messages.Notify("friendOnline", "Alex", null));

		store.disconnected();

		assertEquals(List.of(), store.drain());
		assertEquals(Snapshot.EMPTY, store.snapshot());
	}

	private static Messages.SnapshotUpdate snapshot(List<Messages.Friend> friends, Messages.Session session) {
		return new Messages.SnapshotUpdate(friends, session, List.of());
	}
}
