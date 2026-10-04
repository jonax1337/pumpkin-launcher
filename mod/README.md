# Pumpkin Friends (in-game mod)

Client-only mod that connects the game to the Pumpkin Launcher's Friends feature
(`docs/friends/SPEC.md`, sections 7 and 11; the multi-node design is `docs/friends/INGAME.md`).
From the pause menu it shows your friends, opens the singleplayer world to LAN, invites online
friends, lists guests (with "Entfernen"), stops sharing, and shows received invites.
Notifications appear as toasts.

Without the launcher the mod does nothing: if the game was not started by the launcher with
Friends enabled, it writes one log line and starts no thread and no UI. The launcher treats
everything the mod sends as untrusted, and the first share of every game start must be confirmed
in the launcher.

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

## Nodes

One **node** is one build target `<minecraft>-<loader>` that produces exactly one jar. The list is
`nodes.txt`, the only place that names nodes, their JDK and their injection strategy.

| Node | Loader | Game JDK | Gradle JDK | Strategy | Claims (`mod-index.json`) | Compile matrix | State |
|---|---|---|---|---|---|---|---|
| `26.3-fabric` | Fabric Loader >= 0.19.5 (not obfuscated) | 25 | 25 | `fabricAddMods` | 26.3 | 26.3 | the full mod on the widget kit (package U1) |
| `1.21.1-fabric` | Fabric Loader >= 0.15.11 (**obfuscated**, remapped jar) | 21 | 25 | `fabricAddMods` | 1.21.1 | 1.20.5, 1.20.6, 1.21, 1.21.1 | the full mod on the widget kit (was the Fabric tracer until U1) |
| `1.21.8-fabric` | Fabric Loader >= 0.16.13 (**obfuscated**, remapped jar) | 21 | 25 | `fabricAddMods` | 1.21.8 | 1.21.6, 1.21.7, 1.21.8 | the full mod on the widget kit (package U1) |
| `1.21.11-fabric` | Fabric Loader >= 0.17.3 (**obfuscated**, remapped jar) | 21 | 25 | `fabricAddMods` | 1.21.11 | 1.21.11 | the full mod on the widget kit (package U1) |
| `1.21.1-neoforge` | NeoForge >= 21.1.0 | 21 | 21 | `fmlMavenRoot` | 1.21.1 | 1.21, 1.21.1 | **tracer**: logs `pumpkin_friends tracer 1.21.1 neoforge`, nothing else |
| `26.2-neoforge` | NeoForge >= 26.2.0.57 | 25 | 25 | `fmlModFolders` | 26.2 | 26.2 | **tracer**: logs `pumpkin_friends tracer 26.2 neoforge`, nothing else |
| `1.20.1-forge` | Forge >= 47.4.0 | 17 | 21 | `fmlMavenRoot` | 1.20.1 | 1.20.1 | **tracer**: logs `pumpkin_friends tracer 1.20.1 forge`, nothing else |

