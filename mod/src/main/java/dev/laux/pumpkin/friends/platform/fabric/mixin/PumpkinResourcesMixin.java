package dev.laux.pumpkin.friends.platform.fabric.mixin;

import dev.laux.pumpkin.friends.ui.UiSession;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import net.fabricmc.loader.api.FabricLoader;
//? if >=1.21.11 {
import net.minecraft.resources.Identifier;
import net.minecraft.util.FileUtil;
//?} else {
/*import net.minecraft.resources.ResourceLocation;
import net.minecraft.FileUtil;
*///?}
//? if >=26.3 {
import net.minecraft.server.packs.FixedPathPackResources;
//?} else {
/*import net.minecraft.server.packs.VanillaPackResources;
*///?}
import net.minecraft.server.packs.PackResources;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.PathPackResources;
import net.minecraft.server.packs.resources.IoSupplier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Fabric Loader alone does not expose mod assets to Minecraft; keep our namespace in the base resource layer. */
//? if >=26.3 {
@Mixin(FixedPathPackResources.class)
//?} else {
/*@Mixin(VanillaPackResources.class)
*///?}
public abstract class PumpkinResourcesMixin {
	@Unique
	private static final String PUMPKIN_NAMESPACE = "pumpkin_friends";

	@Unique
	private static Optional<Path> pumpkinAssets() {
		return FabricLoader.getInstance().getModContainer(PUMPKIN_NAMESPACE)
			.flatMap(mod -> mod.findPath("assets/" + PUMPKIN_NAMESPACE));
	}

	@Inject(method = "getNamespaces", at = @At("RETURN"), cancellable = true, require = 0)
	private void pumpkinNamespaces(PackType type, CallbackInfoReturnable<Set<String>> callback) {
		if (type != PackType.CLIENT_RESOURCES) {
			return;
		}
		UiSession.run(() -> {
			if (pumpkinAssets().isPresent()) {
				Set<String> namespaces = new HashSet<>(callback.getReturnValue());
				namespaces.add(PUMPKIN_NAMESPACE);
				callback.setReturnValue(namespaces);
			}
		});
	}

	@Inject(method = "getResource", at = @At("HEAD"), cancellable = true, require = 0)
	//? if >=1.21.11 {
	private void pumpkinResource(PackType type, Identifier location,
	//?} else {
	/*private void pumpkinResource(PackType type, ResourceLocation location,
	*///?}
		CallbackInfoReturnable<IoSupplier<InputStream>> callback) {
		if (type != PackType.CLIENT_RESOURCES || !PUMPKIN_NAMESPACE.equals(location.getNamespace())) {
			return;
		}
		UiSession.run(() -> pumpkinAssets().ifPresent(root -> {
			Path file = root.resolve(location.getPath()).normalize();
			if (file.startsWith(root.normalize()) && Files.isRegularFile(file)) {
				callback.setReturnValue(IoSupplier.create(file));
			}
		}));
	}

	@Inject(method = "listResources", at = @At("HEAD"), cancellable = true, require = 0)
	private void pumpkinList(PackType type, String namespace, String prefix, PackResources.ResourceOutput output,
		CallbackInfo callback) {
		if (type != PackType.CLIENT_RESOURCES || !PUMPKIN_NAMESPACE.equals(namespace)) {
			return;
		}
		UiSession.run(() -> {
			Optional<List<String>> segments = prefix.isEmpty() ? Optional.of(List.of())
				: FileUtil.decomposePath(prefix).result();
			segments.ifPresent(path -> pumpkinAssets().ifPresent(root ->
				PathPackResources.listPath(namespace, root, path, output)));
			callback.cancel();
		});
	}
}
