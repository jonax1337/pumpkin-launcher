package dev.laux.pumpkin.friends.ui.hub;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.request.Op;
import dev.laux.pumpkin.friends.request.Reply;
import dev.laux.pumpkin.friends.state.TopicStore;
import java.util.concurrent.CompletableFuture;

/** What the Teilen tab needs from the link: the topics to read and the way to ask the launcher. */
public interface ShareLink {
	TopicStore topics();

	/** Sends the operation; the answer completes on the main thread, like every answer of the bridge. */
	<T> CompletableFuture<Reply<T>> ask(Op<T> op);

	/** The tab's view of a live link. */
	static ShareLink to(BridgeClient client) {
		return new ShareLink() {
			@Override
			public TopicStore topics() {
				return client.topics();
			}

			@Override
			public <T> CompletableFuture<Reply<T>> ask(Op<T> op) {
				return client.request(op).reply();
			}
		};
	}
}
