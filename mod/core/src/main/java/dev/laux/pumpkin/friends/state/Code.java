package dev.laux.pumpkin.friends.state;

/** A friend code the player created; only its last characters are known here, {@code expiresAt} is Unix seconds. */
public record Code(String id, String tail, long expiresAt, boolean used) {
}
