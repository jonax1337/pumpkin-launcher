package dev.laux.pumpkin.friends.ui.hub;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.compat.Connect;
import dev.laux.pumpkin.friends.compat.Disconnect;
import dev.laux.pumpkin.friends.compat.GameScreens;
import dev.laux.pumpkin.friends.compat.Text;
import dev.laux.pumpkin.friends.compat.Toasts;
import dev.laux.pumpkin.friends.json.WireNames;
import dev.laux.pumpkin.friends.request.Ops;
import dev.laux.pumpkin.friends.request.Reply;
import dev.laux.pumpkin.friends.request.Reply.Success;
import dev.laux.pumpkin.friends.request.Results.JoinHere;
import dev.laux.pumpkin.friends.runtime.MainThread;
import dev.laux.pumpkin.friends.ui.UiSession;
import dev.laux.pumpkin.friends.ui.model.JoinHereFlow;
import net.minecraft.client.gui.screens.ConfirmScreen;
import net.minecraft.network.chat.Component;

/**
 * Runs one join from the running game (INGAME 7): {@code invite.joinHere} asks the launcher, the pure {@link JoinHereFlow}
 * decides what happens next and this runner does it - the confirmation ("Welt verlassen und beitreten?"), leaving the
 * world, connecting to the validated loopback address, and the report back ({@code join.failed}) after a refused address,
 * a disconnect or thirty seconds without {@code connected}. A daemon thread ticks the machine through the main thread,
 * because the flow must keep running while the game shows its own connecting screens. One flow at a time (INGAME 7).
 */
public final class JoinHereRunner {
	private static final long POLL_MILLIS = 250;
	private static final long NANOS_PER_MILLI = 1_000_000;

	private static JoinHereRunner running;

	private final BridgeClient client;
	private final MainThread mainThread;
	private final JoinHereFlow flow = new JoinHereFlow();

	/** Starts the flow for {@code inviteId}; a flow that is still waiting, confirming or connecting cannot be displaced. */
	public static void begin(BridgeClient client, MainThread mainThread, String inviteId) {
		if (running != null && running.flow.busy()) {
			return;
		}
		running = new JoinHereRunner(client, mainThread);
		running.request(inviteId);
	}

	private JoinHereRunner(BridgeClient client, MainThread mainThread) {
		this.client = client;
		this.mainThread = mainThread;
	}

	private void request(String inviteId) {
		startTicker();
		client.request(Ops.inviteJoinHere(inviteId)).reply().thenAccept(this::onAnswer);
	}

	private void onAnswer(Reply<JoinHere> reply) {
		reply.error().ifPresent(Toasts::showError);
		if (reply instanceof Success<JoinHere> success) {
			UiSession.run(() -> run(flow.answered(success.value().host(), success.value().port())));
		}
	}

	/**
	 * INGAME-API.md 3, "Pause menu, title screen, other screens": {@code ConfirmScreen#<init>(BooleanConsumer, Component,
	 * Component, Component, Component)} exists in every era. The buttons' answer is routed through the flow machine.
	 */
	private void run(JoinHereFlow.Step step) {
		switch (step) {
			case CONFIRM -> GameScreens.show(new ConfirmScreen(this::onConfirmed,
				Component.translatable("pumpkin_friends.join.confirm.title"),
				Component.translatable("pumpkin_friends.join.confirm.message"),
				Component.translatable("pumpkin_friends.join.confirm.yes"),
				Component.translatable("pumpkin_friends.join.confirm.no")));
			case LEAVE_AND_CONNECT -> {
				Disconnect.leaveWorld();
				Connect.toLoopback(GameScreens.current(), flow.host(), flow.port());
			}
			case CANCEL_JOIN -> client.request(Ops.joinLeave());
			case FAIL -> fail();
			case NONE -> {
			}
		}
	}

	private void onConfirmed(boolean chosen) {
		UiSession.run(() -> run(chosen ? flow.confirmed(now()) : flow.declined()));
	}

	private void fail() {
		Toasts.showSystem(Text.translate("pumpkin_friends.join.failed." + WireNames.of(flow.failure())));
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