The tracers only prove the build topology and the injection mechanisms (INGAME 11.2, spike S1):
`26.2-neoforge` is the only node on which `-Dfml.modFolders` (FML 10 and newer) can be proven. Until package U1
`1.21.1-fabric` was the Fabric tracer and the only node that proved the Loom-remapped jar of amendment A4 with a
Mixin; the four Fabric nodes now carry the full mod, and the Mixin that proves A4 comes with the pause-menu hook
(the tracer's Mixin sources and `descriptors/fabric-tracer/` are no longer used by any node). All four remap from
Mojang names to intermediary names the same way (`loomx.unobfuscated=false`, `remapJar`), except `26.3-fabric`.
`verified` is `null` for every node in `mod-index.json`: no smoke test has released a cell yet, so the launcher
injects nothing.

**Claims versus the compile matrix.** A node id carries the highest release it serves
(`1.21.1-fabric` serves 1.20.5 to 1.21.1 according to `docs/friends/INGAME-API.md` section 5), but
`mod-index.json` claims only what the node was built against (`minecraft` column of `nodes.txt`). The
`matrix` column lists everything the node is meant to serve; widening the claim is a later step, after the
matrix and a smoke test have proven the rest. The Fabric tracer's Mixin line is the one exception to "one
line, nothing else": a Mixin that applies from a non-development jar is what amendment A4 is about.

## Versions

Pins checked against the Maven metadata on 2026-10-03 (spike S1). Every row resolved and built.

| Item | Version | Where it was checked |
|---|---|---|
| Gradle wrapper | 9.7.1 (SHA-256 pinned) | works with every plugin below |
| JDK that runs Gradle | **21 or newer** (amendment A5); **25 for Fabric nodes** | Stonecutter 0.9.8 refuses a Java 17 JVM: `Dependency requires at least JVM runtime version 21`. Fabric Loom 1.18.2 refuses a Java 21 JVM for both plugin ids (`Dependency requires at least JVM runtime version 25`), so even the obfuscated `1.21.1-fabric` is configured on Gradle with JDK 25 (`gradleJdk` column) |
| Stonecutter | 0.9.8 (release; 0.10 is alpha) | `maven.kikugie.dev/releases`, plugin id `dev.kikugie.stonecutter` |
| Fabric Loom | 1.18.2, plugin ids `net.fabricmc.fabric-loom` (no remap, Minecraft >= 26.1) and `net.fabricmc.fabric-loom-remap` (older) | `maven.fabricmc.net` |
| loom-back-compat | 0.4.3 (the Stonecutter wiki shows 0.4.2), plugin id `dev.kikugie.loom-back-compat` | `maven.kikugie.dev/releases`; **in use** since `1.21.1-fabric`: it applies the remapping or the non-remapping Loom per node (`loomx.unobfuscated` in `versions/<node>/gradle.properties`) and gives both the same `modImplementation` and `loomx.modJar` (= `remapJar` or `jar`). `settings.gradle` applies it, and a `beforeProject` hook there hands the Loom version (`loom_version` in `gradle.properties`) to the root project, but only when a Fabric node is selected: the plugin reads it from a project extra property, not from `gradle.properties`, and Loom on the class path would demand JDK 25 for NeoForge and Forge builds too |
| ModDevGradle | 2.0.148, plugin ids `net.neoforged.moddev` and `net.neoforged.moddev.legacyforge` | Gradle plugin portal. `net.neoforged.moddev.legacy` does not exist |
| NeoForge (dev) | 21.1.172 (21.1.253 is the newest 21.1.x), 21.0.167 (matrix end 1.21), 26.2.0.88 (`26.2-neoforge`) | NeoForged Maven, `userdev` artifact; 26.2.0.88 resolved and built |
| Forge (dev) | 1.20.1-47.4.10 (recommended; 47.4.26 is latest) | Forge Maven and `promotions_slim.json` |
| Fabric Loader (dev) | 0.19.5 (every Fabric node) | `maven.fabricmc.net`. **No Fabric API** (INGAME 4.2, decision 3): the mod depends on the loader only, so it also loads on instances without Fabric API; the entry point `ClientModInitializer` belongs to the loader |
| JUnit | 6.1.3 | Maven Central |
| Gson / SLF4J (compile only) | 2.10.1 / 2.0.17 | the game supplies both; the versions are those of Minecraft 1.20.1 |

The plugin versions live in `gradle.properties` (`loom_version`, `moddev_version`), the dependency
versions of a node in `versions/<node>/gradle.properties`.

## Layout

```
nodes.txt                  the node list (id, loader, claimed minecraft ids, loader minimum, JDK, strategy, Gradle JDK, matrix)
settings.gradle            reads nodes.txt, builds the Stonecutter tree, honours -Pnode=<id>[,<id>] and -Pcompile.minecraft=<release>
stonecutter.gradle         controller: modIndex and checkJarBudget tasks
build-fabric.gradle        build script per loader (Loom / ModDevGradle / ModDevGradle legacyforge)
build-neoforge.gradle
build-forge.gradle
gradle/node.gradle         the part every node shares (release, jar contents, descriptor, index entry, pinned(), swaps)
versions/<node>/           per-node gradle.properties (dependency versions, Loom variant, tracer flag); build and run output is ignored
descriptors/<loader>/      fabric.mod.json, META-INF/neoforge.mods.toml, META-INF/mods.toml + pack.mcmeta
descriptors/<loader>-tracer/  extra files of the tracer nodes of that loader (the Fabric tracer's Mixin configuration)
core/                      Minecraft-free Java (--release 17): bridge client, state store, sanitiser + all JUnit tests
core/src/main/java/.../ui/model/   Minecraft-free layout (package U1): Rect, HubLayout, TabBarModel, ScrollModel, Fit, RowLayout, StateKeeper, Painter
src/main/java/.../
  compat/                  everything that differs between Minecraft versions (screens, painter, widgets, LAN, toasts, connect, leave world)
  platform/<loader>/       one thin entry class per loader (Fabric: entry point + pause-menu hook; tracers)
  ui/kit/                  PumpkinScreen, ScrollPane, TabBar, Row: the widget kit; no version conditionals
  ui/demo/                 the kit demo screen (dev only, see "Widget kit"); ui/FriendsScreen runs on the kit
src/main/resources/        language files and icon, shared by all nodes
scripts/                   dev-env.sh/.ps1, check-conditionals.mjs, validate-mod-index.mjs, compile-matrix.mjs, kit-demo.mjs, FakeLauncher.java
```

Layer rules (checked by `scripts/check-conditionals.mjs`, run in the workflow):
1. Stonecutter conditionals (`//? if ...`, `/*? ... */`) and swaps (`//$ name`) appear only below a `compat/` or `platform/` folder.
2. `core/` imports no Minecraft, Mojang or loader class. The compiler enforces the same, because `core/` is its own Gradle project without a game on its class path.

Every node jar holds the node's own classes plus the compiled classes of `core/`. A node excludes the
source folders it cannot compile (`build-<loader>.gradle`): Fabric drops the other loaders'
`platform/` folders, the tracers also drop `compat/` and `ui/`.

Client-only declaration (amendment A3): Fabric `"environment": "client"`, NeoForge `@Mod(dist = Dist.CLIENT)`, Forge 1.20.1
`clientSideOnly = true` at the top level of `mods.toml` (not `displayTest = IGNORE_SERVER_VERSION`, which is the constant for server-only mods).

### What had to change in `core/` (the move was `git mv`, behaviour is unchanged)

`core/` compiles with `--release 17`, the old code was built for Java 25. Three spots used newer APIs:
- `BridgeClient.dispatch` and `StateStore.apply`: pattern-matching `switch` (Java 21) became `instanceof` chains with the same order and the same results.
- `BridgeClient.Timing.production()`: `Thread::sleep` taking a `Duration` (Java 19) became `pause -> Thread.sleep(pause.toMillis())`.
- Tests: `List.getFirst()`/`getLast()` and `Thread.sleep(Duration)` (Java 21/19) became `get(0)`, `get(size - 1)` and `toMillis()`.

One test had a latent race that the move exposed: `BridgeHarnessTest.launcherClosingMidSessionDisconnectsAndReconnectsAfterTheBackoff`
compared the complete list of backoff delays right after closing the last connection, while the bridge thread
records one more delay when it sees the close. The old test class path most likely had a logging backend that delayed the bridge
thread just long enough (inferred, not measured); with the silent SLF4J binding of `core/` the bridge thread won every time. The assertion now compares the first four delays.

## Node ids and Stonecutter (decision, spike S1)

**Decision: the node id and the Minecraft version are separate fields.** The Gradle project (and
`mod-index.json` `id`) is `1.21.1-neoforge`; the version Stonecutter evaluates is `1.21.1`.
`settings.gradle` registers `versions([(id): minecraft.last()])`, i.e. `"1.21.1-neoforge" to "1.21.1"`.
The layout stays flat (one source tree, one build script per loader); one branch per loader was not needed.

Why. A throw-away Stonecutter 0.9.8 project (`stonecutter.active null`, one shared `build.gradle`) printed
`sc.current.parsed.matches(...)` for each node, once per registration style:

```groovy
def p = sc.current.parsed
println "${sc.current.project} version=${sc.current.version} >=1.21.1:${p.matches('>=1.21.1')} <1.21.1:${p.matches('<1.21.1')} >=1.20.1:${p.matches('>=1.20.1')}"
```

Registering the id as the version makes Stonecutter read `neoforge` as a semver pre-release tag, which sorts
*below* the release:

| Registration | Node | version | `>=1.21.1` | `<1.21.1` | `>=1.20.1` |
|---|---|---|---|---|---|
| `versions("1.20.1-forge", "1.21.1-neoforge", "26.3-fabric")` | `1.20.1-forge` | `1.20.1-forge` | false | true | **false** |
| | `1.21.1-neoforge` | `1.21.1-neoforge` | **false** | **true** | true |
| | `26.3-fabric` | `26.3-fabric` | true | false | true |
| `versions(["1.20.1-forge": "1.20.1", "1.21.1-neoforge": "1.21.1", "26.3-fabric": "26.3"])` | `1.20.1-forge` | `1.20.1` | false | true | true |
| | `1.21.1-neoforge` | `1.21.1` | true | false | true |
| | `26.3-fabric` | `26.3` | true | false | true |

So with the naive registration `//? if >=1.21.1` is false on the node `1.21.1-neoforge`. The Stonecutter wiki
(project model, "Version") documents the same trap and the same fix. `26.3-fabric` was always fine only by luck of its name.
Rules that follow: the node id is never used in a predicate, `nodes.txt` takes explicit release ids only
(`26.3`, `1.21.1`; the last one is the compile version), and the build script finds the loader through
`sc.current.project`, not through the version.

## JDKs

`nodes.txt` (columns `java` and `gradleJdk`) is the single source of truth for the JDK majors of a node. It is read by
- `settings.gradle` and `gradle/node.gradle`: `--release <java>` for the node's classes, and the `javaLauncher` of every run task (`runClient`) is the toolchain JDK of that major, so the game of `1.20.1-forge` runs on Java 17 even though Gradle runs on 21;
- `scripts/dev-env.sh` and `scripts/dev-env.ps1`: they download the node's JDK and the Gradle JDK (Temurin, SHA-256 checked) into `.jdk/<major>` and set `PUMPKIN_JDK_<major>`;
- `.github/workflows/mod.yml`: the `nodes` job turns `nodes.txt` into the job matrices.
- `scripts/compile-matrix.mjs`: starts Gradle on `PUMPKIN_JDK_<gradleJdk>`.

Deviation from INGAME 4.3 ("one JDK per build", amendment A5): **Gradle itself needs JDK 21 or newer** (Stonecutter),
and **JDK 25 on Fabric nodes** (Loom 1.18.2, also for the obfuscated Minecraft versions). The JDK Gradle runs on is the
`gradleJdk` column of `nodes.txt` (never below the node's `java` and never below `mod.gradleJdkMin` in `gradle.properties`;
`settings.gradle` checks both), and only the game JVM and the compile release follow the node. Gradle finds the JDKs
through the environment variables above (`org.gradle.java.installations.fromEnv`); automatic toolchain download is off.

## Build and test

Everything runs without admin rights and without a system-wide Java or Gradle. Windows (PowerShell), from `mod/`:

```powershell
.\scripts\dev-env.ps1 -Node 1.21.1-neoforge        # default: the first node in nodes.txt
.\gradlew.bat -Pnode=1.21.1-neoforge build modIndex
```

Linux and macOS (note the leading dot, so `JAVA_HOME` stays set; `PUMPKIN_NODE=<id> . scripts/dev-env.sh` where a shell passes no arguments to `.`):

```sh
. scripts/dev-env.sh 1.21.1-neoforge
./gradlew -Pnode=1.21.1-neoforge build modIndex
```

- `-Pnode=<id>[,<id>]` configures only those nodes. Use it: each loader's toolchain wants its own JDK, and the first run of a node decompiles Minecraft (about 7 minutes for NeoForge/Forge, cached afterwards). Without it Gradle configures every node and needs JDK 25.
- `build` compiles each node against the real game and runs the JUnit tests of `core/`. `-Pcore.testJdk=<major>` runs those tests on exactly that JDK (CI passes the node's JDK).
- `modIndex` writes `build/mod-index/mod-index.json` and copies the jars next to it, then `checkJarBudget` fails the build if one jar is above `mod.jarMaxBytes` (300 KB) or all together above `mod.totalMaxBytes` (8 MB), both in `gradle.properties`.
- `node scripts/validate-mod-index.mjs build/mod-index/mod-index.json` checks the index against the contract (field rules, file name, SHA-256 of every jar, budget).
- `node scripts/check-conditionals.mjs` checks the layer rules. `node scripts/check-conditionals.check.mjs`, `node scripts/validate-mod-index.check.mjs` and `node scripts/compile-matrix.check.mjs` run the specifications of the three scripts.
- `./gradlew -Pnode=<id> runClient` starts a dev client. `./gradlew genSources` (Fabric node) gives readable game sources for the IDE.
- First-run cost, measured on the dev machine for a Minecraft version that was not yet in the Gradle cache: decompiling and remapping takes about 1.5 to 2 minutes for a Fabric node (1.20.5: 2m08, 1.21: 1m30) and 2.5 to 4 minutes for a NeoForge node (1.21: 2m30; a complete first `build` of 26.2: 3m43; M1a measured about 7 minutes for its first NeoForge and Forge builds). The first `runClient` of a version also downloads the game assets. A further run of the same version takes seconds. The compile matrix pays the cost once per release it compiles against, and CI pays it again on a cold cache.

### Running one node

```powershell
.\scripts\dev-env.ps1 -Node 1.21.1-fabric                      # sets JAVA_HOME (JDK 25 here) and PUMPKIN_JDK_21/25
.\gradlew.bat -Pnode=1.21.1-fabric build modIndex              # jar in build\mod-index\
.\gradlew.bat -Pnode=1.21.1-fabric runClient                   # dev client; stop it yourself (it opens a window)
```

`26.2-neoforge` needs JDK 25, `1.21.1-neoforge` JDK 21, `1.20.1-forge` runs the game on JDK 17 and Gradle on 21;
`dev-env` prepares exactly those.

## Widget kit (package U1)

The screens of the hub (INGAME 6.2) stand on two layers:

- `core/src/main/java/.../ui/model/` computes every rectangle Minecraft-free: `HubLayout` (title, status line, tab bar,
  body, footer at 320x240 and up), `TabBarModel` (wraps below 300 px), `ScrollModel` (whole-row scrolling, wheel,
  PageUp/PageDown, reveal), `RowLayout`/`RowPainter` (one- and two-line rows, 24 and 36 px), `Fit` (clipping with an
  ellipsis through an injected width function), `StateKeeper` (text, focus, scroll position and tab across
  `Screen.init` re-runs). Golden rectangle lists at 320x240, 427x240, 480x270, 640x360 and 960x540 are the source of
  truth (`core` JUnit tests).
- `src/main/java/.../ui/kit/` is the thin widget glue with no version conditionals: `PumpkinScreen` (frame with title,
  status line, optional tabs, body and footer "Fertig"), `ScrollPane` (rows outside the body rectangle get
  `visible = false`; the 2 px scrollbar comes from `ScrollModel`), `TabBar`, `Row`. Everything era-specific sits in
  `compat/` (`CompatScreen`, `CompatPainter`, `Widgets`, `Text`, `GameScreens`, ...), keyed on the Minecraft version
  through Stonecutter conditionals, so the NeoForge and Forge nodes reuse it unchanged.

`ui/FriendsScreen` (the screen of the merged 26.3 state) runs on the kit already; the hub screens of package U2
replace it.

### Kit demo (the render proof)

`ui/demo/KitDemoScreen` proves the kit renders on a Minecraft version: two tabs, a scroll list of 40 rows (every fifth
two-line), an `EditBox`, a toggle and buttons, wired to the clipboard. It is reachable **only** with
`-Dpumpkin.dev.kitdemo=true` (never in normal play): with the property set it opens by itself when the title screen
first shows (a dev thread polls through `Minecraft.execute`, no extra Mixin), logs
`pumpkin_friends kit demo rendered <n> frames at <w>x<h>` exactly once after its first three rendered frames, then
closes itself. No `NoSuchMethodError`, no layout exception - that is the proof.

```sh
node scripts/kit-demo.mjs --node 1.21.1-fabric          # starts runClient -Pkitdemo, waits for the line, kills the client
```

The script uses a hard 180 s timeout and kills only its own process tree. Dev-run evidence (the render proof of U1,
2026-10-04, dev machine, Gradle on JDK 25, game on the node's JDK):

| Node | Proof line of the dev run |
|---|---|
| `1.21.1-fabric` | `[11:20:39] [Render thread/INFO] (pumpkin_friends) pumpkin_friends kit demo rendered 3 frames at 427x240` |
| `1.21.8-fabric` | `[11:07:49] [Render thread/INFO] (pumpkin_friends) pumpkin_friends kit demo rendered 3 frames at 427x240` |
| `1.21.11-fabric` | `[11:09:37] [Render thread/INFO] (pumpkin_friends) pumpkin_friends kit demo rendered 3 frames at 427x240` |
| `26.3-fabric` | `[11:11:56] [Render thread/INFO] (pumpkin_friends) pumpkin_friends kit demo rendered 3 frames at 427x240` |

A first attempt of `1.21.1-fabric` missed the 180 s twice: the Gradle compile plus the game start (datafixer, sound
engine, resource reload) needed just over the limit on a loaded machine; the third run, with the build caches warm,
passed with the line above. The window opens at 427x240 GUI pixels (the default `guiScale` of a 2560x1440 desktop),
one of the golden resolutions of the layout tests.

CI runs the same script per Fabric node under Xvfb with software GL (`kit-demo` job, best effort and marked
unverified: never started on a GitHub runner; whether 26.x starts under software rendering is open, INGAME 12 risk 2).

## Compile matrix

`scripts/compile-matrix.mjs` (INGAME 4.3) compiles each node against both ends and one middle release of its
`matrix` list in `nodes.txt` (the list of `docs/friends/INGAME-API.md` section 5): `1.21.1-fabric` against 1.20.5,
1.21 and 1.21.1, `1.21.1-neoforge` against 1.21 and 1.21.1, a one-release node against that release.

```sh
node scripts/compile-matrix.mjs                              # every node
node scripts/compile-matrix.mjs --node 1.21.1-fabric         # one node
node scripts/compile-matrix.mjs --node 1.21.1-fabric --only 1.20.5   # exactly these releases
node scripts/compile-matrix.mjs --plan                       # the plan as JSON, nothing is compiled
```

The plumbing is one project property: `-Pcompile.minecraft=<release>` (needs exactly one node in `-Pnode`). `settings.gradle`
rejects a release outside the node's `matrix`, registers that release as the Stonecutter version of the node (so
`//? if` conditionals and the `minecraft_version` swap follow it), and `pinned('<key>')` in `gradle/node.gradle` takes the
dependency version from the key `<key>@<release>` of `versions/<node>/gradle.properties`; a missing pin stops the
build instead of silently using the wrong dependency. The script runs `compileJava` per release on the node's Gradle
JDK (`PUMPKIN_JDK_<gradleJdk>`) and exits 1 if any compile fails. CI runs it as the `matrix-compile` job, one job per node.

What it proves today: for the four Fabric nodes it is a real compatibility gate (their `compat/` sources use a
different member set per era), for the three tracers it proves the build topology for every release of the list
(the right Minecraft and loader artifacts resolve, the descriptor and the Mixin target compile). That the mechanism
itself catches a source that does not fit a release was shown with a throw-away class
that used `ResourceLocation.fromNamespaceAndPath` (added in Minecraft 1.21): `--only 1.20.5` failed with `Symbol: Methode
fromNamespaceAndPath(String,String)`, `--only 1.21` compiled. The probe was not committed.

## `mod-index.json`

```json
{ "modVersion": "2.1.0",
  "nodes": [ { "id": "1.21.1-neoforge", "loader": "neoforge", "loaderMin": "21.1.0", "minecraft": ["1.21.1"],
               "javaMin": 21, "strategy": "fmlMavenRoot", "verified": null,
               "file": "pumpkin_friends-2.1.0+1.21.1-neoforge.jar", "sha256": "<64 lowercase hex>" } ] }
```

`minecraft` lists explicit release ids; a node only claims what it was built against. `strategy` is
`fabricAddMods` for Fabric, `fmlMavenRoot` for NeoForge 21.1 and Forge 1.20.1, `fmlModFolders` for NeoForge on FML 10 and newer (`26.2-neoforge`; INGAME 3.5).
The mod version is `version` in `gradle.properties` (= the launcher version); the jar name is
`pumpkin_friends-<modVersion>+<node id>.jar`.

## Tracer proof

Each tracer node was started with `runClient` in the dev environment (hard limit 150 s, process killed afterwards) and the log was searched.

| Node | Log line | Loader accepted the mod |
|---|---|---|
| `1.21.1-neoforge` (game on Java 21.0.12) | `[modloading-worker-0/INFO] [pumpkin_friends/]: pumpkin_friends tracer 1.21.1 neoforge` | `Pumpkin Friends 2.1.0+1.21.1-neoforge (pumpkin_friends)` in the Mod List, resource pack `mod/pumpkin_friends` |
| `1.20.1-forge` (game on Java 17.0.20, Gradle on 21) | `[modloading-worker-0/INFO] [pumpkin_friends/]: pumpkin_friends tracer 1.20.1 forge` | `Creating FMLModContainer instance for dev.laux.pumpkin.friends.platform.forge.TracerMod` and `Attempting to inject @EventBusSubscriber classes ... for pumpkin_friends` |
| `26.3-fabric` (regression) | `(pumpkin_friends) Nicht vom Pumpkin Launcher mit Freunden gestartet; Pumpkin Friends bleibt inaktiv` | `pumpkin_friends 2.1.0+26.3-fabric` in the loader's mod list |
| `1.21.1-fabric` (game on Java 21, Gradle on 25, Fabric Loader 0.19.5) | `[Render thread/INFO] (pumpkin_friends) pumpkin_friends tracer 1.21.1 fabric`, then from the Mixin on `Minecraft#run`: `(pumpkin_friends) pumpkin_friends tracer 1.21.1 fabric mixin` | `pumpkin_friends 2.1.0+1.21.1-fabric` in the loader's mod list |
| `26.2-neoforge` (game on Java 25, FancyModLoader 11.0.16) | `[modloading-worker-0/INFO] [pumpkin_friends/]: pumpkin_friends tracer 26.2 neoforge` | `Pumpkin Friends 2.1.0+26.2-neoforge (pumpkin_friends)` in the Mod List; the dev run itself starts with `-Dfml.modFolders=pumpkin_friends%%<build folders>` |
| `1.20.1-forge` (rerun after the descriptor changed to `clientSideOnly = true`) | `[modloading-worker-0/INFO] [pumpkin_friends/]: pumpkin_friends tracer 1.20.1 forge` | Forge loaded the mod; the packaged `mods.toml` carries `clientSideOnly = true` at the top level |

### The remapped Fabric jar (amendment A4)

Fabric before 26.x runs in intermediary names, and a jar handed to `-Dfabric.addMods` is not remapped at runtime.
Every obfuscated Fabric node therefore ships the Loom-remapped jar (`loomx.modJar` = `remapJar`; the plain `jar` task
output is not what `modIndex` collects). The Mixin configuration `pumpkin_friends.mixins.json` is generated per node by
`build-fabric.gradle`: with `refmap` and the Loom refmap pipeline on the obfuscated nodes, without a refmap on 26.x
(Mojang names), and with the `compatibilityLevel` of the node's `--release` (JAVA_21 below 26.x, JAVA_25 on 26.3).
Historical evidence from the tracer jar `pumpkin_friends-2.1.0+1.21.1-fabric.jar` of spike S1 (target `Minecraft#run`,
today the pause-menu Mixin `PauseScreenMixin` on `PauseScreen#init` rides the same pipeline):
- `javap -v` of the Mixin class: the `@Mixin` target was `Lnet/minecraft/class_310;` (`Minecraft` in intermediary names);
- `pumpkin_friends-refmap.json` mapped `run` to `Lnet/minecraft/class_310;method_1514()V` (namespace `named:intermediary`) and was named by the `refmap` field of the Mixin configuration;
- `fabric.mod.json` listed the entry point and that Mixin configuration.
The 26.3 jar has no refmap (`"refmap": null`); its Mixin runs against Mojang names directly.

What this does **not** prove: the dev environment loads the classes and descriptor from the build
folders, not the packaged jar, and not through the launcher's injection flags (`fabric.addMods`, `fml.mavenRoots`,
`fml.modFolders`). In particular, that the remapped jar's Mixin applies when loaded through `-Dfabric.addMods` in a
non-development game is still unproven; the dev run applies the Mixin through Loom's development mappings, the jar listing above
only shows that the jar carries the intermediary names and the refmap that run needs. Both belong to the injection packages (L1, S2,
Appendix B of INGAME). A first dev run found a real descriptor bug that is now fixed: FML rejects the version range
`[1.21.1,1.21.1]`, a single version must be written `[1.21.1]`.

## CI

`.github/workflows/mod.yml` (not run on GitHub yet; checked with `actionlint` 1.7.12): the `nodes` job reads
`nodes.txt`; `checks` runs the layer rules and the specifications of the three scripts; `build` is a matrix over the nodes
(`fail-fast: false`) that sets up the node's JDK and the Gradle JDK (`gradleJdk` column) and runs
`./gradlew -Pnode=<id> -Pcore.testJdk=<java> build modIndex`; `matrix-compile` is a second matrix over the same nodes that runs
`node mod/scripts/compile-matrix.mjs --node <id>`; `package` merges the per-node indexes with `jq`, validates the result and
uploads `mod-index.json` plus all jars as one artifact (every `build` job also uploads its own `mod-node-<id>` artifact).
The Gradle cache is keyed per toolchain family (`fabric`, `neoforge`, `legacyforge`), not per node.
The old `mod` job in `ci.yml` is gone, and so is the Modrinth publish workflow `mod-release.yml` (amendment A12): the launcher
injects the jar itself, nothing is published to a mod platform.

## Mod behaviour (node `26.3-fabric`)

The tests cover the Minecraft-free parts: `ProtocolTest`, `BackoffTest`, `StateStoreTest`,
`SanitizeTest`, and `BridgeHarnessTest`, which plays the launcher side of the protocol from a
script (`ScriptedLauncher`) against the real bridge client. Protocol 1 is unchanged.

## FakeLauncher

`scripts/FakeLauncher.java` plays the launcher side of the bridge so you can try the mod in the
game without the real launcher. It has no dependencies and runs straight from source.

1. In one terminal, from the `mod` folder, after the dev-env script:

   ```powershell
   java scripts\FakeLauncher.java
   ```

   It prints the three environment variables (`PUMPKIN_IPC_PORT`, `PUMPKIN_IPC_TOKEN`,
   `PUMPKIN_IPC_PROTOCOL`) as a ready-to-paste line for PowerShell and for sh. The token is new
   on every start.

2. In a second terminal, from the `mod` folder: run the dev-env script, paste the environment
   line, then start the game with `.\gradlew.bat -Pnode=26.3-fabric runClient` (or `./gradlew ...`).

3. The fake launcher prints every line it receives (`<-`) and sends (`->`). It knows three
   friends: `jeb_` (online, with a head), one online friend whose name contains `§c` and a
   right-to-left override, and `Notch` (offline). It answers `ping`, reports `lanOpened` and
   `lanClosed`, asks for confirmation on the first `share`, and handles `kick` and
   `stopSharing`. Type these commands into its terminal:

   | Command | Effect |
   |---|---|
   | `allow` | allows the pending first share; the friends become guests and a toast with a head appears |
   | `deny` | refuses it (`error{denied}`) |
   | `invite` | sends an invite from `jeb_` |
   | `online` / `offline` | switches `Notch` online (with a toast) or offline |
   | `error <code>` | sends `error{code}`, for example `error busy` |
   | `quit` | ends the fake launcher, as if the launcher was killed |

## Owner GUI checklist

The agent that built this mod verified only the build and the JUnit tests; nothing below has
been checked in the game yet (the 26.3 dev run only confirmed that the mod loads and stays inactive without the launcher).
The owner runs this list as part of E10 (SPEC 13.4) and records the results in `docs/friends/VERIFICATION.md`.

Against `FakeLauncher.java` first, then the real launcher:
  1. Without env: no button, no crash, one log line.
  2. The button appears only while connected.
  3. Publish from the mod: the launcher shows the verified port (source `mod`).
  4. Publish from vanilla World Options: same.
  5. First invite from the mod: "Bestätige im Launcher", and after allowing it the friend gets a toast with a head.
  6. Kick and stop: the friend is disconnected and gets a toast.
  7. Kill the launcher mid-session: the UI hides, the game runs on without exceptions.
  8. Resize with the pause menu open: no duplicate button.
  9. German and English.
  10. A name containing `§c` and bidi characters is shown without formatting.
