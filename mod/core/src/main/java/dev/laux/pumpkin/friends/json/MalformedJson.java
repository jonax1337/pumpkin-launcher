package dev.laux.pumpkin.friends.json;

/** A line or value from the launcher does not have the shape the protocol promises. The channel is untrusted: such input is dropped. */
public final class MalformedJson extends RuntimeException {
	private static final long serialVersionUID = 1L;

	public MalformedJson(String message) {
		super(message);
	}
}
