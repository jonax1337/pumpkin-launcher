package dev.laux.pumpkin.bridge.modules.friends.state;

/** An invite from a friend; joining is decided in the launcher or with {@code invite.joinHere}. */
public record Invite(String id, String fromName, String title) {
}
