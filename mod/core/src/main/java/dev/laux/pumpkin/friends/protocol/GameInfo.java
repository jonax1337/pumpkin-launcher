package dev.laux.pumpkin.friends.protocol;

/** Diagnostics for the {@code hello}; the launcher knows the truth and only logs a mismatch. */
public record GameInfo(String minecraft, String loader, String loaderVersion, int java) {
}
