# Pumpkin Bridge build reference

Build reference for the client-only Minecraft mod bundled with Pumpkin Launcher. The launcher injects the matching JAR at startup; users do not install it in an instance's `mods` folder. The general integration, module home, injection and local protocol contract live in [Pumpkin Bridge](../docs/bridge/README.md). Friends is the only currently implemented feature module.

Players should first [check the installed launcher's support and status](../docs/bridge/README.md#check-your-installed-build),
not infer packaged support from this source registry. For an automatically disabled
instance, see [the existing retry/off controls](../docs/bridge/README.md#startup-recovery).

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

## Targets and injection

[`nodes.txt`](nodes.txt) defines exact release/loader targets, loader minima, game JDK, Gradle JDK, injection strategy and retained compile ranges. A node produces one JAR. Its id is a Gradle project name, not a Minecraft version predicate; Stonecutter uses the separate Minecraft version. A `matrix` range is a compile target, not a wider runtime-support claim.

| Loader / era | Strategy |
|---|---|
| Fabric | `fabricAddMods` (`-Dfabric.addMods`) |
| Quilt | `quiltAddMods` (`-Dloader.addMods`) |
| Forge through the 1.20.2 targets | `fmlMavenRoot` |
| Forge 1.20.3+ targets | `forgeClasspath` |
| NeoForge through FML 9 | `fmlMavenRoot` |
| NeoForge FML 10+ | `fmlModFolders` |

Fabric and Quilt need no companion API. Pre-26.x Fabric-compatible JARs use Loom remapping and a refmap; 26.x uses Mojang names. Quilt development runs use Fabric, not the production Quilt loader.

[`verified.json`](verified.json) records production evidence consumed by packaging; registration or compilation alone does not establish runtime support. Authenticated sharing and joining are distinct from startup/menu evidence.

## Build and development

Run from `mod/`. The helper downloads checksum-verified Temurin JDKs into `.jdk/` without a system-wide installation.

```powershell
.\scripts\dev-env.ps1 -Node 1.21.1-neoforge
.\gradlew.bat -Pnode=1.21.1-neoforge build modIndex
```

```sh
. scripts/dev-env.sh 1.21.1-neoforge
./gradlew -Pnode=1.21.1-neoforge build modIndex
```

`-Pnode=<id>[,<id>]` limits configuration to selected nodes. Without it, Gradle configures all targets and needs JDK 25. The `java` and `gradleJdk` columns in `nodes.txt` are authoritative: Gradle requires at least Java 21, and Fabric/Quilt use 25. Game JVM and compile release follow the node, including Java 8 for 1.16.5. Toolchains are supplied through `PUMPKIN_JDK_<major>`; automatic download by Gradle is disabled.

`build` includes the Minecraft-free core tests. They require a JVM of at least 17, selected with `-Pcore.testJdk=<major>`; Java-8 game targets still need that separate test toolchain. An explicit development client is `./gradlew -Pnode=<id> :<id>:runClient`.

For a Java-8 game target, the helper also prepares its Gradle JDK; reuse that newer JDK for
core tests instead of trying to run JUnit on the game JVM. A complete 1.16.5 Forge example
from `mod/` is:

```powershell
.\scripts\dev-env.ps1 -Node 1.16.5-forge
.\gradlew.bat -Pnode=1.16.5-forge -Pcore.testJdk=21 build modIndex
```

```sh
. scripts/dev-env.sh 1.16.5-forge
./gradlew -Pnode=1.16.5-forge -Pcore.testJdk=21 build modIndex
```

This node uses Java 8 for the game and JDK 21 for Gradle/tests. Other legacy nodes can have
a different `gradleJdk`; select that prepared major (at least 17) for `core.testJdk`, or
provide another full JDK via `PUMPKIN_JDK_<major>`.

`modIndex` writes `build/mod-index/mod-index.json` and production JARs. It enforces the limits in `gradle.properties`: 320 KiB per JAR and 32 MiB aggregate. The mod version follows the launcher version; filenames are `pumpkin_bridge-<modVersion>+<node id>.jar`. [`index.schema.json`](index.schema.json) defines the index fields, including exact `minecraft` ids, `loaderMin`, `javaMin`, `strategy`, verification and SHA-256.

### GitHub Actions

Pushes to `main` and pull requests touching the mod run the layer/script checks and
representative `build modIndex` jobs. The matrix is derived from `nodes.txt`: first
and last rows for every loader, game JDK, Gradle JDK and injection strategy
combination (currently 34 nodes). This is a toolchain/strategy sample, not proof
that every Minecraft-era adapter compiles.

The full `Mod` workflow runs nightly at 01:17 UTC and on manual dispatch: all
102 builds, compile-range checks, Fabric kit demos and the validated aggregate
`mod-index` artifact. Fast runs upload only individual `mod-node-*` artifacts;
they never publish an incomplete aggregate as `mod-index`.
Production `Mod smoke` runs separately at 03:22 UTC or manually.
Dispatch both full workflows before merging broad compatibility changes.
Release builds retain the complete registry regardless of this CI sampling.


## Source layout

| Path | Purpose |
|---|---|
| `settings.gradle`, `stonecutter.gradle` | Node registration, Stonecutter controller and index tasks |
| `build-*.gradle`, `gradle/node.gradle` | Loader toolchains, descriptors, production archives and dependency pins |
| `versions/<node>/gradle.properties` | Per-node versions and compile-range overrides |
| `descriptors/` | Client-only loader metadata |
| `core/src/main/java/dev/laux/pumpkin/bridge/` | Java-8 transport, protocol, runtime, UI models and Friends state |
| `src/main/java/dev/laux/pumpkin/bridge/compat/` | Minecraft-era adapters |
| `src/main/java/dev/laux/pumpkin/bridge/platform/` | Loader entrypoints and shared bootstrap/menu hooks |
| `src/main/java/dev/laux/pumpkin/bridge/ui/` | Shared widgets and module home |
| `src/main/java/dev/laux/pumpkin/bridge/modules/friends/` | Friends screens and game adapters |
| [`fixtures/protocol/`](fixtures/protocol/) | Shared Rust/Java protocol fixtures |

`core/` imports no Minecraft or loader classes. Stonecutter conditionals and swaps belong only under `compat/` or `platform/`. New modules implement `BridgeModule` and register explicitly in `platform/shared/BridgeBootstrap`; there is no plugin discovery. Production archives include core classes but exclude development demos.

## Developer tools

These are optional tool references, not user acceptance tasks.

- `node scripts/validate-mod-index.mjs build/mod-index/mod-index.json`: index fields, JAR hashes and budgets.
- `node scripts/check-conditionals.mjs`: source-layer boundaries.
- `node scripts/compile-matrix.mjs --node <id>`: endpoints and a middle release of the node's `matrix`; `--only <release>` selects a release, `--plan` prints JSON without compiling. It uses `-Pcompile.minecraft=<release>` and the matching dependency pins.
- `node scripts/kit-demo.mjs --node <id>`: development UI demonstration. `PUMPKIN_DEV_DEMO_HOLD=true` keeps the screen open. Demos are not shipped.
- [`tools/mod-smoke`](../tools/mod-smoke/README.md): production injection harness using the launcher startup path.
- [`tools/mc-api-probe`](../tools/mc-api-probe/README.md): Minecraft member descriptors for compatibility work.

For a local protocol peer, run `java scripts/FakeLauncher.java` after preparing the JDK. It prints temporary IPC environment variables; paste them into a second terminal before starting `runClient`. It logs incoming/outgoing frames and accepts `allow`, `deny`, `invite`, `online`, `offline`, `error <code>`, `friends off`, `friends on` and `quit`. It simulates Friends state, not authenticated networking.

## Versions

Plugin and baseline library pins live in `gradle.properties`; settings plugins are pinned in
`settings.gradle`, Forge/NeoGradle plugins in the loader build scripts, and the Gradle
distribution and its SHA-256 in `gradle/wrapper/gradle-wrapper.properties`.
The following stable releases were checked against official metadata on 2026-10-07:

| Build/test dependency | Stable pin | Published metadata |
|---|---|---|
| Gradle distribution | 9.8.0 | [Gradle current release](https://services.gradle.org/versions/current) |
| Stonecutter | 0.9.8 | [KikuGie Maven](https://maven.kikugie.dev/releases/dev/kikugie/stonecutter/dev.kikugie.stonecutter.gradle.plugin/maven-metadata.xml) |
| Loom back-compat | 0.4.3 | [KikuGie Maven](https://maven.kikugie.dev/releases/dev/kikugie/loom-back-compat/dev.kikugie.loom-back-compat.gradle.plugin/maven-metadata.xml) |
| Fabric Loom | 1.18.2 | [Fabric Maven](https://maven.fabricmc.net/net/fabricmc/fabric-loom/maven-metadata.xml) |
| ModDevGradle | 2.0.148 | [NeoForged Maven](https://maven.neoforged.net/releases/net/neoforged/moddev/net.neoforged.moddev.gradle.plugin/maven-metadata.xml) |
| Unimined | 1.4.1 | [WagYourTail Maven](https://maven.wagyourtail.xyz/releases/xyz/wagyourtail/unimined/xyz.wagyourtail.unimined.gradle.plugin/maven-metadata.xml) |
| ForgeGradle | 7.0.40 | [Forge Maven](https://maven.minecraftforge.net/net/minecraftforge/gradle/net.minecraftforge.gradle.gradle.plugin/maven-metadata.xml) |
| Renamer Gradle plugin | 1.1.1 | [Forge implementation metadata](https://maven.minecraftforge.net/net/minecraftforge/renamer-gradle/maven-metadata.xml) |
| Renamer bytecode tool | 2.2.3 | [Forge tool metadata](https://maven.minecraftforge.net/net/minecraftforge/renamer/maven-metadata.xml) |
| NeoGradle userdev | 7.1.39 | [NeoForged Maven](https://maven.neoforged.net/releases/net/neoforged/gradle/userdev/net.neoforged.gradle.userdev.gradle.plugin/maven-metadata.xml) |
| Mixin annotation processor | 0.8.7 | [Sponge Maven](https://repo.spongepowered.org/repository/maven-releases/org/spongepowered/mixin/maven-metadata.xml) |
| JUnit BOM / Jupiter / Platform | 6.1.3 | [Maven Central](https://repo.maven.apache.org/maven2/org/junit/junit-bom/maven-metadata.xml) |

Renamer 1.1.1 has a published `net.minecraftforge:renamer-gradle` implementation, but
its Gradle plugin marker POM is missing from Forge Maven. `pluginManagement` maps the
plugin request directly to that implementation; the requested version remains authoritative.
The plugin also defaults to unpublished Renamer tool 2.2.1; `renameJar` uses its
public `using` API to select the latest published tool, `net.minecraftforge:renamer:2.2.3:all@jar`.
Artifact-only notation keeps the shaded executable JAR as the sole classpath entry,
so its manifest supplies `net.minecraftforge.renamer.Main` without redundant dependencies.

For SRG Forge nodes (1.20.2–1.20.4), `renameJar` runs Renamer on the node's
game JDK, already prepared by `dev-env.*`. Renamer's Java 8 tool default is a
minimum, not an additional JDK installation requirement: the task explicitly
selects the node launcher instead of requesting Java 8. This does not change
the production core's `--release 8` bytecode or enable automatic JDK downloads.

JUnit 6.1.3 is published: both its
[BOM POM](https://repo.maven.apache.org/maven2/org/junit/junit-bom/6.1.3/junit-bom-6.1.3.pom)
and [Gradle module metadata](https://repo.maven.apache.org/maven2/org/junit/junit-bom/6.1.3/junit-bom-6.1.3.module)
were available at the check above. It is test-only and requires Java 17 or newer.
To exercise dependency resolution and the previously affected Forge node with fresh
dependency metadata, run from `mod/`:

```powershell
.\scripts\dev-env.ps1 -Node 1.21.9-forge
.\gradlew.bat --refresh-dependencies "-Pnode=1.21.9-forge" "-Pcore.testJdk=25" build modIndex
```

```sh
. scripts/dev-env.sh 1.21.9-forge
./gradlew --refresh-dependencies -Pnode=1.21.9-forge -Pcore.testJdk=25 build modIndex
```

The helper reuses existing `.jdk/21` and `.jdk/25` installations for this node.
A Maven lookup failure is not evidence that a lower JUnit version is required;
check the actual artifact endpoint before changing a published pin.

Compatibility exceptions are deliberate: the core compiles and tests against game-supplied
Gson 2.8.0 and Log4j API 2.8.1, the Minecraft 1.16.5 baseline, without bundling either
library or a logging backend. Older games use the launcher's patched Log4j runtime.
Upgrading those compile APIs would permit calls unavailable in the oldest supported game.
Node-specific Minecraft and loader pins in `versions/<node>/gradle.properties` retain
their separate release targets and compile-range overrides; they are not interchangeable
with a single newest game/loader release. Gradle configuration cache remains disabled
because Unimined retains Gradle objects and starts setup processes during configuration.

Related documentation: [Bridge integration and local protocol](../docs/bridge/README.md), [Minecraft API reference](../docs/bridge/MINECRAFT-API.md), [Friends contract](../docs/friends/SPEC.md), [release packaging](../CONTRIBUTING.md#release-packaging).
