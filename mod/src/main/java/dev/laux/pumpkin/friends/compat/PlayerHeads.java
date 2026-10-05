package dev.laux.pumpkin.friends.compat;

import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import dev.laux.pumpkin.friends.ui.model.Rect;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.Minecraft;
import net.minecraft.client.resources.DefaultPlayerSkin;
//? if >=26.1 {
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.PlayerFaceExtractor;
//?} else {
/*import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.PlayerFaceRenderer;
*///?}
//? if >=1.21.9 {
import net.minecraft.client.renderer.PlayerSkinRenderCache;
import net.minecraft.world.entity.player.PlayerSkin;
import net.minecraft.world.item.component.ResolvableProfile;
//?} else if >=1.20.2 {
/*import net.minecraft.Util;
import net.minecraft.client.resources.PlayerSkin;
*///?} else {
/*import com.mojang.authlib.GameProfile;
import com.mojang.authlib.minecraft.MinecraftProfileTexture;
import net.minecraft.Util;
import net.minecraft.resources.ResourceLocation;
*///?}
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Native profile/skin lookups outlive per-frame painters, without owning or downloading textures ourselves. */
final class PlayerHeads {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_friends");
	private static final int MAX_CACHED_HEADS = 512;
	private static final Duration CACHE_LIFETIME = Duration.ofMinutes(30);
	private static final Cache<String, Head> KNOWN_HEADS = newCache();
	private static final Cache<String, Head> DEFAULT_HEADS = newCache();

	private PlayerHeads() {
	}

	private static Cache<String, Head> newCache() {
		return CacheBuilder.newBuilder().maximumSize(MAX_CACHED_HEADS)
			.expireAfterWrite(CACHE_LIFETIME).build();
	}

	//? if >=26.1 {
	static void draw(GuiGraphicsExtractor graphics, String name, Optional<String> uuid, Rect bounds) {
	//?} else {
	/*static void draw(GuiGraphics graphics, String name, Optional<String> uuid, Rect bounds) {
	*///?}
		int size = Math.min(bounds.width(), bounds.height());
		if (size <= 0) return;
		//? if >=1.20.2 {
		PlayerSkin skin = cachedHead(name, uuid).skin();
		//?} else {
		/*ResourceLocation skin = cachedHead(name, uuid).skin();
		*///?}
		int x = bounds.x() + (bounds.width() - size) / 2;
		int y = bounds.y() + (bounds.height() - size) / 2;
		// Vanilla draws the face at (8,8) and hat at (40,8), preserving the caller's scissor.
		//? if >=26.1 {
		PlayerFaceExtractor.extractRenderState(graphics, skin, x, y, size);
		//?} else {
		/*PlayerFaceRenderer.draw(graphics, skin, x, y, size);
		*///?}
	}

	private static Head cachedHead(String name, Optional<String> uuid) {
		Cache<String, Head> cache = uuid.isPresent() ? KNOWN_HEADS : DEFAULT_HEADS;
		String key = uuid.orElse(name);
		Head head = cache.getIfPresent(key);
		if (head != null) return head;
		head = uuid.isPresent() ? resolveHead(parseUuid(key)) : defaultHead(name);
		cache.put(key, head);
		return head;
	}

	private static Head defaultHead(String name) {
		// A display name need not be a Minecraft account; never disclose it through a name lookup.
		UUID offlineId = UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8));
		//? if >=1.20.2 {
		PlayerSkin skin = DefaultPlayerSkin.get(offlineId);
		//?} else {
		/*ResourceLocation skin = DefaultPlayerSkin.getDefaultSkin(offlineId);
		*///?}
		return new Head(skin, CompletableFuture.completedFuture(skin));
	}

	private static Head resolveHead(UUID uuid) {
		Minecraft minecraft = Minecraft.getInstance();
		//? if >=1.20.2 {
		PlayerSkin fallback = DefaultPlayerSkin.get(uuid);
		//?} else {
		/*ResourceLocation fallback = DefaultPlayerSkin.getDefaultSkin(uuid);
		*///?}
		//? if >=1.21.9 {
		CompletableFuture<PlayerSkin> pending = minecraft.playerSkinRenderCache()
			.lookup(ResolvableProfile.createUnresolved(uuid))
			.thenApply(info -> info.map(PlayerSkinRenderCache.RenderInfo::playerSkin).orElse(fallback));
		//?} else if >=1.21.4 {
		/*CompletableFuture<PlayerSkin> pending = CompletableFuture.supplyAsync(
			() -> minecraft.getMinecraftSessionService().fetchProfile(uuid, true), Util.backgroundExecutor())
			.thenComposeAsync(result -> result == null ? CompletableFuture.completedFuture(Optional.<PlayerSkin>empty())
				: minecraft.getSkinManager().getOrLoad(result.profile()), minecraft)
			.thenApply(skin -> skin.orElse(fallback));
		*///?} else if >=1.20.2 {
		/*// SkinManager only unpacks profile properties: fetching the native profile first is essential.
		CompletableFuture<PlayerSkin> pending = CompletableFuture.supplyAsync(
			() -> minecraft.getMinecraftSessionService().fetchProfile(uuid, true), Util.backgroundExecutor())
			.thenComposeAsync(result -> result == null ? CompletableFuture.completedFuture(fallback)
				: minecraft.getSkinManager().getOrLoad(result.profile()), minecraft);
		*///?} else {
		/*CompletableFuture<ResourceLocation> pending = CompletableFuture.supplyAsync(
			() -> minecraft.getMinecraftSessionService().fillProfileProperties(new GameProfile(uuid, ""), true),
			Util.backgroundExecutor())
			.thenComposeAsync(profile -> registerLegacySkin(minecraft, profile, fallback), minecraft);
		*///?}
		return new Head(fallback, pending.exceptionally(error -> {
			LOG.warn("Minecraft player skin unavailable; using the default skin ({})", error.getClass().getSimpleName());
			return fallback;
		}));
	}

	//? if <1.20.2 {
	/*private static CompletableFuture<ResourceLocation> registerLegacySkin(
			Minecraft minecraft, GameProfile profile, ResourceLocation fallback) {
		if (profile == null || !minecraft.getSkinManager().getInsecureSkinInformation(profile)
				.containsKey(MinecraftProfileTexture.Type.SKIN)) {
			return CompletableFuture.completedFuture(fallback);
		}
		CompletableFuture<ResourceLocation> skin = new CompletableFuture<>();
		minecraft.getSkinManager().registerSkins(profile, (type, location, texture) -> {
			if (type == MinecraftProfileTexture.Type.SKIN) skin.complete(location);
		}, true);
		return skin;
	}
	*///?}

	/** The protocol supplies 32 lowercase hex digits; dashed UUIDs are also accepted by Painter callers. */
	private static UUID parseUuid(String uuid) {
		if (uuid.length() == 36) return UUID.fromString(uuid);
		return new UUID(Long.parseUnsignedLong(uuid.substring(0, 16), 16),
			Long.parseUnsignedLong(uuid.substring(16), 16));
	}

	//? if >=1.20.2 {
	private record Head(PlayerSkin fallback, CompletableFuture<PlayerSkin> resolved) {
		PlayerSkin skin() {
	//?} else {
	/*private record Head(ResourceLocation fallback, CompletableFuture<ResourceLocation> resolved) {
		ResourceLocation skin() {
	*///?}
			return resolved.getNow(fallback);
		}
	}
}
