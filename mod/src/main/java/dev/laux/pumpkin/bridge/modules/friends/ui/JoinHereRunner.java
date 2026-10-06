package dev.laux.pumpkin.bridge.modules.friends.ui;

import dev.laux.pumpkin.bridge.modules.friends.FriendsClient;
import dev.laux.pumpkin.bridge.compat.Connect;
import dev.laux.pumpkin.bridge.compat.Disconnect;
import dev.laux.pumpkin.bridge.compat.GameScreens;
import dev.laux.pumpkin.bridge.compat.Text;
import dev.laux.pumpkin.bridge.compat.Toasts;
import dev.laux.pumpkin.bridge.protocol.json.WireNames;
import dev.laux.pumpkin.bridge.modules.friends.protocol.Ops;
import dev.laux.pumpkin.bridge.transport.request.Reply;
import dev.laux.pumpkin.bridge.transport.request.Reply.Success;
import dev.laux.pumpkin.bridge.modules.friends.protocol.Results.JoinHere;
import dev.laux.pumpkin.bridge.runtime.MainThread;
import dev.laux.pumpkin.bridge.ui.UiSession;
import dev.laux.pumpkin.bridge.modules.friends.ui.model.JoinHereFlow;
import net.minecraft.client.gui.screens.ConfirmScreen;

/**
 * Runs one join from the running game (docs/bridge/README.md, "In-game navigation and world behavior"): {@code invite.joinHere} asks the launcher, the pure {@link JoinHereFlow}
 * decides what happens next and this runner does it - the confirmation ("Welt verlassen und beitreten?"), leaving the
 * world, connecting to the validated loopback address, and the report back ({@code join.failed}) after a refused address,
 * a disconnect or thirty seconds without {@code connected}. A daemon thread ticks the machine through the main thread,
 * because the flow must keep running while the game shows its own connecting screens. One flow at a time (docs/bridge/README.md, "In-game navigation and world behavior").
 */
public final class JoinHereRunner {
	private static final long POLL_MILLIS = 250;
	private static final long NANOS_PER_MILLI = 1_000_000;

	private static JoinHereRunner running;

	private final FriendsClient client;
	private final MainThread mainThread;
	private final JoinHereFlow flow = new JoinHereFlow();

	/** Starts the flow for {@code inviteId}; a flow that is still waiting, confirming or connecting cannot be displaced. */
	public static void begin(FriendsClient client, MainThread mainThread, String inviteId) {
		if (running != null && running.flow.busy()) {
			return;
		}
		running = new JoinHereRunner(client, mainThread);
		running.request(inviteId);
	}

	private JoinHereRunner(FriendsClient client, MainThread mainThread) {
		this.client = client;
		this.mainThread = mainThread;
	}

	private void request(String inviteId) {
		startTicker();
		client.request(Ops.inviteJoinHere(inviteId)).reply().thenAccept(this::onAnswer);
	}

	private void onAnswer(Reply<JoinHere> reply) {
		if (reply.error().isPresent()) {
			flow.abandoned();
			Toasts.showError(reply.error().get());
			return;
		}
		if (reply instanceof Success<?>) {
			Success<JoinHere> success = (Success<JoinHere>) reply;
			UiSession.run(() -> run(flow.answered(success.value().host(), success.value().port())));
		}
	}

	/**
	 * docs/bridge/MINECRAFT-API.md, "Pause menu, title screen, other screens": {@code ConfirmScreen#<init>(BooleanConsumer, Component,
	 * Component, Component, Component)} exists in every era. The buttons' answer is routed through the flow machine.
	 */
	private void run(JoinHereFlow.Step step) {
		switch (step) {
			case CONFIRM:
				GameScreens.show(new ConfirmScreen(this::onConfirmed,
				Text.component("pumpkin_bridge.join.confirm.title"),
				Text.component("pumpkin_bridge.join.confirm.message"),
				Text.component("pumpkin_bridge.join.confirm.yes"),
				Text.component("pumpkin_bridge.join.confirm.no")));
				break;
			case LEAVE_AND_CONNECT: {
				Disconnect.leaveWorld();
				Connect.toLoopback(GameScreens.current(), flow.host(), flow.port());
				break;
			}
			case CANCEL_JOIN:
				client.request(Ops.joinLeave());
				break;
			case FAIL:
				fail();
				break;
			case NONE: {
				break;
			}
		}
	}

	private void onConfirmed(boolean chosen) {
		UiSession.run(() -> run(chosen ? flow.confirmed(now()) : flow.declined()));
	}

	private void fail() {
		Toasts.showSystem(Text.translate("pumpkin_bridge.join.failed." + WireNames.of(flow.failure())));
		client.request(Ops.joinFailed());
	}

	/** Drives the deadline and watches the join topic until the flow ends; the topic is read on the main thread only. */
	private void startTicker() {
		Thread ticker = new Thread(this::tickUntilEnded, "pumpkin-join-here");
		ticker.setDaemon(true);
		ticker.start();
	}

	private void tickUntilEnded() {
		try {
			while (flow.busy()) {
				Thread.sleep(POLL_MILLIS);
				mainThread.execute(() -> UiSession.run(() -> {
					run(flow.tick(now()));
					run(flow.joinTopic(client.topics().join()));
				}));
			}
		} catch (InterruptedException ended) {
			Thread.currentThread().interrupt();
		}
	}

	private static long now() {
		return System.nanoTime() / NANOS_PER_MILLI;
	}
}
