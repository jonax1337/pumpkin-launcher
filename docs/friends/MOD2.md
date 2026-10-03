# Pumpkin Friends "Mod 2.0": every launcher, many versions, full in-game parity

Status: design spec, decided (2026-10-03). Base: `docs/friends/SPEC.md` (v2 incl. Wave 0-3 syncs) and `docs/friends/BYNAME.md`. Where this document and SPEC.md disagree, this document wins for everything it names; package D0 folds the changes back into SPEC.md (section 9.9).

Words used here:
- **Launcher**: the Pumpkin Launcher (Tauri app, `E:\DEV\launcher`). It is the only process with a network stack for friends.
- **Mod**: the client mod `pumpkin_friends` (Fabric, NeoForge, Forge; Quilt via the Fabric jar).
- **Own launch**: a game the launcher started (env token). **Foreign game**: a game started by any other launcher (Prism, Modrinth App, vanilla launcher, CurseForge app, ATLauncher, ...).
- **Link**: one authenticated bridge connection plus its approval state, bound to one game process.
- **Node**: one Stonecutter build target `<era>-<loader>` that produces one jar.

---

## 0. Decisions at a glance

| Topic | Decision |
|---|---|
| Versions | One source tree, Stonecutter 0.9.8. Ship first (2.0): 26.3, 26.2, 26.1.x, 1.21.9-1.21.11, 1.21.2-1.21.8, 1.21-1.21.1 on Fabric and NeoForge; 1.20-1.20.1 on Fabric and Forge (14 jars). 2.1: 1.20.2-1.20.6 Fabric, 1.18.2-1.19.4 Fabric and Forge, plus the launcher's version floor lowered to 1.18. Later on demand: Forge above 1.20.1, NeoForge 1.20.2-1.20.6, 1.16.5/1.17.1. Never: 1.15.2 and older. |
| Quilt | No Quilt build. The Fabric jar is tagged `quilt` on Modrinth only for versions the owner smoke-tested on Quilt. |
| Code split | `mod/core` (Minecraft-free, Java 17, all logic and tests), `compat/` (every version conditional), `platform/` (one entry class per loader), `ui/` (version-free screens on a tiny own widget kit). CI rejects Stonecutter conditionals outside `compat/` and `platform/`. |
| Foreign launchers | The launcher writes a per-user discovery file (port + 256-bit token). Every v2 connection, own or foreign, opens with `attach`: mutual HMAC-SHA256, the token never crosses the wire. |
| PID trust | The launcher takes the game PID from the OS socket table (`sockowner::owner_of_connection`), never from the mod, and pins it with the process start time (`procinfo::ProcessKey`). Hosting keeps `verify_port(pid, port)` (LISTEN socket owned by exactly that PID + status ping) and joining keeps `connects_from(pid, ...)`. |
| Foreign approval | Setting "Spiele aus anderen Launchern erlauben", default OFF. Each foreign game process needs one pairing approval in the launcher (with scope checkboxes), after the launcher has verified the account through Mojang `hasJoined`. |
| Account proof | Foreign games only: the mod calls the game's own vanilla `joinServer` once with a server id derived from a launcher nonce; the launcher checks `hasJoined`. Offline/cracked games cannot attach. |
| Protocol | v2 = request/response with correlation ids, whole-topic state pushes with revisions, events. Line cap 64 KiB after the handshake (no paging). v1 (`hello`) stays byte-identical for 0.1.0 jars. |
| Consent | Replaces "no accept over the mod channel". Scopes `join`, `share`, `friends` per link (read is implicit). Prompts answer "Nur diesmal" / "Für dieses Spiel" / "Ablehnen". Privacy-reducing settings and identity operations are never grantable: the launcher asks on every single action. Every in-game social action is audited, toasted in the launcher with "Rückgängig" where possible, and friendships created in-game carry the review notice `addedInGame`. |
| Parity | Everything in the launcher's Friends feature is reachable in-game, except (a) turning Friends on for the first time (no bridge exists before the opt-in, SPEC 12.1), (b) installing the mod, (c) copying the full peer id and relay consent. Disable, rotate and reset work in-game with a launcher confirmation each time. |
| In-game join | Into the running game when it matches (`ConnectScreen` to the literal `127.a.b.c:port`), otherwise "Passende Instanz starten" (Pumpkin instance, launched by the launcher) or "Im Launcher öffnen". Foreign launchers are never driven. |
| UI | Pure vanilla widgets (`Button`, `EditBox`, own `Label`, own `ScrollPane`, own tab bar made of buttons). No `AbstractSelectionList`, no layouts, no `TabNavigationBar`, no textures. Friend faces are deferred (2.x). |
| Packaging | One Modrinth project, one version per node: `version_number` `0.2.0+<era>-<loader>`. `mod-release.yml` loops a `jars.json` emitted by the build; one approval publishes all. |

---

## 1. Goals and non-goals

### 1.1 Goals (2.0)
1. **G1 Versions and loaders:** the 14 jars of section 2 build from one tree in CI and pass the owner smoke test per node.
2. **G2 Any launcher:** a game started by any launcher on the same PC and OS user connects to the running Pumpkin Launcher, with no background service and no network code in the mod beyond the game's own session call (G2 needs the launcher running; without it the mod is inert).
3. **G3 Parity:** every launcher capability of section 7.1 has an in-game form, classed P / PS / PC / L.
4. **G4 Security parity:** the tunnel guarantee of SPEC 6.1/6.2 is unchanged: the host bridges only to a verified LISTEN socket owned by the linked PID; the guest listener accepts only connections owned by the linked PID. No new way for a remote peer to reach anything.
5. **G5 Compatibility:** a 0.1.0 jar keeps working with the new launcher (v1 path); a 0.2.0 jar degrades to v1 features with a 0.2.x launcher that predates 2.0 (old launcher).
6. **G6 Maintainability:** a new Minecraft release costs one node plus changes in `compat/` only.

### 1.2 Non-goals (2.0)
- A daemon, a service, an autostart helper, or any socket the mod listens on.
- HTTP, P2P or Mojang API calls from the mod, except the one vanilla `joinServer` of the account proof (4.6).
- Turning Friends on from the game for the first time (the bridge does not exist before the opt-in; the game shows how to do it in the launcher).
- Creating, switching or installing instances, versions or mods in foreign launchers.
- Games in WSL, VMs, containers, or under another OS user (the PID and same-user checks fail by design).
- Friend faces in-game (protocol op reserved: `friend.faces`, answered with `unsupportedOp` in 2.0).
- A client chat command. Entry points are the pause menu, the title screen and an (unbound) keybinding.
- Remembering grants across game launches. Every grant ends with the link's process.
- Automated in-game tests; the in-game checks are the owner checklist (10.5).
- Changing or hiding Mojang's own Friends list on 26.2+.

---

## 2. Support matrix

Legend: **2.0** ship first; **2.1** next release (needs the launcher floor change, R6); **later** on demand, no work scheduled; **never**; **-** the loader does not exist for that version.

| Node (build target) | MC range served | Java | Fabric | NeoForge | Forge | Quilt (Fabric jar) |
|---|---|---|---|---|---|---|
| `26.3` | 26.3 | 25 | **2.0** | **2.0** once NeoForge 26.3 has a non-beta build; CI builds against the beta, publishing waits | later | tag after owner test |
| `26.2` | 26.2 | 25 | **2.0** | **2.0** | later | tag after owner test |
| `26.1` | 26.1-26.1.2 | 25 | **2.0** | **2.0** | later | tag after owner test |
| `1.21.11` | 1.21.9-1.21.11 | 21 | **2.0** | **2.0** | later | tag after owner test |
| `1.21.4` | 1.21.2-1.21.8 (split if the fingerprint check fails, 3.6) | 21 | **2.0** | **2.0** | later | tag after owner test |
| `1.21.1` | 1.21-1.21.1 | 21 | **2.0** | **2.0** | later | tag after owner test (QFAPI exists) |
| `1.20.6` | 1.20.5-1.20.6 | 21 | 2.1 | later (NeoGradle) | later | - |
| `1.20.4` | 1.20.2-1.20.4 | 17 | 2.1 | later (NeoGradle) | later | - |
| `1.20.1` | 1.20-1.20.1 | 17 | **2.0** | Forge jar tagged `neoforge` after owner test on NeoForge 47.1 | **2.0** | tag after owner test (QFAPI exists) |
| `1.19.4` | 1.19.3-1.19.4 | 17 | 2.1 | - | 2.1 | - |
| `1.19.2` | 1.19-1.19.2 | 17 | 2.1 | - | 2.1 | - |
| `1.18.2` | 1.18-1.18.2 | 17 | 2.1 | - | 2.1 | - |
| 1.17.1, 1.16.5 | | 16 / 8 | later | - | later | - |
| 1.15.2 and older | | | never | - | never | - |

Reasons:
- **2.0 cut:** the six newest eras carry most Fabric and NeoForge projects on Modrinth (1.21.1: 19.4k Fabric / 21.1k NeoForge; 1.20.1: 17.6k Fabric / 25.0k Forge). Every 2.0 node runs Java 17+ and is hostable with today's launcher floor (1.20), so no tunnel-validator change ships with 2.0.
- **Forge above 1.20.1 later:** needs a third toolchain (ForgeGradle or Architectury Loom, not evaluated) and EventBus 7 hooks from 1.21.6. Small audience on Modrinth for 1.21.x Forge (5.4k) compared with NeoForge.
- **NeoForge 1.20.2-1.20.6 later:** needs NeoGradle; MDG covers NeoForge 21+ only.
- **1.18.2-1.19.4 in 2.1:** the mod part is cheap (Fabric Loom and MDG legacyforge cover it), but hosting and joining need the launcher floor lowered with per-era Login Start golden vectors and `--server/--port` launch arguments (R6). Friend management in-game would work earlier, but shipping a jar whose share button always says "ab 1.20" is not worth a release of its own.
- **1.16.5/1.17.1 later:** Java 8/16 would force the shared core below Java 17 syntax (records, sealed types) and a second Forge event API.
- **Never:** no official mappings and no modern Fabric before 1.14; a different GUI stack before 1.13; the audience on Modrinth is small and served by other mods.
- **26.2+ and Mojang's native Friends list:** Pumpkin Friends ships there too (own identity and codes, add by name, modded worlds, same UX on every version). The mod never binds key `O`, labels itself "Pumpkin Friends" everywhere, and its title-screen button skips placement when it would overlap Mojang's `FriendsButton` (owner decision 12.2-D4).

---

## 3. Architecture

### 3.1 Runtime picture
```
 Game JVM (any launcher)                                  Pumpkin Launcher (Rust)
 ┌───────────────────────────────┐   loopback TCP        ┌──────────────────────────────────────────┐
 │ platform/<Loader>Entry        │   JSON lines          │ modbridge  (accept, attach, links, wire)  │
 │   └ FriendsClient (core)      │◄─────────────────────►│   ├ foreign (pairing, account proof)      │
 │       ├ Connector: env|file   │  attach (HMAC) → v2   │   ├ sockowner::owner_of_connection        │
 │       ├ BridgeClient + Ops    │  req/res, state, ev   │   └ procinfo (ProcessKey, alive)          │
 │       └ TopicStore            │                       │ friends::mod_link (dispatch, consent,      │
 │ ui/ screens (version-free)    │                       │   topics, audit) → existing services       │
 │ compat/ (one class per API)   │                       │ friends::hosting / joining (+ external)    │
 └───────────────────────────────┘                       └──────────────────────────────────────────┘
```
The mod holds no friends state of its own beyond the last pushed topics and its local toast/button preferences.

### 3.2 Repository layout under `mod/`
```
mod/
  settings.gradle.kts            Stonecutter: nodes × loaders (3.3); include(":core")
  stonecutter.gradle.kts         active node, string replacements, chiseled tasks buildAndCollect / checkAll
  build.fabric.gradle.kts        Fabric Loom via dev.kikugie.loom-back-compat (remap for < 26, no remap for 26.x)
  build.neoforge.gradle.kts      ModDevGradle net.neoforged.moddev (NeoForge >= 21)
  build.forge.gradle.kts         ModDevGradle net.neoforged.moddev.legacyforge (Forge 1.18.2-1.20.1)
  gradle.properties              mod_version=0.2.0, group, junit, shared plugin versions
  versions/<era>-<loader>/gradle.properties   minecraft_version, mc_releases (Modrinth tags), mc_dep (loader range),
                                 java, loader / fabric_api / neoforge / forge versions
  gradle/wrapper/*  gradlew  gradlew.bat     (Gradle 9.7.1, unchanged)
  core/
    build.gradle.kts             java-library, options.release = 17, compileOnly gson 2.8.9, JUnit 6
    src/main/java/dev/laux/pumpkin/friends/core/
      bridge/   BridgeClient Connector EnvConnector DiscoveryConnector Discovery Attach Hmac Wire Backoff Limits
      ops/      Ops (req/res correlation) Op (op names + arg builders) ErrorCode Result
      state/    TopicStore Topics (records per topic) Sanitize StateListener
      report/   GameReport ManifestScanner (sha512 of top-level jars)
      ModConfig (config/pumpkin_friends.json)
    src/test/java/dev/laux/pumpkin/friends/core/   unit tests + ScriptedLauncher (v1 and v2)
  src/main/java/dev/laux/pumpkin/friends/
    client/     FriendsMod (common bootstrap) ScreenHooks LanWatcher ToastFeed JoinFlow
    ui/         HubScreen FriendsTab RequestsTab InvitesTab ShareTab OptionsTab AddFriendScreen FriendActionsScreen
                InviteScreen LauncherWaitScreen ConfirmFlow
    ui/kit/     PumpkinScreen TabBar ScrollPane Rows Fit (text clipping, sizes)
    compat/     Texts Widgets Label CompatScreen Toasts Lan Connect Gui Keys Session Clipboard GameInfo
    platform/   Platform (interface) fabric/FabricEntry neoforge/NeoForgeEntry forge/ForgeEntry
  src/main/resources/
    fabric.mod.json  META-INF/neoforge.mods.toml  META-INF/mods.toml  pack.mcmeta
    assets/pumpkin_friends/{icon.png, lang/en_us.json, lang/de_de.json}
  scripts/  dev-env.ps1 dev-env.sh (JDK 25/21/17)  FakeLauncher.java (v2)  check-conditionals.sh  check-lang.mjs
            fingerprint/ (FingerprintCheck.java: javap member list vs Mojang mappings / client jars)
  README.md (build, node list, owner checklist per node)
```
- The core sources are added to every node as an extra source directory (`sourceSets.main.java.srcDir(rootProject.file("core/src/main/java"))`). No jar-in-jar, no shading. The `core` project exists only to run the unit tests on JDK 17 and to enforce `release 17`.
- Gson comes from Minecraft at runtime (every target ships Gson >= 2.8.9). The core uses only API that exists in Gson 2.8.9 (`JsonParser.parseString`, `JsonObject`, `JsonArray`), and compiles against 2.8.9.
- The core code is rewritten to Java 17 syntax: the pattern `switch` in `BridgeClient.java:142` becomes an `if`/`instanceof` chain; records and sealed interfaces stay.
- `platform/<other loaders>/**` is excluded from compilation per loader build script (`sourceSets.main.java.exclude(...)`), so each node compiles exactly one entry class.

### 3.3 Build tooling
- **Stonecutter 0.9.8** (`dev.kikugie.stonecutter`), node names `<era>-<loader>`, e.g. `1.21.1-neoforge`. Constants available to conditionals: Minecraft version (semver predicates `>=1.21.2`), and the loader via `stonecutter.constants["fabric"|"neoforge"|"forge"]`.
- **Fabric:** `dev.kikugie.loom-back-compat` 0.4.2 picks `net.fabricmc.fabric-loom` (no remap) for 26.x and `fabric-loom-remap` below; Fabric Loom 1.18; Fabric API modules used: `fabric-screen-api-v1`, `fabric-lifecycle-events-v1`, `fabric-key-binding-api-v1` (declared as a dependency on the whole Fabric API in `fabric.mod.json`, as today).
- **NeoForge:** ModDevGradle `net.neoforged.moddev` 2.0.147.
- **Forge:** ModDevGradle `net.neoforged.moddev.legacyforge` (same MDG release), Forge 1.18.2-1.20.1.
- **Mappings:** Mojang mappings for every pre-26 node (Loom default; MDG uses official names). 26.x is unobfuscated.
- **Replacements:** pure renames live in `stonecutter.gradle.kts` replacements (e.g. `ResourceLocation` ↔ `Identifier` at 1.21.11), never in UI code.
- **JDKs:** `scripts/dev-env.ps1|sh` download checksum-verified Temurin 25, 21 and 17 into `mod/.jdk/<n>/` (Adoptium API + SHA-256, no admin). `JAVA_HOME` stays 25 for Gradle; the other homes are passed through `org.gradle.java.installations.paths` with `org.gradle.java.installations.auto-download=false`. Each node sets `java.toolchain.languageVersion` from its `java` property and `options.release` to the same number.
- **Mod metadata per loader:**
  - `fabric.mod.json`: `"environment":"client"`, `"depends":{"minecraft":"${mc_dep}","fabricloader":">=0.15","fabric-api":"*"}`, `"java":">=${java}"`.
  - `META-INF/neoforge.mods.toml` and `META-INF/mods.toml`: `displayTest="IGNORE_ALL_VERSION"` (client-only, never required on servers), dependency ranges from `mc_dep`.
  - `pack.mcmeta` for Forge 1.20.1 with that version's pack format.

### 3.4 Version adapter layer (`compat/`)
Rules:
1. Every Stonecutter conditional (`//? if`, `//?}`) lives in `compat/` or `platform/`. `scripts/check-conditionals.sh` fails CI otherwise.
2. One class per concern, one static method per API difference; no state except caches.
3. `ui/` and `client/` call only `compat/`, `ui/kit/`, `core/` and these vanilla types, which are stable from 1.18.2 to 26.3: `Minecraft`, `Screen`, `Component`, `Button`, `EditBox`, `AbstractWidget`, `Font`.

Contract (signatures are normative; the body differs per era):
```java
// compat/Texts
static Component literal(String s);  static Component translatable(String key, Object... args);
// compat/Widgets
static Button button(Component label, Runnable onPress, int width);           // height 20
static EditBox editBox(Font font, int width, Component hint, int maxLength, Consumer<String> onChange);
static void place(AbstractWidget w, int x, int y);  static void width(AbstractWidget w, int width);
static void tooltip(AbstractWidget w, Component text);                         // no-op before 1.19.3
static AbstractWidget toggle(Component label, boolean on, Consumer<Boolean> onChange, int width); // a Button showing "label: An/Aus"
// compat/Label  (one AbstractWidget subclass per render family; non-focusable, narrates its text)
static AbstractWidget label(Font font, Component text, int width, int color, boolean centered);
// compat/CompatScreen  (abstract base of ui/kit/PumpkinScreen; maps every render/input signature)
protected abstract void build();                    // called from init()/rebuild, widgets via add(w)
protected abstract void paint(Painter p);           // text and fills only: p.text(x,y,Component,color), p.fill(x0,y0,x1,y1,argb)
protected boolean onKey(int keyCode, int modifiers);       // returns handled
protected boolean onScroll(double mouseX, double mouseY, double amount);
protected final <T extends AbstractWidget> T add(T w);  protected final void clear();  protected final void rebuild();
// compat/Gui
static void open(Screen s);  static Screen current();  static boolean isPauseScreen(Screen s);  static boolean isTitleScreen(Screen s);
static List<AbstractWidget> widgets(Screen s);  static void addWidget(Screen s, AbstractWidget w);   // used by ScreenHooks
// compat/Toasts
static void system(Component title, Component body);   static void friend(String mcUuid, Component title, Component body); // FriendToast on >= 26.2 else system
// compat/Lan
static boolean inSingleplayer();  static boolean published();  static int port();   // -1 when not published
static boolean publish(int port);  static void unpublish();   static int freePort();
// compat/Connect
static void leaveWorld(Runnable then);                 // the per-family PauseScreen.onDisconnect copy (8.3)
static void connect(String host, int port, String title);   // ConnectScreen.startConnecting, never writes servers.dat
static boolean onMultiplayerServer();
// compat/Session
static void joinServer(String serverId) throws Exception;   // vanilla session service, current user (4.6)
static String playerName();  static String playerUuid();     // 32 lowercase hex
// compat/Keys
static KeyMapping register(Platform p);  static boolean consumeClick(KeyMapping k);
// compat/Clipboard
static void set(String text);
// compat/GameInfo
static String minecraftVersion();  static String launcherBrand();   // System property minecraft.launcher.brand or ""
```
Per-era facts each adapter implements are listed in Appendix C (the research table of API differences).

### 3.5 Loader entry points (`platform/`)
`Platform` (interface, version-free): `loaderName()` (`fabric`/`neoforge`/`forge`; `quilt` when `QuiltLoader` is present at runtime, detected by class lookup), `loaderVersion()`, `gameDir()`, `modsDir()`, `configDir()`, `onClientTick(Runnable)`, `onScreenInit(Consumer<Screen>)`, `registerKey(KeyMapping)`.

| Loader | Init | Screen init hook | Tick | Key |
|---|---|---|---|---|
| Fabric (all) | `ClientModInitializer` | `ScreenEvents.AFTER_INIT` + `Screens.getButtons` (`getWidgets` from 26.1) | `ClientTickEvents.END_CLIENT_TICK` | `KeyBindingHelper.registerKeyBinding` |
| NeoForge 21+ / 26.x | `@Mod(dist = Dist.CLIENT)` ctor | `ScreenEvent.Init.Post` on `NeoForge.EVENT_BUS` | `ClientTickEvent.Post` | `RegisterKeyMappingsEvent` on the mod bus |
| Forge 1.20.1, 1.19.x | `@Mod` + `DistExecutor`-free client check | `ScreenEvent.Init.Post` on `MinecraftForge.EVENT_BUS` | `TickEvent.ClientTickEvent` phase END | `RegisterKeyMappingsEvent` |
| Forge 1.18.2 | same | `ScreenEvent.InitScreenEvent.Post` | same | `ClientRegistry.registerKeyBinding` |

`FriendsMod.start(Platform)` is the single common bootstrap: read config, pick a connector (4.2), start `BridgeClient`, register `ScreenHooks`, `LanWatcher`, `ToastFeed` and the key. It never throws; any failure logs one line and leaves the mod inert.

### 3.6 CI matrix (`.github/workflows/mod.yml`, replaces the `mod` job of `ci.yml`)
- **`core`**: JDK 17, `./gradlew :core:test`, plus `scripts/check-conditionals.sh` and `node scripts/check-lang.mjs` (identical key sets in `en_us`/`de_de`, every `pumpkin_friends.error.*` code of `ErrorCode` present).
- **`node`** matrix over every node of the current release (2.0: 14 entries; 26.3-neoforge included), `fail-fast: false`, `actions/setup-java` with JDKs 25/21/17, `gradle/actions/setup-gradle` cache, `CI=true`, `./gradlew :<node>:build :<node>:fingerprint`.
- **`fingerprint`** (task per node, `scripts/fingerprint/FingerprintCheck.java`): list every Minecraft class, method and field the compiled jar references (`javap -c -p`), and check each exists in the Mojang mappings (pre-26) or client jar (26.x) of **every** version in the node's `mc_releases`. A miss fails the node; the fix is a node split, never a silent range cut. This is what makes ranges like 1.21.2-1.21.8 claimable without launching the game.
- **`collect`**: `./gradlew buildAndCollect` writes `mod/build/release/` with all jars and `jars.json` (3.7).
- Workflow and action pins follow the existing style (full commit SHAs).

### 3.7 Packaging and release
- Jar name `pumpkin_friends-0.2.0+<era>-<loader>.jar`; Modrinth `version_number` `0.2.0+<era>-<loader>` (unique per node).
- `jars.json` (build output, one entry per jar):
```json
[{"file":"pumpkin_friends-0.2.0+1.21.1-neoforge.jar","sha256":"<64 hex>","versionNumber":"0.2.0+1.21.1-neoforge",
  "loaders":["neoforge"],"gameVersions":["1.21","1.21.1"],"dependencies":[]}]
```
  Fabric entries: `"loaders":["fabric"]` (plus `"quilt"` only for nodes listed in `mod/quilt-tested.txt`), `"dependencies":[{"project_id":"P7dR8mSH","dependency_type":"required"}]`.
- `mod-release.yml` keeps its two jobs. `build` (no secret, no cache) builds all nodes, checks each jar's mod id and version, checks `MOD_PROJECT_ID`, uploads the release dir as an artifact with the `jars.json` sha256 list. `publish` (environment `modrinth-release`, owner approval once) verifies each sha256, refuses any existing `version_number`, and uploads every entry with the existing `curl` call in a loop. A failed upload stops the loop and lists what is already published.
- **Launcher `modinstall`** (R5): `status(instance)` is `Unavailable` only for `Vanilla` or an empty `MOD_PROJECT_ID`. `install` queries the pinned project's versions with `loaders=[<instance loader>]` and `game_versions=[<instance MC>]`, takes the newest listed release, falls back from `quilt` to `fabric`, and installs Fabric API only for Fabric/Quilt (the existing dependency path).

### 3.8 How the launcher adapts to older versions
- **2.0:** no floor change. `MIN_MC_RELEASE_TIME` stays 1.20 (2023-06-02). Every 2.0 node is >= 1.20.
- **2.1 (R6):** the floor becomes 1.18 (release time read from Mojang's manifest and pinned with a test), and only after:
  1. `mcproto` Login Start golden vectors per family pass: 1.18.2 (name only), 1.19-1.19.2 (name, optional key+signature, optional UUID), 1.19.3-1.20.1 (name, optional UUID), 1.20.2+ (name, UUID), including one captured real 1.19.2 packet with a signature key, which must fit the 2 KiB host window (if not, the window grows to 4 KiB for login only).
  2. `launch_args.rs` emits `--server <ip> --port <n>` instead of `--quickPlayMultiplayer` for versions without `QuickPlayData` (< 1.20).
  3. `lan_detect` has table tests with real log lines from 1.18.2, 1.19.2 and 1.19.4 clients.
  4. The `versionUnsupported` texts use `MIN_MC_LABEL = "1.18"`.
- The floor is a single constant pair; a per-era floor table is not needed because every era from 1.18 up passes the same validator after step 1.

---

## 4. Discovery and connection (own launches and foreign games)

### 4.1 Connection paths
| Path | When the mod uses it | Key | Link kind | Approval |
|---|---|---|---|---|
| **Env v2** | env has `PUMPKIN_IPC_PORT`, `PUMPKIN_IPC_TOKEN` and `PUMPKIN_IPC_PROTOCOLS` containing `2` | env token | `instance` | none (the launch is the approval); share/friends scopes asked lazily |
| **Env v1** | env has port, token and `PUMPKIN_IPC_PROTOCOL=1` but no `PUMPKIN_IPC_PROTOCOLS` (a launcher older than 2.0) | env token, sent in `hello` | `instance` (v1) | as SPEC 7.4 |
| **Discovery** | no usable env, discovery file found with `state:"ready"` | file token | `external`, or `instance` when the OS owner PID is a running own launch | pairing prompt for `external` |

The launcher sets `PUMPKIN_IPC_PROTOCOL=1` (unchanged, 0.1.0 jars reject anything else) and adds `PUMPKIN_IPC_PROTOCOLS=1,2`. `launch_env` now returns the env for every loader except `Vanilla` (still only for Microsoft-account launches, `commands.rs:404`).

### 4.2 Discovery file
**Location** (launcher writes, mod reads; the mod resolves in this order and takes the first existing file):
1. JVM property `-Dpumpkin.bridge.discovery=<absolute file>`.
2. Env `PUMPKIN_DISCOVERY_FILE=<absolute file>`.
3. OS convention:
   - Windows: `%LOCALAPPDATA%\dev.laux.launcher\bridge\discovery.json` (Tauri `app_local_data_dir()` + `bridge`; Local, not Roaming).
   - Linux: `$XDG_RUNTIME_DIR/dev.laux.launcher/discovery.json`; if `XDG_RUNTIME_DIR` is unset or not writable, `${XDG_DATA_HOME:-~/.local/share}/dev.laux.launcher/bridge/discovery.json`. The mod tries both, runtime dir first.
   - macOS: `~/Library/Application Support/dev.laux.launcher/bridge/discovery.json`.

**Content** (UTF-8 JSON, one object, at most 1 KiB; unknown fields ignored):
```jsonc
// Friends on, "Spiele aus anderen Launchern erlauben" on, bridge listening
{"v":1,"state":"ready","port":51234,"token":"<64 lowercase hex>","launcherId":"<32 lowercase hex>",
 "protocols":[2],"pid":4242,"startedAt":1790000000,"launcher":"0.3.0"}
// Friends on, setting off
{"v":1,"state":"foreignOff","launcher":"0.3.0"}
```
No file exists while Friends is off, while the launcher is not running, or before the bridge has started.

**Write rules (`modbridge/discovery.rs`):**
- Atomic: write `discovery.json.tmp` in the same directory, set permissions, `fsync`, rename over the target.
- Unix: directory created with mode 0700, file 0600. At start, refuse (log, no file, foreign path disabled) a directory whose owner uid differs from `geteuid()` or whose mode allows group/other access.
- Windows: the directory inherits the `%LOCALAPPDATA%` ACL (user, SYSTEM, Administrators). No custom DACL.
- **Rotation:** a new token and `launcherId` on every `ModBridge::start()`, every toggle of the setting, and every launcher start. Old tokens stop working at once; links keep running (they are already authenticated).
- **Removal:** `ModBridge::stop()` (shutdown, Friends off) deletes the file. Turning the setting off rewrites it as `foreignOff` and closes every `external` link (`Exited` for their games, sessions end with `stopped`).
- **Stale file after a crash:** the mod treats it as a hint. The handshake decides (a dead port refuses; a foreign listener on that port fails the launcher proof).

**Mod read rules (`core/bridge/Discovery`):** re-read on every connect attempt and when the file's mtime changes; accept only `v == 1`, `port` in 1..65535, `token` `^[0-9a-f]{64}$`, `launcherId` `^[0-9a-f]{32}$`, `protocols` containing 2. On Unix, ignore a file not owned by the current user. `pid`/`startedAt` are logged only.

**Sandboxes:** Flatpak Prism cannot see either path. The launcher detects `~/.var/app/org.prismlauncher.PrismLauncher` on Linux and shows, under the setting, the one-time command with a copy button:
`flatpak override --user --filesystem=xdg-run/dev.laux.launcher:ro org.prismlauncher.PrismLauncher`.
Loopback works in Flatpak (shared network namespace). Snap: unsupported in 2.0 (no documented override; owner checklist notes it). WSL/VM/container: unsupported.

### 4.3 Handshake `attach` (protocol 2, both env v2 and discovery)
All hex is lowercase. `||` is byte concatenation. `label` is ASCII, followed by one `0x00` byte. Nonces are 32 random bytes (`SecureRandom` / `getrandom`). The HMAC key is the token's 32 raw bytes (hex-decoded).

```
keyId          = hex( SHA-256( "pumpkin/bridge/keyid/1" || 0x00 || token ) )[0..16]
launcherProof  = hex( HMAC-SHA256( token, "pumpkin/bridge/launcher/1" || 0x00 || nonceM || nonceL ) )
modProof       = hex( HMAC-SHA256( token, "pumpkin/bridge/mod/1"      || 0x00 || nonceL || nonceM ) )
```

| # | Direction | Line | Deadline |
|---|---|---|---|
| 1 | mod → L | `{"type":"attach","protocols":[2],"keyId":"<16 hex>","nonce":"<64 hex>","mod":"0.2.0","minecraft":"1.21.1","loader":"neoforge","loaderVersion":"21.1.77"}` | 2 s after connect (existing `HELLO_TIMEOUT`) |
| 2 | L → mod | `{"type":"attachChallenge","nonce":"<64 hex>","proof":"<launcherProof>"}` | |
| 3 | mod | verifies `proof` in constant time; on mismatch closes silently and backs off | |
| 4 | mod → L | `{"type":"attachProof","proof":"<modProof>"}` | 2 s |
| 5 | L | verifies in constant time; mismatch: close without a reply. Then OS checks (4.4). The unauthenticated slot is released here. | |
| 6 | L → mod | `{"type":"attachNeed","report":bool,"manifest":bool,"account":"<64 hex nonceA>"\|null}` | |
| 7 | mod → L | `gameReport` / `manifestPart`s / `accountProof` as asked (4.5, 4.6) | 10 s for report+manifest, 30 s for the account proof |
| 8 | L → mod | `{"type":"attachPending","stage":"approval"}` while the pairing prompt is open | 120 s |
| 9 | L → mod | `welcome` (5.2) or `{"type":"reject","reason":"..."}` then close | |

- Unknown `keyId`: close silently after step 1 (no oracle).
- `keyId` lookup table: the discovery token (if `state:"ready"`) and every live launch token. A launch token admits the `instance` link of its instance; the discovery token goes to 4.4.
- What the launcher asks in step 6: env-token links: `report:false, manifest:false, account:null`. Discovery links bound to an own launch (4.4 step 4): same. External links: `report:true, manifest:true, account:<nonceA>`; on a reconnect of a known `ProcessKey` (4.7): `report:true, manifest:false, account:null`.
- New `RejectReason` values (v2 only): `foreignOff`, `denied`, `account`, `notGame`, `busy`, `protocol`, `duplicate`. Mod behaviour per reason in 5.8.
- **Caps:** 4 connections before step 5 (existing), 2 links between step 5 and `welcome` (new; the 3rd gets `reject{busy}`), 1 open pairing prompt globally.
- **Golden vectors:** Appendix B. Rust (`modbridge/hmac.rs`, a 30-line RFC 2104 HMAC over the existing `sha2 = "0.11"`, plus RFC 4231 test case 2) and Java (`javax.crypto.Mac`) assert the same values.

### 4.4 OS trust chain (launcher, after step 5)
1. `sockowner::owner_of_connection(peer, local)` where `peer` is the accepted socket's peer address (the mod's client socket) and `local` the bridge listener address. It finds the TCP row with `local == peer` and `remote == local` (the client-side row, not the launcher's own server-side row) and returns its owner PID. Zero or more than one owner, or a lookup error: `reject{notGame}`.
2. `procinfo::same_user(pid)`: Windows compares the process token's user SID with ours (`OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)`, `OpenProcessToken`, `GetTokenInformation(TokenUser)`, `EqualSid`; any failure = not same user). Linux: uid of `/proc/<pid>/status`. macOS: `proc_pidinfo(PROC_PIDTBSDINFO)` uid. Not same user: `reject{notGame}`.
3. `procinfo::key(pid)` = `ProcessKey{pid, start}` (Windows `GetProcessTimes` creation time; Linux field 22 of `/proc/<pid>/stat`; macOS `pbi_start_tvsec/usec`) and `procinfo::exe_path(pid)` (`QueryFullProcessImageNameW`, `/proc/<pid>/exe`, `proc_pidpath`; display only).
4. **Env-token links:** if the owner PID differs from the instance's `Spawned.pid`, `reject{notGame}` (a token leaked to another process). If step 1 failed with an IO error on an env-token link, admit anyway and log once (keeps today's behaviour on platforms where the lookup is broken; the tunnel checks still use `Spawned.pid`).
   **Discovery links:** if the owner PID equals the `Spawned.pid` of a running own launch, bind to that instance (`instance` link, no pairing). Otherwise it is an `external` link; the setting must be on (else `reject{foreignOff}`), the `ProcessKey` must not be in the sticky-deny set (else `reject{denied}`).
5. **Link PID:** the PID from step 1 (for env links equal to `Spawned.pid`). Everything security-relevant uses it: `verify_port(link.pid, port)`, liveness `listens(link.pid, port)`, guest-side `connects_from(link.pid, client, listener)`. Same PID only, no process tree: the bridge socket and the integrated server live in the same JVM.
6. Before every `host.invite` that starts a session and before `invite.joinHere`, the launcher re-checks that the bridge connection is still owned by `link.pid` (`connects_from(link.pid, peer, local)`). While the connection is ESTABLISHED, the PID cannot be reused.

### 4.5 Game report (external links; self-asserted, never security-relevant)
```jsonc
{"type":"gameReport","minecraft":"1.21.1","loader":"neoforge","loaderVersion":"21.1.77",
 "player":{"name":"Steve","uuid":"<32 hex>"},"brand":"PrismLauncher","instanceLabel":"ATM10",
 "modCount":87,"manifestParts":3}
{"type":"manifestPart","index":0,"mods":[{"sha512":"<128 hex>","fileName":"sodium-0.6.jar"}, ...]}   // ≤ 150 per part
```
- `instanceLabel`: the name of the game directory's parent folder when the game dir is named `.minecraft` or `minecraft` (Prism, MultiMC layout), otherwise the game dir's own name; sanitised, at most 64 chars.
- Manifest: only top-level `*.jar` files of the loader's mods directory (`Platform.modsDir()`), at most 500, hashed off-thread at mod start (`ManifestScanner`), sorted by file name, `fileName` sanitised as a plain leaf. Includes `pumpkin_friends` itself. Forge `mods/<version>/` subfolders are not scanned (documented limitation: such games may show a false "missing content" for guests).
- The launcher validates with `manifest::validate` (loader known, version in `VersionIndex`, loader version format, sha512 format, at most 500, sanitised names). Failure does not reject the link; it marks the game `hostable:false` with reason `manifestInvalid` or `versionUnsupported`.
- `InstanceSummary.name` for invites = `sanitize::world_or_instance_name(instanceLabel)`, falling back to `"Minecraft {minecraft} ({loader})"`.

### 4.6 Account proof (external links)
1. Launcher sends `attachNeed.account = nonceA` (32 random bytes, hex).
2. Mod computes `serverId = hex( SHA-256( "pumpkin/mod-bridge-account/1" || 0x00 || launcherId || nonceA ) )[0..40]` (`launcherId` from the discovery file, 16 raw bytes) and calls `compat.Session.joinServer(serverId)` off the client thread, then sends `{"type":"accountProof","ok":true}` or `{"type":"accountProof","ok":false}`.
3. Launcher computes the same `serverId` (it never sends a raw server id, so it can never make the game authenticate to a third-party server) and calls `MojangSessions::has_joined(player.name, serverId)`.
4. Result:
   - Profile returned and its UUID equals `player.uuid`: proven. `online_account = true`. The pairing prompt shows the player as "von Mojang bestätigt". If the UUID is not one of the Microsoft accounts signed in to Pumpkin, the prompt adds the warning line "Dieses Konto ist nicht im Launcher angemeldet." (no reject).
   - `ok:false`, no profile, or a UUID mismatch: `reject{account}` (covers offline and cracked games).
   - Mojang unreachable or rate-limited: `reject{account}`; the mod retries on its backoff (max 30 s). At most 3 proofs per `ProcessKey` per 10 min.
5. The result is cached per `ProcessKey` for the process lifetime.
- Privacy: one `sessionserver.mojang.com` join per foreign game start, the same mechanism as joining an online-mode server. Named in `PRIVACY.md` and SPEC 12.1 (D0).

### 4.7 Lifecycle of an external game
- After `welcome`: the launcher registers `ExternalGame{game_id:"ext:<uuid v4>", key, exe_path, report, manifest, player}` and sends `GameSignal::ExternalAttached{game}` followed by `GameSignal::Spawned{instance_id: game_id, pid, online_account: true, friend_join: None}`. Presence switches to "playing" through the existing `status.rs` path.
- **Connection loss** keeps the game registered (`ModLinkState::Disconnected`). A reconnect from the same `ProcessKey` resumes the same `game_id`, keeps all grants, and skips the account proof and the prompt.
- **Liveness:** every 5 s `procinfo::alive(key)` (PID exists and start time equal). Dead: `GameSignal::Exited{instance_id: game_id}` (sessions end `gameExited`, joins end `gameExited`), grants and cached proof are forgotten.
- **LAN:** only the mod's `lanOpened{port}` hint exists (no stdout). It always goes through `verify_port(link.pid, port)`. `lanClosed` ends the session at once (as today). A share survives mod disconnects while the PID is alive and the port still listens (15 s liveness, as today).
- **Setting off / Friends off / launcher exit:** external links close; `Exited` for each external game; sessions end `stopped` (setting) or `disabled` / app exit as today.

### 4.8 Launcher UI for links (details in 9.5)
- Settings › Freunde: switch "Spiele aus anderen Launchern erlauben" (default off), Flatpak hint, and the section "Spiele mit Zugriff" (all links, own and foreign).
- Pairing prompt (global dialog, 9.5).
- Friends page: an "Laufende Spiele" card for external games with a running share (guest list, "Teilen beenden", "Entfernen").

---

## 5. Protocol v2

### 5.1 Framing and limits
- JSON objects, one per line, UTF-8, `\n`. Handshake lines (`attach` ... `welcome`) at most 16 KiB; after `welcome` at most **64 KiB** in both directions (`limits.maxLine`). A longer line closes the connection.
- Mod → launcher at most 20 messages/s (excess closes), at most 8 requests in flight (the 9th gets `res{busy}` without being run).
- Unknown `type`, unknown `op`, unknown fields: ignored (`type`) / `res{unsupportedOp}` (`op`) / ignored (fields). A malformed line after `welcome` is ignored and counts toward the rate.
- Ping: unchanged (`{"type":"ping"}` every 10 s from the mod when idle, `{"type":"pong"}`; 30 s silence closes).

### 5.2 `welcome`
```json
{"type":"welcome","protocol":2,"launcher":"0.3.0",
 "link":{"kind":"external","label":"ATM10 · Minecraft 1.21.1 (NeoForge)","player":"Steve"},
 "limits":{"maxLine":65536,"maxInFlight":8,"msgPerSec":20}}
```
`link.kind` is `instance` or `external`; `label` is the instance name or the external label; `player` is null for instance links. Directly after `welcome` the launcher sends every topic once (5.4).

### 5.3 Requests, responses, pending prompts
```jsonc
{"type":"req","id":"a1","op":"friend.addByName","args":{"name":"Steve"}}          // mod → L; id ^[a-z0-9]{1,12}$, unique in flight
{"type":"res","id":"a1","ok":true,"result":{"requestId":"r7"}}                      // L → mod
{"type":"res","id":"a1","ok":false,"error":{"code":"nameUnknown","params":{"name":"Steve"}}}
{"type":"pending","id":"a1","prompt":"scope","scope":"friends"}                     // L asks the user; final res follows
```
- `args` is always an object (`{}` when empty); `result` is an object or `null`.
- `pending.prompt` is `scope` (with `scope`), `pairing` (never for a req; handshake only), or `danger`. The final `res` follows within 125 s; an unanswered prompt gives `error.code = confirmTimeout`.
- Mod timeouts: 15 s per request without `pending`; 30 s for `friend.addByName`, `friend.addByCode`, `request.answer`, `invite.joinHere`, `invite.plan`; 130 s after a `pending`. A timed-out request shows `error.timeout` and its late `res` is dropped.

### 5.4 Topics (launcher → mod, pushed)
```json
{"type":"state","topic":"friends","rev":12,"value":[ ... ]}
```
- `rev` counts per topic per connection from 1. The mod replaces the whole value and ignores a `rev` not greater than its own.
- The launcher keeps a dirty set per link and sends the latest value of each dirty topic at most every 250 ms per topic. Topics never sit in the event queue and never drop.
- Worst case sizes (asserted by a Rust test that builds maximal values): `friends` 50 × ≤ 700 B ≈ 35 KiB; `requests` ≤ 100 × ≤ 450 B; `invites` 20 × ≤ 600 B. All below 60 KiB.

| Topic | `value` |
|---|---|
| `me` | `{"availability":"available"\|"noSecretStore"\|"identityLost","enabled":bool,"displayName":string\|null,"fingerprint":string\|null,"settings":{"displayName":string,"alwaysRelay":bool,"findableByName":bool},"network":{"state":"off"\|"starting"\|"online"\|"degraded","relayHost":string\|null},"directory":"unavailable"\|"off"\|"active"\|"unreachable"\|"notAllowed","limits":{"maxFriends":50,"maxGuests":7,"maxActiveCodes":3,"displayNameMin":3,"displayNameMax":32,"aliasMax":32,"mcNameMax":16}}` |
| `friends` | array of `{"id":"f1","name":string,"displayName":string,"alias":string\|null,"mcName":string\|null,"mcUuid":string\|null,"fingerprint":string,"presence":"offline"\|"online"\|"playing","path":"direct"\|"relay"\|null,"confirmed":bool,"removedByPeer":bool,"notice":{"type":"renamed","previousName":string}\|{"type":"identityChanged"}\|{"type":"addedInGame"}\|null,"lastSeen":u64\|null,"invitable":bool,"inviteId":"i2"\|null}` sorted by `name` (case-insensitive) |
| `requests` | array of `{"id":"r1","direction":"incoming"\|"outgoing","state":"pending"\|"delivering"\|"awaitingAnswer","via":"code"\|"name","name":string\|null,"mcName":string\|null,"fingerprint":string\|null,"codeTail":string\|null,"createdAt":u64,"expiresAt":u64}` |
| `invites` | array of `{"id":"i1","fromId":"f3"\|null,"fromName":string,"fromFingerprint":string,"title":string,"minecraft":string,"loader":"vanilla"\|"fabric"\|"quilt"\|"forge"\|"neoforge","loaderVersion":string\|null,"modCount":u32,"receivedAt":u64,"expiresAt":u64,"hostOnline":bool}` (at most 20) |
| `session` | `null` or `{"id":"s1","here":bool,"gameLabel":string,"port":u16,"worldName":string\|null,"showWorldName":bool,"startedAt":u64,"guests":[{"friendId":"f1","name":string,"state":"invited"\|"declined"\|"connected"\|"left","kicked":bool,"path":"direct"\|"relay"\|null,"rttMs":u32\|null}]}`; `here` = the session belongs to this link's game |
| `join` | `null` or `{"id":"j1","inviteId":"i1","hostName":string,"here":bool,"state":{"type":"waitingForGame"}\|{"type":"connecting"}\|{"type":"connected","path":"direct"\|"relay","rttMs":u32\|null}\|{"type":"ended","reason":"stopped"\|"kicked"\|"lanClosed"\|"hostOffline"\|"gameExited"\|"left"\|"disabled"\|"error"}}` |
| `game` | `{"hostable":bool,"reason":null\|"versionUnsupported"\|"msAccountRequired"\|"manifestInvalid","minMc":"1.20","lan":null\|{"port":u16,"verified":bool}}` |
| `scopes` | `{"join":bool,"share":bool,"friends":bool}` |

Ids are per-connection aliases: `f` friends (also guests and `fromId`), `r` requests, `i` invites, `c` codes, `b` blocked, `n` Pumpkin instances, `s` sessions, `j` joins, `p` audit entries. Peer ids, instance ids and paths never leave the launcher. Aliases are stable for the connection's lifetime (the same peer keeps its `f` alias).

All strings are sanitised by the launcher (SPEC 12.3) and again by the mod's `Sanitize` (caps: names 32, titles 64, labels 64).

### 5.5 Events (launcher → mod)
```json
{"type":"event","name":"notify","data":{"kind":"requestReceived","name":"Alex","mcUuid":null,"ref":"r4","reason":null}}
```
| `name` | `data` |
|---|---|
| `notify` | `kind`: `requestReceived`, `requestAccepted`, `requestRefused`, `inviteReceived`, `inviteRevoked`, `guestJoined`, `guestLeft`, `sessionEnded`, `joinEnded`, `friendOnline`, `actionUndone`, `scopeRevoked`; `name` string\|null; `mcUuid` string\|null; `ref` alias\|null; `reason` string\|null (`SessionEnd`, `RequestRefusal`, `InviteRevokedEvent.reason`, or the `ModAction` for `actionUndone`) |
| `scopes` | `{"join":bool,"share":bool,"friends":bool}` (also pushed as topic; the event triggers a toast) |
| `closing` | `{"reason":"foreignOff"\|"revoked"\|"disabled"\|"shutdown"}` sent just before the launcher closes a link on purpose |

Event queue per link: 32 entries; when full, the oldest event is dropped (logged). Responses never drop (bounded by in-flight 8). Write timeout 5 s closes the link (unchanged).

### 5.6 Mod → launcher messages besides `req`
| type | fields | meaning |
|---|---|---|
| `lanOpened` | `port` | hint, as v1 |
| `lanClosed` | | as v1 |
| `ping` | | as v1 |
| `join.failed` is an op (5.7), not a message | | |

### 5.7 Operation catalogue
Scope column: `-` read or exposure-reducing, no scope; `friends` / `share` / `join` per 6.2; `danger` = launcher confirmation every time (never grantable). Limit column: per link, sliding window (6.4).

| op | args | result | scope | limit | launcher call |
|---|---|---|---|---|---|
| `state.sync` | `{}` | `null` | - | 1/5 s | marks every topic dirty |
| `launcher.open` | `{"target":"friends"\|"addFriend"\|"requests"\|"invite"\|"settings"\|"gameAccess"\|"optIn","ref":alias\|null}` | `null` | - | 1/10 s | emits `friends-mod-open`, restores and focuses the window |
| `friends.retry` | `{}` | `null` | - | 1/10 s | `friends_retry_now` |
| `settings.update` | `{"displayName":string\|null,"findableByName":bool\|null,"alwaysRelay":bool\|null}` (null = unchanged) | `null` | `friends`; `danger` if `findableByName:true` or `alwaysRelay:false` | 5/10 min | `friends_update_settings` with the merged settings |
| `friends.disable` | `{}` | `null` | `danger` | prompts only | `friends_disable` (the link closes afterwards) |
| `identity.rotate` | `{}` | `null` | `danger` | prompts only | `friends_rotate_identity` |
| `identity.reset` | `{}` | `null` | `danger` | prompts only | `friends_reset` |
| `code.create` | `{}` | `{"codeId":"c1","code":string,"tail":string,"expiresAt":u64}` | `friends` | 3/10 min | `friend_code_create` (the only place a full code is sent) |
| `code.list` | `{}` | `{"codes":[{"id":"c1","tail":string,"createdAt":u64,"expiresAt":u64,"used":bool}]}` | - | | `friend_codes` (codes never sent again) |
| `code.revoke` | `{"codeId":"c1"}` | `null` | - | | `friend_code_revoke` |
| `friend.addByCode` | `{"code":string}` (≤ 80 chars) | `{"requestId":"r9"}` | `friends` | 5/10 min (shared with by-name) | `friend_add` |
| `friend.addByName` | `{"name":string}` (`^[A-Za-z0-9_]{1,16}$`) | `{"requestId":"r9"}` | `friends` | 5/10 min (shared) | `friend_add_by_name` |
| `request.answer` | `{"requestId":"r1","accept":bool}` | `null` | `friends` | accept 5/10 min, decline 10/10 min | `friend_request_answer` |
| `request.cancel` | `{"requestId":"r1"}` | `null` | - | | `friend_request_cancel` |
| `friend.rename` | `{"friendId":"f1","alias":string\|null}` | `null` | - | 10/10 min | `friend_rename` |
| `friend.acknowledge` | `{"friendId":"f1"}` | `null` | - | | `friend_acknowledge`; refused with `denied` when the notice is `addedInGame` (review stays a launcher action) |
| `friend.remove` | `{"friendId":"f1"}` | `null` | `friends` | 3/10 min (shared with block) | `friend_remove` |
| `friend.block` | `{"friendId":"f1"}` or `{"requestId":"r1"}` | `null` | `friends` | 3/10 min (shared) | `friend_block(peer_id)` |
| `blocked.list` | `{"offset":u32,"limit":u32}` (limit 1..50) | `{"items":[{"id":"b1","name":string,"blockedAt":u64}],"total":u32}` | - | | `friends_blocked` |
| `blocked.unblock` | `{"blockedId":"b1"}` | `null` | `friends` | 3/10 min | `friend_unblock` |
| `host.invite` | `{"friendIds":["f1"],"showWorldName":bool}` (1..7) | `{"sessionId":"s1"}` | `share` | 3/min | no session: `host_start` with the verified LAN port of this link's game; session of this game: `host_invite`; session of another game: `sessionActive` |
| `host.kick` | `{"friendId":"f1"}` | `null` | - | | `host_kick` (only the session of this game) |
| `host.stop` | `{}` | `null` | - | | `host_stop` (only the session of this game) |
| `invite.decline` | `{"inviteId":"i1"}` | `null` | - | | `invite_decline` |
| `invite.plan` | `{"inviteId":"i1"}` | `{"plan":ModJoinPlan}` | - | 10/min | 8.1 |
| `invite.joinHere` | `{"inviteId":"i1"}` | `{"joinId":"j1","host":"127.a.b.c","port":u16}` | `join` | 3/min | 8.2 |
| `invite.joinLaunch` | `{"inviteId":"i1","instanceId":"n1"\|null,"createVanilla":bool}` | `null` | `join` | 3/min | 8.4 |
| `join.leave` | `{"joinId":"j1"}` | `null` | - | | `join_leave` |
| `join.failed` | `{"joinId":"j1"}` | `null` | - | | ends a join of this link that has no valid connection yet (`error`) |
| `friend.faces` | `{"ids":["f1"]}` | - | - | | 2.0: always `unsupportedOp` (reserved) |

`ModJoinPlan`:
```jsonc
{"verdict":"ready"|"missingContent"|"noInstance"|"versionUnsupported",
 "here":{"matches":bool,"missing":[ModRef],"extra":[ModRef]}|null,       // this running game (null: not comparable, e.g. vanilla game for a modded host)
 "candidates":[{"instanceId":"n1","name":string,"matches":bool,"missingCount":u32,"extraCount":u32}],   // Pumpkin instances, at most 20
 "createVanilla":bool,"lookupFailed":bool,"minMc":"1.20"}
// ModRef = {"title":string,"fileName":string}; missing/extra lists capped at 20 each, plus "missingMore"/"extraMore" counts
```

### 5.8 Errors
`error.code` values (the mod's `ErrorCode` enum lists exactly these; unknown codes show `pumpkin_friends.error.unknown`):
- Mirrors of `errors.friends.*`: `notEnabled`, `unavailable`, `identityLost`, `msAccountRequired`, `networkUnavailable`, `displayNameInvalid{min,max}`, `codeInvalid`, `codeUsed`, `codeOwn`, `tooManyCodes{max}`, `alreadyFriends`, `alreadyRequested`, `friendLimit{max}`, `requestsFull`, `rateLimited`, `peerOffline`, `protocolUnsupported`, `notFound{kind}` (`kind`: `friend`, `request`, `invite`, `code`, `blocked`, `session`, `join`, `instance`), `gameNotRunning`, `versionUnsupported{min}`, `lanPortUnknown`, `portNotGame`, `lanUnreachable`, `sessionActive`, `guestLimit{max}`, `inviteExpired`, `notInvited`, `instanceMismatch`, `manifestInvalid`, `tunnelFailed`, `hostStopped`, `nameInvalid`, `nameUnknown{name}`, `nameNotFindable{name}`, `nameOwn`, `alreadyRequestedName{name}`, `tooManyNameRequests{max}`, `nameCooldown{days}`, `directoryUnavailable`, `directoryNotAllowed`, `reloginRequired`.
- Bridge codes: `denied`, `busy`, `scopeRequired{scope}` (only when a prompt cannot be shown because another is open), `confirmTimeout`, `unsupportedOp`, `invalidArgs`, `gameUnverified`, `internal`.
- Mod-local codes (never on the wire): `timeout`, `notConnected`.
- `params` values are typed: `name` string (sanitised, ≤ 32), `min`/`max`/`days` integer, `scope` scope name, `kind` enum above. Mapping from a launcher `AppError`: `Coded` key suffix after `errors.friends.` → code, params copied by name; anything not in the list → `internal` (logged with the key).
- `reject.reason` handling in the mod: `foreignOff` → status "In Pumpkin unter Einstellungen › Freunde erlauben", retry when the file changes; `denied` → "Im Launcher abgelehnt", no retry until the game restarts; `account` → "Konto nicht bestätigt (Offline-Konto?)", backoff; `notGame` → log, backoff 30 s; `busy`/`duplicate` → backoff; `protocol` → "Launcher aktualisieren", no retry.

### 5.9 v1 compatibility
| Mod | Launcher | Result |
|---|---|---|
| 0.1.0 (v1) | 2.0 launcher, own launch | `hello` path byte-identical to today (SPEC 7); env still has `PUMPKIN_IPC_PROTOCOL=1` |
| 0.1.0 | foreign game | inert (no env), as today |
| 0.2.0 | 2.0 launcher | `attach` v2 |
| 0.2.0 | pre-2.0 launcher, own launch | env without `PUMPKIN_IPC_PROTOCOLS`: the mod sends v1 `hello{protocols:[1]}` and runs **v1 mode**: friends list, invites read-only, share/kick/stop, toasts; every other screen shows "Launcher aktualisieren, um das im Spiel zu nutzen" |
| 0.2.0 | pre-2.0 launcher, foreign game | no discovery file: hub says "Starte den Pumpkin Launcher (ab Version 0.3) auf diesem PC" |

The v1 mode lives in `core/bridge/V1Adapter`: it translates v1 `snapshot`/`notify`/`error` into the v2 `TopicStore` (topics `friends`, `invites`, `session`; others empty) and maps the three v1 actions; every other op fails locally with `protocolUnsupported`.

---

## 6. Consent scopes and abuse analysis

This section replaces SPEC 7.4 ("no accept over the mod channel"). The owner requires accepting in-game; the design therefore moves from "forbid" to "ask once, show everything, allow undo, cap the rate".

### 6.1 Threat baseline
A hostile mod in the same JVM can already read the Minecraft access token from the game arguments (impersonate the player on servers, change the skin, read chat), read the env token or the discovery file, and drive the bridge exactly like our mod. It cannot read the launcher's memory, the keyring, or the friends identity key. Same-user malware outside the game has the same file access but no Minecraft session unless it steals one; it is out of scope as in SPEC 7.1. Other OS users and remote hosts must gain nothing.

### 6.2 Scopes
| Scope | Covers | Own launch (env) | External link |
|---|---|---|---|
| read (implicit) | all topics, `code.list`, `blocked.list`, `invite.plan`, `launcher.open`, `friends.retry`, `state.sync` | granted | granted after pairing |
| exposure-reducing (implicit) | `host.kick`, `host.stop`, `invite.decline`, `join.leave`, `join.failed`, `request.cancel`, `code.revoke`, `friend.rename`, `friend.acknowledge` (not for `addedInGame`) | granted | granted after pairing |
| `join` | `invite.joinHere`, `invite.joinLaunch` | granted | pairing checkbox, ticked by default |
| `share` | `host.invite` | asked on first use (the v1 first-share prompt) | pairing checkbox, unticked by default; else asked on first use |
| `friends` | `friend.addByCode`, `friend.addByName`, `request.answer`, `code.create`, `friend.remove`, `friend.block`, `blocked.unblock`, `settings.update` (displayName, findable off, relay on) | asked on first use | pairing checkbox, unticked by default; else asked on first use |
| `danger` (never grantable) | `friends.disable`, `identity.rotate`, `identity.reset`, `settings.update` with `findableByName:true` or `alwaysRelay:false` | asked every time | asked every time |
| launcher only | first opt-in (`friends_enable`), relay consent, `friends_mod_install`, copying the full peer id, reviewing `addedInGame`, revoking scopes | - | - |

- **Scope prompt** (kind `scope`): names the game, the scope in plain words and the concrete first action with launcher-owned data, e.g. "ATM10 (Prism) möchte eine Freundschaftsanfrage von **Alex** (Fingerabdruck 4F2A-91C0) annehmen." Buttons: "Ablehnen" (initial focus), "Nur diesmal", "Für dieses Spiel". "Nur diesmal" runs the one action without granting.
- **Danger prompt** (kind `danger`): names the game and the action with its consequence text from the launcher's own dialogs (e.g. the reset warning). Buttons: "Ablehnen" (initial focus), "Ausführen". The launcher window is restored and focused.
- **Pairing prompt** (kind `pairing`): 9.5.
- Grants live as long as the link's process (`ProcessKey`, or the instance launch for env links). Reconnects keep them; game exit, "Trennen", "Entziehen", Friends off, and identity rotate/reset clear them.
- A denied scope prompt answers `denied`; the next use of that scope may prompt again (subject to 6.4).
- `share` granted by "Für dieses Spiel" replaces today's "first share per launch" allow; the 3-per-minute limit stays.

### 6.3 Visibility, audit and undo
- **Audit** (`mod_link/audit.rs`): every op of scope `friends`, `share`, `join` and `danger`, and every denial, appends a `ModAuditEntry` to an in-memory ring of 200 and to `<app_data>/friends/mod-audit.json` (entries older than 7 days dropped on write; written atomically; no secrets, no codes, no ids beyond the local audit id).
- **Launcher toast** for every successful `friends`-scope op: "{game}: {action} {target}" with "Rückgängig" while undo is possible (10 min), via event `friends-mod-action`.

| In-game action | Undo in the launcher | Notes |
|---|---|---|
| accept request | `friend_remove` | the peer sees a removal |
| add by code / by name | `friend_request_cancel` while the request is outgoing | after the peer accepted: review notice instead |
| code create | `friend_code_revoke` | |
| unblock | re-block (`friend_block` with the stored peer id; new internal `friends::block_peer(peer_id, name)` because the peer is no longer a friend or request) | |
| block | `friend_unblock` | |
| display name change | `friends_update_settings` with the previous name | |
| findable off / relay on | set back (these are privacy-increasing; undo is a danger-free launcher action) | |
| decline request, remove friend | no undo (the request or friendship is gone); audit only | rate-limited 10/10 min and 3/10 min |
| share, join | no undo; "Teilen beenden" / "Verlassen" in the launcher | |

- **Review notice:** a friendship that becomes confirmed because of an in-game op (accept in-game, or an outgoing request created in-game that the peer accepts later) gets `FriendNotice::AddedInGame{game_label}`. The Friends page shows it as a badge with "Behalten" (`friend_acknowledge`) and "Entfernen" (`friend_remove`). The mod shows the notice as "Im Spiel hinzugefügt" but cannot clear it.
- **Game access section** (9.5) lists every link with its scopes ("Entziehen" per scope), "Trennen" (close the link, clear grants; an external game needs pairing again on reconnect), and its last 20 audit entries.

### 6.4 Rate limits (per link, sliding window; exceeded → `rateLimited`)
| Action | Limit |
|---|---|
| `request.answer` accept | 5 / 10 min |
| `request.answer` decline | 10 / 10 min |
| `friend.addByCode` + `friend.addByName` | 5 / 10 min |
| `code.create` | 3 / 10 min |
| `friend.remove` + `friend.block` | 3 / 10 min |
| `blocked.unblock` | 3 / 10 min |
| `settings.update` | 5 / 10 min |
| `friend.rename` | 10 / 10 min |
| `host.invite` | 3 / min |
| `invite.joinHere` + `invite.joinLaunch` | 3 / min |
| `invite.plan` | 10 / min |
| `launcher.open`, `friends.retry` | 1 / 10 s |
| prompts (scope + danger) | 1 open per link, 3 per link per 10 min; above that, prompts auto-deny for 10 min without showing |
| pairing | 1 open globally; a denial is sticky for that `ProcessKey`; 3 denials for the same exe path within 1 h → silent `reject{denied}` for that path for 10 min |
| account proofs | 3 per `ProcessKey` per 10 min |

The existing global limits of SPEC 12.4 (by-name, codes, requests) still apply on top.

### 6.5 Abuse analysis
| # | Attacker | Abuse | Effect | Control | Residual |
|---|---|---|---|---|---|
| A1 | hostile mod in a granted game | redeem the attacker's code or request the attacker by name; attacker accepts | attacker becomes a friend: presence and (unless "Immer über Relay") IP while the launcher runs | `friends` scope prompt naming the action, launcher toast with undo, `addedInGame` review badge, 5/10 min | **cannot be prevented** once `friends` is granted "für dieses Spiel"; visible and undoable |
| A2 | same | accept a pending request from the attacker | same as A1 | same | same |
| A3 | same | read lists | friends' names, Minecraft names, fingerprints leak | accepted: same data the mod already sees on screen; peer ids never leave the launcher | accepted |
| A4 | same | remove or block friends | annoyance, not undoable for remove | scope, 3/10 min, audit | at most 3 per 10 min |
| A5 | same | share the world with an attacker friend | griefing of that world | needs A1 first; `share` scope; host sees guests in the launcher; kick/stop | needs two steps the user sees |
| A6 | same | prompt spam / phishing | dialog fatigue | caps (6.4); prompts show only launcher-owned data; "Ablehnen" has the initial focus | bounded |
| A7 | same | identity ops, disable, privacy-reducing settings | data loss / exposure | `danger` prompt every time, never grantable | user must click "Ausführen" |
| A8 | same | redirect the game to a server | - | the mod connects only to `host` in 127.0.0.0/8 returned by `invite.joinHere` | none |
| A9 | same | hide its traces | - | `addedInGame` cannot be acknowledged in-game; audit lives in the launcher | none |
| A10 | hostile mod in **any** game, setting on | attach as external game | a pairing prompt | account proof first (offline games never prompt), pairing prompt with OS facts, sticky denial, default OFF | user must approve |
| A11 | same-user non-game process | read the file, attach | pairing prompt showing its own exe | needs a valid Minecraft session for the account proof; exe path shown from the OS | same-user malware out of scope |
| A12 | another OS user | read the file / guess token / connect | nothing | file ACL / 0700, 256-bit token + HMAC, SID/uid check | none |
| A13 | port squatter (launcher crashed, other process binds the old port) | feed the mod fake UI, learn the token | nothing | mutual HMAC: the squatter cannot produce `launcherProof`; the token never crosses the wire | none |
| A14 | process with a leaked env token | attach as an own launch | - | owner PID must equal `Spawned.pid` | none |
| A15 | external game lies in its report | wrong version, mods, label | guests see wrong matching; hosting refused if the version is too old | tunnel safety rests on `link.pid` only; the host's integrated server rejects mismatched clients at login | cosmetic |
| A16 | PID reuse after game exit | another process inherits trust | - | `ProcessKey` (pid + start time), 5 s liveness, re-check of the connection owner before share and join | none |

---

## 7. In-game parity and UI

### 7.1 Parity table
Classes: **P** parity; **PS** parity behind a scope granted once per game; **PC** parity, launcher confirms every time; **L** launcher only (reason given).

| Launcher capability (command/event) | In-game form | Class |
|---|---|---|
| `friends_state` | status lines, gates, Optionen header | P |
| `friends_enable` | "Freunde sind im Launcher aus" + "Im Launcher öffnen" (only possible while a link exists, i.e. never before the first opt-in; then the hub shows the instructions text) | L: no bridge before the opt-in (SPEC 12.1), relay and privacy consent |
| `friends_disable` | Optionen › Gefahrenbereich › "Freunde ausschalten…" | PC |
| `friends_update_settings` displayName | Optionen › Anzeigename (EditBox + Speichern) | PS friends |
| findable off / alwaysRelay on | Optionen toggles | PS friends |
| findable on / alwaysRelay off | Optionen toggles | PC |
| `friends_rotate_identity`, `friends_reset` | Gefahrenbereich | PC |
| `friends_list`, `friend-presence` | Freunde tab | P |
| `friend_requests`, `friend-request(-refused)` | Anfragen tab, toasts | P |
| `friend_code_create` | Hinzufügen › Mein Code › "Neuen Code erstellen" + "Kopieren" | PS friends |
| `friend_codes`, `friend_code_revoke` | Mein Code list, "Widerrufen" | P |
| `friend_add` | Hinzufügen › Code eingeben | PS friends |
| `friend_add_by_name` | Hinzufügen › Per Name (default tab; hidden when `directory` is `unavailable`) | PS friends |
| `friend_request_answer` | Annehmen / Ablehnen | PS friends |
| `friend_request_cancel` | Zurückziehen | P |
| `friend_rename` | "…" › Umbenennen | P |
| `friend_acknowledge` | "OK" on renamed / identityChanged notices | P (not for `addedInGame`: L, review) |
| `friend_remove`, `friend_block` | "…" › Entfernen / Blockieren (ConfirmFlow) | PS friends |
| `friend_unblock`, `friends_blocked` | Optionen › Blockierte… | PS friends / P |
| `friends_retry_now` | Anfragen › "Jetzt zustellen" | P |
| `friend_skin` | not in 2.0 (names only) | later |
| `lan_status`, `lan-changed` | Teilen tab "Port N · geprüft" | P |
| `host_start`, `host_invite` | Teilen › Für Freunde öffnen / Einladen / Weitere einladen / Erneut einladen | PS share |
| `host_kick`, `host_stop`, `host-session(-ended)` | Teilen › Entfernen / Teilen beenden, toasts | P |
| `invites_list`, `friend-invite(-revoked)` | Einladungen tab, toasts | P |
| `invite_decline` | Ablehnen | P |
| `invite_plan` | InviteScreen | P |
| `invite_join` | InviteScreen › Beitreten (8.2) / Passende Instanz starten (8.4) | PS join |
| `join_leave`, `join-session` | Teilen tab "Bei {name}" + Verlassen | P |
| `friends_mod_status`, `friends_mod_install` | - | L: installs files / describes the mod itself |
| `friends_mod_answer`, `friends_mod_revoke`, `friends_mod_links`, `friends_mod_audit`, `friends_mod_undo` | Optionen › Spiel-Zugriff shows the scopes read-only + "Im Launcher verwalten" | L: these are the consent itself |
| full peer id copy, relay list, third-party relay consent | Optionen shows fingerprint and "Verbunden über {relayHost}" read-only | L |

### 7.2 Entry points
- **Pause menu:** button "Pumpkin Friends" (exists today), shown whenever the mod is not inert (also while disconnected, then the hub explains). Placed idempotently below the last vanilla button column; skipped when it would overlap a widget.
- **Title screen:** 20×20 text button labelled `PF` (no texture) left of "Mehrspieler"; skipped when overlapping (e.g. Mojang's `FriendsButton` on 26.2+ or another mod's button). Mod config `titleButton` (default true).
- **Keybinding** "Pumpkin Friends öffnen", category "Pumpkin Friends", unbound by default.
- All entry points open `HubScreen` on the tab with pending items first: Anfragen if incoming requests exist, else Einladungen if invites exist, else Freunde.

### 7.3 Screens and navigation
Design size 320×240 GUI px (also checked at 427×240, 480×270, 640×360, 960×540). Content width `cw = min(310, width - 20)`, centered. Row height 24 px (36 px two-line). Buttons 20 px high; row action buttons 60 px; "…" 20 px. Text clipped with "…" and full-text tooltip (from 1.19.3; earlier versions show the full text in the narration only).

```
HubScreen  (title "Pumpkin Friends" · status line · TabBar · ScrollPane · footer)
├─ Freunde        rows: name · sub-line (presence/Relay/notice) · [Beitreten|Einladen] · […]
│   ├─ […] → FriendActionsScreen: Umbenennen · Fingerabdruck · Entfernen · Blockieren   (ConfirmFlow for the last two)
│   └─ footer: [Freund hinzufügen] → AddFriendScreen (TabBar: Per Name | Code eingeben | Mein Code)
├─ Anfragen (n)   incoming: name · "Minecraft: {mcName}" · fingerprint (2 groups) · [Annehmen][Ablehnen][…→Blockieren]
│                 outgoing: requestLine text · [Zurückziehen]   footer: [Jetzt zustellen] (disabled 10 s after use)
├─ Einladungen (n) rows: "{fromName} · {title} · {mc} {loader}" · [Ansehen → InviteScreen] [Ablehnen]
├─ Teilen         state machine (7.4)
└─ Optionen       Anzeigename · Per Name auffindbar · Immer über Relay · Blockierte… · Fingerabdruck · Netzwerkzeile
                  · Toasts (online / Anfragen / Einladungen) · Titelbildschirm-Knopf · Spiel-Zugriff (scopes, "Im Launcher verwalten")
                  · Gefahrenbereich: Identität erneuern… · Zurücksetzen… · Freunde ausschalten…
LauncherWaitScreen  "Bestätige im Pumpkin Launcher" + spinner text + [Abbrechen] (shown on `pending`; Abbrechen only stops waiting)
ConfirmFlow        in-game yes/no screen for destructive in-game steps (remove, block, leave world), built from the kit
```
- Footer of every screen: "Fertig" (Esc goes to the parent screen; the hub returns to the screen it was opened from).
- Keyboard: Tab/Shift+Tab focus order follows visual order; Ctrl+Tab / Ctrl+Shift+Tab switch tabs; Ctrl+1..5 jump to a tab; Enter in an `EditBox` submits; PageUp/PageDown/mouse wheel scroll the pane.
- Narration: every row is a focusable button-like widget whose narration is "{name}, {presence}, {path}; Aktionen: {actions}"; "…" narrates "Weitere Aktionen für {name}".
- Text: all UI text through `pumpkin_friends.*` keys in `en_us` and `de_de`; names only via `Texts.literal(Sanitize...)`. Errors inline with a "⚠" prefix (never colour alone) plus a system toast for async results.

**States shown by the hub (status line + body):**
| State | Body |
|---|---|
| inert (no env, no file) | "Pumpkin Launcher nicht gefunden. Starte ihn auf diesem PC; die Verbindung kommt von selbst." |
| `foreignOff` | "Im Pumpkin Launcher unter Einstellungen › Freunde „Spiele aus anderen Launchern erlauben" einschalten." |
| connecting / backoff | "Verbinde mit dem Launcher…" |
| pairing pending | "Bestätige dieses Spiel im Pumpkin Launcher." |
| rejected `denied` / `account` / `protocol` | the texts of 5.8 |
| v1 mode | v1 features + "Launcher aktualisieren" notes |
| `me.enabled == false` | "Pumpkin Friends ist im Launcher ausgeschaltet." + [Im Launcher öffnen] (`launcher.open{optIn}`) |
| `availability` `identityLost` / `noSecretStore` | status text + [Im Launcher öffnen] |
| loading | "Lade…" until the first `state` of each topic arrived |
| empty lists | "Noch keine Freunde" (+ add button), "Keine offenen Anfragen", "Keine Einladungen" |

### 7.4 Teilen tab state machine
| Condition | Shows |
|---|---|
| on a multiplayer server | "Auf Servern nicht möglich." |
| `game.hostable == false` | reason text (`versionUnsupported{min}`, `msAccountRequired`, `manifestInvalid`) |
| `join` topic `here == true` | "Bei {hostName} · {path} · {rtt} ms" + [Verlassen] |
| singleplayer, not published | [Für Freunde öffnen] → `compat.Lan.publish(freePort)` (no commands for guests), then wait for `game.lan.verified` |
| published, no session here | "Port N · geprüft" + checkboxes (toggle buttons) of `invitable` friends (max 7) + "Weltname zeigen" toggle + [Einladen] → `host.invite` |
| session here | guests (state, path, RTT, [Entfernen]; "Erneut einladen" for declined/kicked) + [Weitere einladen] + [Teilen beenden] → `host.stop` then `compat.Lan.unpublish()` |
| session of another game | "Gerade teilt {gameLabel}." |

### 7.5 Per-version widget kit contract (`ui/kit`, version-free, built on `compat`)
- `PumpkinScreen extends CompatScreen`: owns `cw`, a header (title + status line), a body rectangle and a footer row; `relayout()` recomputes all positions from `width`/`height` on every `build()`.
- `TabBar`: one `Button` per tab (selected tab rendered with the label "[Name]" and `active=false`), wraps to two rows below 300 px.
- `ScrollPane`: holds rows (`Row` = list of widgets + height); positions visible rows inside the body rectangle, sets `visible=false` on rows outside it, scrolls by whole rows (wheel, PageUp/PageDown, focus change keeps the focused row visible); draws a 2-px scrollbar with `Painter.fill`.
- `Rows`: builders for the row types (friend, request, invite, guest, code, blocked) from topic records.
- `Fit`: clip text to a width with "…", using `Font.width` (stable API).
- Allowed vanilla calls in `ui/`: constructors and methods named in 3.4 rule 3, `Font.width`, `Minecraft.getInstance().font`. Everything else goes through `compat/`.
- Per-era tests: the fingerprint job (3.6) plus the owner checklist; no Minecraft in unit tests.

---

## 8. In-game join flows

### 8.1 `invite.plan`
- Own launch (`instance` link): the existing `matching::plan(invite, manifest, instances, local, classification)` with the running instance placed first; `here` is that instance's candidate.
- External link: `matching::plan` against a synthetic `Instance` built from the report (`minecraft`, `loader`, `loaderVersion`) and the reported manifest through a `ReportedHashes: LocalHashes` adapter, plus Pumpkin's own instances as further candidates.
- Host version below the floor: `verdict: versionUnsupported`, `minMc`.

### 8.2 Join into the running game (`invite.joinHere`, verdict for `here` is "matches")
Launcher (`joining::invite_join_here(invite_id, game)`):
1. Scope `join`; rate limit; the invite is open; the host is reachable (dial 8 s, else `peerOffline`); `here` still matches (else `instanceMismatch`); re-check the bridge connection owner (4.4 step 6).
2. Bind the single-owner listener (`127.a.b.c:0`; macOS `127.0.0.1:0`).
3. Create the join with `game_pid = link.pid` immediately: no spawn wait; state `connecting`; first-connection timer **120 s** (`JoinTimers.first_connection_here`).
4. Reply `{joinId, host, port}`. Every other rule of SPEC 6.2 (single-owner listener, PID check `connects_from(link.pid, client)`, nonce check, limits, end triggers) is unchanged. One join at a time (a new join ends the old one with `left`).
5. Nonce check addition: when the listener IP is `127.0.0.1` (macOS), the handshake host `localhost` is also accepted (pre-1.20.2 clients may send a reverse-resolved name; the PID check is the security check).

Mod (`client/JoinFlow`):
1. Validates `host` is an IPv4 literal in 127.0.0.0/8 and `1 <= port <= 65535`; otherwise sends `join.failed` and shows `error.internal`.
2. If in a world: ConfirmFlow "Welt verlassen und beitreten?" (plus "Das beendet dein Teilen." while hosting). Cancel → `join.leave`.
3. `compat.Connect.leaveWorld(() -> compat.Connect.connect(host, port, inviteTitle))`.
4. If the connect screen ends in a disconnect screen before the server's login success, or no connection within 30 s: `join.failed{joinId}`.
5. While joined, the Teilen tab shows the `join` topic; "Verlassen" disconnects the game (vanilla disconnect) and sends `join.leave`.

### 8.3 `compat.Connect` per family
| Versions | `ServerData` ctor | `ConnectScreen.startConnecting` | Leave world |
|---|---|---|---|
| 1.18.2 | `(name, ip, false)` | `(parent, mc, ServerAddress, ServerData)` | `level.disconnect(); mc.clearLevel(new GenericDirtMessageScreen(..))` |
| 1.19-1.19.4 | `(name, ip, false)` | same 4 args | same |
| 1.20-1.20.1 | `(name, ip, false)` | `(.., ServerData, boolean quickPlay=false)` | same |
| 1.20.2-1.20.4 | `(name, ip, ServerData.Type.OTHER)` | 5 args | `mc.disconnect(new GenericDirtMessageScreen(..))` |
| 1.20.5-1.21.x | `Type.OTHER` | 6 args (`TransferState` null) | `mc.disconnect(new GenericMessageScreen(..))` (`level.disconnect(Component)` where present) |
| 26.1-26.3 | current names | as the 26.3 code today | as today |
The connect never writes `servers.dat`. The `ServerAddress` host is the literal IP string.

### 8.4 Join with a Pumpkin instance (`invite.joinLaunch`)
- The launcher emits `friends-mod-join-launch{inviteId, instanceId, createVanilla}`; `FriendDialogs` runs the existing `usePlay` path (install if needed → `invite_join` → `instance_launch` with `friendJoin`) and shows a launcher toast. The running game stays open; the mod says "Der Launcher startet {instance}. Dieses Spiel bleibt offen."
- `instanceId` must be an `n` alias from the plan's candidates; `createVanilla` only when the plan says so.
- "Im Launcher öffnen" (missing mods, version mismatch) → `launcher.open{target:"invite", ref:"i1"}`; the launcher opens the InviteDialog for that invite.
- Foreign launchers are never driven: there is no "start in Prism".

---

## 9. Launcher-side changes

### 9.1 Rust modules
| Module | Change |
|---|---|
| `services/sockowner/{mod,windows,linux,macos}.rs` | `pub fn owner_of_connection(client: SocketAddr, server: SocketAddr) -> io::Result<Option<u32>>` (Some only for exactly one owner; `Err` on lookup failure; ambiguity → `Ok(None)`), with a `ConnectionOwners` trait seam next to `SocketTable`. Windows: scan the owner-PID TCP tables (v4 + v6) for `local == client && remote == server`. Linux: inode from `/proc/net/tcp{,6}` row, then scan `/proc/<pid>/fd` of PIDs with our uid for `socket:[inode]`. macOS: `lsof -nP -iTCP@<client ip>:<client port> -sTCP:ESTABLISHED -F pn` and pick the row whose name is `client->server`. |
| `services/procinfo/{mod,windows,linux,macos}.rs` (new) | `pub struct ProcessKey { pub pid: u32, pub start: u64 }` (start in OS ticks/µs, opaque), `pub fn key(pid) -> io::Result<ProcessKey>`, `pub fn alive(key: &ProcessKey) -> bool`, `pub fn same_user(pid) -> io::Result<bool>`, `pub fn exe_path(pid) -> io::Result<PathBuf>`. Trait `ProcInfo` for tests. windows-sys features added: `Win32_Foundation`, `Win32_Security`, `Win32_System_Threading`. macOS via `libc::proc_pidinfo`/`proc_pidpath`. |
| `services/modbridge/hmac.rs` (new) | `hmac_sha256(key, parts: &[&[u8]]) -> [u8; 32]`, `key_id(token)`, `launcher_proof`, `mod_proof`, `account_server_id(launcher_id, nonce)`, constant-time compare. RFC 4231 case 2 + Appendix B tests. |
| `services/modbridge/discovery.rs` (new) | path resolution (4.2), `write_ready`, `write_foreign_off`, `remove`, permission checks; `DiscoveryPaths` seam for tests. |
| `services/modbridge/protocol.rs` | v2 handshake types (`Attach`, `AttachChallenge`, `AttachProof`, `AttachNeed`, `GameReport`, `ManifestPart`, `AccountProof`, `AttachPending`, `WelcomeV2`), `RejectReason` gains `ForeignOff`, `Denied`, `Account`, `NotGame`, `Busy`; `ModRequestV2 { id, op, args: serde_json::Value }`, `ModResponse`, `ModState { topic, rev, value }`, `ModEvent`; `MAX_LINE_BYTES_V2 = 65_536`. v1 types unchanged. |
| `services/modbridge/{mod,server,connection}.rs` | `Launch.token` → `Binding { Token(String), Process(ProcessKey) }`; `start(paths)` writes discovery; `set_foreign(bool)`; `links() -> Vec<LinkInfo>`; `close_link(id, reason)`; first-line branch `hello` (v1, unchanged) vs `attach` (v2); per-link writer with response queue, dirty-topic map and event queue (5.4/5.5); in-flight cap 8; `launch_env` for all loaders except Vanilla plus `PUMPKIN_IPC_PROTOCOLS=1,2`. v2 requests become `GameSignal::ModCall`. |
| `services/modbridge/foreign.rs` (new) | external attach state machine (4.3 steps 5-9), `ForeignDeps { owners: Arc<dyn ConnectionOwners>, procs: Arc<dyn ProcInfo>, mojang: Arc<dyn MojangSessions>, approver: Arc<dyn PairingApprover> }`, pending cap 2, sticky denials, proof cache, `ExternalGames` registry, liveness watcher (5 s). |
| `services/gamesignal.rs` | `ExternalGame` struct; `GameSignal::ExternalAttached { game: ExternalGame }`; `GameSignal::ModCall { link: LinkRef, call: ModCall }` with `ModCall { op: String, args: serde_json::Value, reply: ModReply }` (`ModReply` wraps a oneshot sender of `Result<serde_json::Value, ModCallError>` plus a `pending(prompt)` notifier); `LinkRef { link_id: String, instance_id: String, pid: u32, kind: LinkKind }`. |
| `services/friends/mod_link/` (replaces `mod_link.rs`) | `mod.rs` (`ModLink` facade, v1 snapshot path kept), `dispatch.rs` (op → handler, arg validation, alias resolution), `ops_friends.rs`, `ops_host.rs`, `ops_join.rs`, `topics.rs` (builds the 8 topics, dirty tracking from `SessionEvent` and friends events), `aliases.rs`, `consent.rs` (scopes, prompts, rate limits), `audit.rs` (ring, file, undo). |
| `services/friends/games.rs` (new) | `RunningGames`: `instance_id → GameInfo { pid, online_account, source: GameSource::{Instance, External(ExternalGame)} }`; replaces `hosting.games`' `Game`; `hostable(game) -> Result<(), AppError>`. |
| `services/friends/hosting.rs` | uses `RunningGames`; `supported_instance`/`build_manifest` branch on `GameSource` (external: reported manifest, `manifest::validate`); `HostSession.game_label`. |
| `services/friends/joining.rs` | `invite_join_here(invite_id, link) -> JoinTicket`, `JoinSchedule::Here` (no spawn wait, 120 s first connection), `join_failed(join_id, link)`. |
| `services/friends/matching.rs` | `ReportedHashes: LocalHashes`, `plan_for_running(invite, manifest, game, instances)`. |
| `services/friends/{records,config,contract,contract_tests}.rs` | `FriendNotice::AddedInGame`, `FriendsSettings.allow_foreign_games`, request record `in_game: Option<String>` (game label, `#[serde(default)]`), new contract types (9.2). |
| `services/friends/{sessions,session_events,status}.rs` | route `ExternalAttached`, `ModCall`; "playing" for external games; `SessionEvent::ModLinks`, `ModPrompt`, `ModAction`. |
| `services/friends/modinstall.rs` | per-loader query (3.7). |
| `services/friends/service.rs` | `apply_settings`: `allow_foreign_games` toggles `bridge.set_foreign`; `block_peer` for undo. |
| `friends_session_commands.rs`, `lib.rs` | commands of 9.3; remove `friends_mod_confirm`. |
| `lib.rs`/`state.rs` | pass `app_local_data_dir` and (Linux) `runtime_dir` to `ModBridge::start`. |

### 9.2 Contract types (SPEC 8.1 serde rules; Rust in `contract.rs`, TS in `friends-types.ts`)
```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct FriendsSettings { pub display_name: String, pub always_relay: bool,
    #[serde(default)] pub findable_by_name: bool, #[serde(default)] pub allow_foreign_games: bool }

#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FriendNotice { Renamed { previous_name: String }, IdentityChanged { previous_fingerprint: String },
    AddedInGame { game_label: String } }

pub struct HostSession { /* existing fields */ pub game_label: Option<String> }        // null for instance sessions
pub struct JoinSessionEvent { /* existing fields */ pub game_label: Option<String> }   // null for launcher-started joins

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub enum ModScope { Join, Share, Friends }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub enum ModLinkKind { Instance, External }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub enum ModLinkState { AwaitingApproval, Connected, Disconnected }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct ModLink {
    pub id: String,                  // "l-<uuid>"
    pub game_id: String,             // instance id or "ext:<uuid>"
    pub kind: ModLinkKind,
    pub label: String,
    pub player: Option<String>,      // verified Minecraft name (external) or null
    pub minecraft: String,
    pub loader: ModLoader,
    pub loader_version: Option<String>,
    pub mod_count: Option<u32>,
    pub pid: u32,
    pub exe_path: Option<String>,
    pub brand: Option<String>,       // self-reported
    pub protocol: u32,               // 1 or 2
    pub connected_since: u64,
    pub state: ModLinkState,
    pub scopes: Vec<ModScope>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub enum ModAction { AddByCode, AddByName, AcceptRequest, DeclineRequest, CreateCode, RemoveFriend, BlockFriend,
    UnblockPeer, ChangeDisplayName, FindableOff, FindableOn, AlwaysRelayOn, AlwaysRelayOff, Share, JoinHere,
    JoinLaunch, DisableFriends, RotateIdentity, ResetIdentity }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct ModTarget { pub name: String, pub fingerprint: Option<String>, pub mc_name: Option<String> }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct ModPairingFacts { pub exe_path: Option<String>, pub pid: u32, pub process_started_at: u64,
    pub player: String, pub player_is_launcher_account: bool, pub minecraft: String, pub loader: ModLoader,
    pub loader_version: Option<String>, pub mod_count: u32, pub brand: Option<String>, pub label: String }

#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ModPrompt {
    Pairing { prompt_id: String, link_id: String, facts: ModPairingFacts, default_scopes: Vec<ModScope>, expires_at: u64 },
    Scope { prompt_id: String, link_id: String, game_label: String, scope: ModScope, action: ModAction,
            target: Option<ModTarget>, expires_at: u64 },
    Danger { prompt_id: String, link_id: String, game_label: String, action: ModAction, expires_at: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub enum ModPromptAnswer { Deny, Once, ForGame }          // Danger: Once = "Ausführen"; Pairing: ForGame = "Erlauben"
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct ModPromptReply { pub prompt_id: String, pub answer: ModPromptAnswer, pub scopes: Vec<ModScope> }   // scopes: pairing only

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub enum ModOutcome { Done, Denied, Failed, Undone }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct ModAuditEntry { pub id: String, pub at: u64, pub link_id: String, pub game_label: String,
    pub action: ModAction, pub target: Option<ModTarget>, pub outcome: ModOutcome, pub undo_until: Option<u64> }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub enum ModOpenTarget { Friends, AddFriend, Requests, Invite, Settings, GameAccess, OptIn }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub enum ModPromptClose { Answered, Timeout, LinkClosed }

pub struct ModLinksEvent { pub links: Vec<ModLink> }
pub struct ModPromptEvent { pub prompt: ModPrompt }
pub struct ModPromptClosedEvent { pub prompt_id: String, pub reason: ModPromptClose }
pub struct ModActionEvent { pub entry: ModAuditEntry }
pub struct ModOpenEvent { pub target: ModOpenTarget, pub invite_id: Option<String> }
pub struct ModJoinLaunchEvent { pub invite_id: String, pub instance_id: Option<String>, pub create_vanilla: bool }
```
TS twins (exact):
```ts
export interface FriendsSettings { displayName: string; alwaysRelay: boolean; findableByName: boolean; allowForeignGames: boolean }
export type FriendNotice = { type: "renamed"; previousName: string } | { type: "identityChanged"; previousFingerprint: string }
  | { type: "addedInGame"; gameLabel: string };
// HostSession gains gameLabel: string | null;  JoinSessionEvent gains gameLabel: string | null
export type ModScope = "join" | "share" | "friends";
export interface ModLink { id: string; gameId: string; kind: "instance" | "external"; label: string; player: string | null;
  minecraft: string; loader: ModLoader; loaderVersion: string | null; modCount: number | null; pid: number; exePath: string | null;
  brand: string | null; protocol: number; connectedSince: number; state: "awaitingApproval" | "connected" | "disconnected"; scopes: ModScope[] }
export type ModAction = "addByCode" | "addByName" | "acceptRequest" | "declineRequest" | "createCode" | "removeFriend" | "blockFriend"
  | "unblockPeer" | "changeDisplayName" | "findableOff" | "findableOn" | "alwaysRelayOn" | "alwaysRelayOff" | "share" | "joinHere"
  | "joinLaunch" | "disableFriends" | "rotateIdentity" | "resetIdentity";
export interface ModTarget { name: string; fingerprint: string | null; mcName: string | null }
export interface ModPairingFacts { exePath: string | null; pid: number; processStartedAt: number; player: string;
  playerIsLauncherAccount: boolean; minecraft: string; loader: ModLoader; loaderVersion: string | null; modCount: number;
  brand: string | null; label: string }
export type ModPrompt =
  | { type: "pairing"; promptId: string; linkId: string; facts: ModPairingFacts; defaultScopes: ModScope[]; expiresAt: number }
  | { type: "scope"; promptId: string; linkId: string; gameLabel: string; scope: ModScope; action: ModAction; target: ModTarget | null; expiresAt: number }
  | { type: "danger"; promptId: string; linkId: string; gameLabel: string; action: ModAction; expiresAt: number };
export type ModPromptAnswer = "deny" | "once" | "forGame";
export interface ModPromptReply { promptId: string; answer: ModPromptAnswer; scopes: ModScope[] }
export type ModOutcome = "done" | "denied" | "failed" | "undone";
export interface ModAuditEntry { id: string; at: number; linkId: string; gameLabel: string; action: ModAction;
  target: ModTarget | null; outcome: ModOutcome; undoUntil: number | null }
export type ModOpenTarget = "friends" | "addFriend" | "requests" | "invite" | "settings" | "gameAccess" | "optIn";
export interface ModLinksEvent { links: ModLink[] }
export interface ModPromptEvent { prompt: ModPrompt }
export interface ModPromptClosedEvent { promptId: string; reason: "answered" | "timeout" | "linkClosed" }
export interface ModActionEvent { entry: ModAuditEntry }
export interface ModOpenEvent { target: ModOpenTarget; inviteId: string | null }
export interface ModJoinLaunchEvent { inviteId: string; instanceId: string | null; createVanilla: boolean }
```
Removed: `ModConfirmEvent` (and fixture `event.modConfirm`), replaced by `ModPromptEvent`.

**Fixtures (SPEC 8.3 table, new/changed keys):** `friendsState.available` (settings with `allowForeignGames: false`), `friend.addedInGame`, `hostSession` (`gameLabel: null`), `hostSession.external` (`instanceId: "ext:…"`, `gameLabel` set), `event.joinSession.*` (`gameLabel: null`), `modLink.instance`, `modLink.external`, `modPrompt.pairing`, `modPrompt.scope`, `modPrompt.danger`, `modAuditEntry`, `event.modLinks`, `event.modPrompt`, `event.modPromptClosed`, `event.modAction`, `event.modOpen`, `event.modJoinLaunch`; removed `event.modConfirm`.

### 9.3 Commands and events
| Command | Signature | Errors |
|---|---|---|
| `friends_mod_links` | `() -> Vec<ModLink>` | - |
| `friends_mod_prompts` | `() -> Vec<ModPrompt>` (open prompts, for a reloaded window) | - |
| `friends_mod_answer` | `(reply: ModPromptReply) -> ()` | `errors.friends.notFound.modPrompt{id}` |
| `friends_mod_revoke` | `(link_id: String, scope: Option<ModScope>) -> ()` (None = "Trennen") | `errors.friends.notFound.modLink{id}` |
| `friends_mod_audit` | `() -> Vec<ModAuditEntry>` (newest first) | - |
| `friends_mod_undo` | `(audit_id: String) -> ()` | `errors.friends.notFound.auditEntry{id}`, `errors.friends.undoUnavailable` |
| removed | `friends_mod_confirm` | |

| Event | Payload | When |
|---|---|---|
| `friends-mod-links` | `ModLinksEvent` | any link added, changed (scopes, state) or removed |
| `friends-mod-prompt` | `ModPromptEvent` | a prompt opens (window restored and focused for `pairing` and `danger`) |
| `friends-mod-prompt-closed` | `ModPromptClosedEvent` | answered elsewhere, timeout, link closed |
| `friends-mod-action` | `ModActionEvent` | every audited outcome (toast; "Rückgängig" while `undoUntil` > now) |
| `friends-mod-open` | `ModOpenEvent` | `launcher.open` |
| `friends-mod-join-launch` | `ModJoinLaunchEvent` | `invite.joinLaunch` |
| removed | `friends-mod-confirm` | |
`friends-mod` (`ModConnectionEvent`) stays for the instance detail mod row.

### 9.4 Error keys (`src/i18n/{de,en}/errors.friends.ts`)
| Key | de | en |
|---|---|---|
| `notFound.modPrompt` | Diese Anfrage aus dem Spiel ist nicht mehr offen. | This request from the game is no longer open. |
| `notFound.modLink` | Dieses Spiel ist nicht mehr verbunden. | This game is no longer connected. |
| `notFound.auditEntry` | Diesen Eintrag gibt es nicht mehr. | This entry no longer exists. |
| `undoUnavailable` | Das lässt sich nicht mehr rückgängig machen. | This can no longer be undone. |

### 9.5 Frontend
- `FriendsTab.tsx` (Settings › Freunde): switch "Spiele aus anderen Launchern erlauben" with help text "Pumpkin Friends in Spielen aus Prism, Modrinth App, dem offiziellen Launcher und anderen darf sich verbinden, solange Pumpkin läuft. Jedes Spiel fragt einmal pro Start hier nach." and, on Linux with a Prism Flatpak, the override command with "Kopieren". Below it `GameAccessSection.tsx`.
- `GameAccessSection.tsx` (new): one card per `ModLink`: label, kind badge ("Pumpkin" / "Anderer Launcher"), player "(von Mojang bestätigt)", MC/loader/mod count, PID and exe path (external), state; scope chips with "Entziehen"; "Trennen"; the link's last 20 entries from `ModAuditList.tsx` (new) with "Rückgängig" where possible.
- `ModPromptDialog.tsx` (replaces `ModConfirmDialog.tsx`, mounted by `FriendDialogs`): variants `pairing` (OS facts block, "Bestätigt" block, "Selbst angegeben" block, scope checkboxes with `defaultScopes`, "Ablehnen"/"Erlauben"), `scope` ("Ablehnen"/"Nur diesmal"/"Für dieses Spiel"), `danger` ("Ablehnen"/"Ausführen", consequence text reused from the existing identity dialogs). "Ablehnen" holds the initial focus. Shows a countdown to `expiresAt`. Queue: one dialog at a time, FIFO.
- `useFriendEvents.ts`: subscribes the six new events; `friends-mod-action` → toast with "Rückgängig" (`friends_mod_undo`); `friends-mod-open` → navigate (`/friends`, add dialog, requests, InviteDialog for `inviteId`, settings tab `freunde`, opt-in dialog) and restore the window; `friends-mod-join-launch` → the existing `usePlay` join path.
- `FriendRow.tsx`: `addedInGame` notice badge "Im Spiel hinzugefügt ({gameLabel})" with "Behalten" / "Entfernen".
- `Friends.tsx` / new `ExternalGamesCard.tsx`: "Laufende Spiele" for external games with a session (guests, "Entfernen", "Teilen beenden").
- `sharingModel.ts`, `useFriends.ts`: sessions/joins with `gameLabel != null` are not looked up as instances.
- `FriendsModRow.tsx`: shown for Fabric, Quilt, NeoForge and Forge instances (status from `friends_mod_status`).
- i18n: `friendsSettings` (switch, Flatpak hint, game access, audit), `friendsHost` (external games card), `friends` (notice), and a new `friendsMod` dict for prompts and `ModAction` labels (de + en, identical key sets).
- Mock (`mock-friends.ts`): scenario `?mock=freunde-spiel` (one instance link, one external link, one open pairing prompt, two audit entries, one `addedInGame` friend); hooks `modLink(kind)`, `modPrompt(kind)`, `modAction(action, name)`, `modOpen(target)`.

### 9.6 Privacy text additions (PRIVACY.md, SPEC 12.1)
- "Spiele aus anderen Launchern: Ist die Einstellung an, legt Pumpkin eine Datei mit einem zufälligen Schlüssel in deinem Benutzerprofil ab. Jede Mod in einem deiner Spiele kann sie lesen; deshalb fragt Pumpkin bei jedem Spielstart einmal nach."
- "Zur Bestätigung meldet sich das Spiel einmal bei Mojang an (`sessionserver.mojang.com`), wie beim Betreten eines Online-Servers."
- "Was du im Spiel tust, protokolliert Pumpkin 7 Tage lang lokal (Einstellungen › Freunde › Spiele mit Zugriff)."

### 9.7 SPEC.md edits (D0, before code)
Sections 7 (point to MOD2 for v2, keep v1 text as the v1 path), 7.4 (replaced by MOD2 6), 8.2/8.3/8.4/8.5 (types, fixtures, commands, events of 9.2-9.3), 10.4/10.5/10.8 (prompt dialog, external sessions, settings), 11 (mod layout and targets → MOD2 3), 12.1 (9.6), 12.2 (minimum version note), 12.4 (6.4 limits), Appendix A (9.4 keys).

---

## 10. Testing

### 10.1 Java unit tests (`mod/core`, JDK 17, no Minecraft)
- `WireTest`: every v2 message shape of section 5 round-trips (golden JSON strings); unknown fields/types ignored; 64 KiB cap; 16 KiB during the handshake.
- `HmacTest` / `AttachTest`: Appendix B vectors; wrong `launcherProof` → close without `attachProof`; token never appears in any sent line.
- `DiscoveryTest`: path resolution per OS with injected env/properties; validation (bad token, missing protocols, `foreignOff`); mtime change triggers re-read.
- `OpsTest`: correlation ids unique; in-flight cap 8 (9th fails locally with `busy`); timeouts 15/30/130 s with an injected clock; `pending` extends the timeout; late `res` dropped.
- `TopicStoreTest`: rev ordering, whole replacement, sanitising, unknown enum values mapped (presence → offline).
- `V1AdapterTest`: v1 snapshot/notify/error mapped into topics; non-v1 ops fail with `protocolUnsupported`.
- `ManifestScannerTest`: top-level jars only, ≤ 500, sorted, parts of ≤ 150, names sanitised.
- `ScriptedLauncher` (test helper) speaks v1 and v2 over real loopback sockets; `BridgeHarnessTest` covers connect, attach, welcome, topics, request/response, reconnect with backoff, reject reasons of 5.8.
- `scripts/FakeLauncher.java` (dev tool for `runClient`) speaks v2: writes a discovery file into a temp dir (printed `-Dpumpkin.bridge.discovery=` line), serves scripted topics, answers ops from a JSON scenario, and can emit `pending` to exercise LauncherWaitScreen.

### 10.2 Rust tests
- `sockowner`: `FakeTable` reverse lookup (client row chosen, IPv4-mapped addresses, ambiguity → None, error passthrough); **child-process test** on all three OSes: the test binary re-executes itself (`current_exe()`, helper test name, env flag) as a fake game that connects to a parent listener and opens its own LISTEN socket; assert `owner_of_connection == child.id()`, `listens(child, port)`, a listener of the parent or of a second child is not attributed to the child.
- `procinfo`: `key(self)` stable, `same_user(self)`, `exe_path(self)` equals `current_exe()`, `alive` false after a spawned `current_exe() --list` exits.
- `hmac`: RFC 4231 case 2, Appendix B.
- `discovery`: modes 0700/0600 (unix), atomic replace, rotation, `foreignOff` content, removal on stop, refusal of a foreign-owned dir.
- `modbridge` (real loopback, fake `ForeignDeps`): v1 path unchanged (existing tests stay green untouched); v2 env attach; unknown keyId silent close; wrong proof silent close; setting off → `foreignOff`; owner lookup error/ambiguity → `notGame`; other user → `notGame`; account proof failure/unreachable → `account`; pairing deny sticky per ProcessKey; 3 denials per exe → silent; prompt timeout; reconnect resumes without proof/prompt; process death → `Exited`; owner PID = own launch → instance link; env token from another PID → `notGame`; pending cap 2 → `busy`; slow attach does not starve an env link (unauthenticated cap released after proof).
- `connection`: dirty-topic coalescing (≤ 1 push per 250 ms per topic, latest wins); event queue drop-oldest at 32; responses never dropped; 9th in-flight → `busy`; 64 KiB cap.
- `mod_link`: every op of 5.7 → the right service call (fake service), alias resolution, arg validation (`invalidArgs`), scope gating per 6.2 table (table-driven test over all ops × link kinds), prompt flows (once / forGame / deny / timeout / cap), danger never grantable, rate limits of 6.4 (injected clock), audit ring + file (7-day prune), undo for each row of 6.3, `addedInGame` set on in-game accept and on later confirmation of an in-game request, `friend.acknowledge` refused for `addedInGame`, worst-case topic sizes < 60 KiB.
- `joining`/`hosting`: join-here with link PID (no spawn wait, 120 s timer, `connects_from(link.pid)`), `join.failed`, macOS `localhost` nonce rule; external hosting with `verify_port(link.pid)`, LAN port owned by another PID → `portNotGame`, reported 1.19.4 → `versionUnsupported`, invalid manifest → `manifestInvalid`.
- Contract: fixture equality and key-set check for every new/changed key (9.2).

### 10.3 Frontend
`pnpm build`, `pnpm check:lib` (contract fixtures `satisfies`, i18n key parity de/en), mock scenario `freunde-spiel` renders every new component; `ModPromptDialog` focus on "Ablehnen" (check script on the model).

### 10.4 CI
- Rust: existing three-OS CI (check, test, clippy, cargo deny) covers the new modules; `cargo deny` stays green (no new crates).
- Mod: `mod.yml` (3.6): `core` tests + conditional/lang checks, the node matrix (`build` + `fingerprint`) for every node of the release, `collect`.
- Release: `mod-release.yml` (3.7).

### 10.5 Owner-verified (results in `docs/friends/VERIFICATION.md`, table "M2")
Per node (each of the 14 jars), on a real client, with the launcher running:
1. Game starts with only the mod (and Fabric API where needed); no error in the log; title and pause buttons placed without overlap at GUI scale 2 and 4.
2. Hub opens via button and keybinding; all five tabs render at 320×240 and 960×540; Tab/arrow navigation and narration work.
3. Own launch (Pumpkin): connected without prompt; add by name (scope prompt appears in the launcher; "Für dieses Spiel"); accept a request; launcher toast with "Rückgängig" works; `addedInGame` badge shows.
4. Share: "Für Freunde öffnen", invite a friend, friend joins from another PC, kick, stop.
5. Join here: accept an invite in-game into a matching running game; leave.
6. Danger: "Identität erneuern…" shows the launcher dialog; deny keeps everything.

Per launcher on Windows (one node each is enough; use 1.21.1 NeoForge and 1.20.1 Fabric): Prism, Modrinth App, vanilla launcher, CurseForge app: pairing prompt shows the correct exe and player, share/join work, game exit ends the share within 10 s. Linux: Prism Flatpak with and without the override (and that `/proc/<pid>/fd` of the sandboxed JVM is readable for the owner lookup). macOS: Prism (owner lookup speed, `localhost` nonce rule). A second Windows user: the discovery file is not readable, a guessed token is rejected. Quilt: for each node to be tagged `quilt`, steps 1-3 on Quilt Loader with QFAPI/Fabric API; record the node in `mod/quilt-tested.txt`. NeoForge 1.20.1: steps 1-3 with the Forge jar before tagging `neoforge`.

---

## 11. Work packages

### 11.1 Ownership rules
- The files listed under a package are **exclusive** to it while it runs. When it is done, ownership passes only to the later package whose row names the file again ("from X").
- **Append-only shared files** (any package may append, the orchestrator merges): `src-tauri/Cargo.toml` (features only; no new crates are planned), `src-tauri/Cargo.lock`, `src-tauri/src/services/mod.rs` and `src-tauri/src/services/friends/mod.rs` (`mod` lines), `src-tauri/src/lib.rs` (`generate_handler!` entries), `src/i18n/{de,en}/errors.friends.ts` (new keys, both languages), `mod/src/main/resources/assets/pumpkin_friends/lang/{en_us,de_de}.json` (new keys, both languages), `docs/friends/MOD2.md` (only the section a package implements, change rule as SPEC 14).
- Every package keeps the repo green (Rust CI on three OSes, `pnpm build`, `pnpm check:lib`, `mod.yml`), follows the clean-code skill, and adds the tests of section 10 that name its files.
- **Agent-verifiable** acceptance is checked by CI or a command; **owner-verified** items are collected by O1 into `docs/friends/VERIFICATION.md` (table M2) and never block a package's merge, only the release.
- Stonecutter conditionals only in `compat/` and `platform/` (checked by `check-conditionals.sh` from M1 on).

### 11.2 Packages

**Wave 0**

**D0, docs: spec into the repo, SPEC.md and privacy edits, error keys**
- Files: `docs/friends/MOD2.md` (this document), `docs/friends/SPEC.md` (9.7), `docs/friends/PRIVACY.md` (9.6), `docs/friends/VERIFICATION.md` (empty table M2 per 10.5), `src/i18n/{de,en}/errors.friends.ts` (9.4).
- Accept (agent): `pnpm check:lib` green; SPEC.md sections of 9.7 reference MOD2.md and no longer state "no accept over the mod channel"; VERIFICATION.md has one M2 row per 2.0 node and per launcher of 10.5.

**M1, build-ci: Stonecutter skeleton and core split (one node, no behaviour change)**
- Files: `mod/settings.gradle` → `mod/settings.gradle.kts`, `mod/build.gradle` → `mod/build.fabric.gradle.kts`, `mod/stonecutter.gradle.kts`, `mod/gradle/release.gradle.kts` (stub, applied by every loader script), `mod/gradle.properties`, `mod/versions/26.3-fabric/gradle.properties`, `mod/core/**` (moved `bridge/`, `state/` and their tests, `BridgeClient.java:142` switch rewritten for Java 17), `mod/src/**` (move `src/client` → `src/main`; `FriendsClient` → `client/FriendsMod` + `platform/Platform` + `platform/fabric/FabricEntry`; `mc/*` moved unchanged to `client/`), `mod/scripts/dev-env.ps1`, `mod/scripts/dev-env.sh`, `mod/scripts/check-conditionals.sh`, `mod/scripts/check-lang.mjs`, `mod/README.md`, `mod/.gitignore`, `.github/workflows/ci.yml` (remove the `mod` job), `.github/workflows/mod.yml` (new: `core` job + node matrix generated from `./gradlew -q stonecutterNodes`).
- Accept (agent): `./gradlew :core:test` green and `core` compiles with `options.release = 17`; `./gradlew :26.3-fabric:build` green and produces `pumpkin_friends-0.2.0+26.3-fabric.jar`; `dev-env.ps1`/`.sh` install 25/21/17 with SHA-256 checks into `mod/.jdk/<n>/` (idempotent); `check-conditionals.sh` and `check-lang.mjs` run in `mod.yml`; `mod.yml` green. Owner: the jar behaves as 0.1.0 in 26.3 (pause button, share).

**Wave 1**

**K1, rust-launcher + frontend: contract types and fixtures (both sides)**
- Files: `src-tauri/src/services/friends/contract.rs`, `contract_tests.rs`, `records.rs` (`FriendNotice::AddedInGame`, request record `in_game`), `src/lib/friends-types.ts`, `src/lib/friends-fixtures.ts`; seam edits limited to adding `game_label: None` in existing `HostSession`/`JoinSessionEvent` constructors in `friends/hosting.rs` and `friends/joining.rs`.
- Accept (agent): every type of 9.2 in Rust and TS exactly; fixtures for every new/changed key of 9.2 (existing `event.modConfirm` stays until O1); contract test and key-set check green; old `config.json`/records without the new fields still load (test).

**RB, rust-launcher: v2 wire types, HMAC, discovery file, game-signal types**
- Files: `src-tauri/src/services/modbridge/protocol.rs`, `modbridge/hmac.rs` (new), `modbridge/discovery.rs` (new), `src-tauri/src/services/gamesignal.rs`.
- Accept (agent): JSON shape tests for every handshake line of 4.3/4.5/4.6 and every envelope of 5.2-5.6 (golden strings); v1 tests untouched and green; HMAC RFC 4231 case 2 and Appendix B vectors; discovery: path per OS (injected env), atomic write, 0700/0600 on unix, `foreignOff` content, refusal of a foreign-owned dir, `remove`; `GameSignal::{ExternalAttached, ModCall}` and `ExternalGame` compile with a unit test of `ModReply` (reply once, pending notify).

**R1a, rust-launcher: reverse socket owner lookup**
- Files: `src-tauri/src/services/sockowner/{mod.rs, windows.rs, linux.rs, macos.rs}`, `sockowner/child_tests.rs` (new).
- Accept (agent): `owner_of_connection` per 9.1; `FakeTable` tests (client row chosen, IPv4-mapped, ambiguity → None, error passthrough); the child-process test of 10.2 green on Windows, Linux and macOS CI; existing `listens`/`connects_from` tests unchanged.

**R1b, rust-launcher: process info**
- Files: `src-tauri/src/services/procinfo/{mod.rs, windows.rs, linux.rs, macos.rs}` (new), `src-tauri/Cargo.toml` (windows-sys features `Win32_Foundation`, `Win32_Security`, `Win32_System_Threading`).
- Accept (agent): API of 9.1; tests of 10.2 on three OSes; every `unsafe` block has a `// SAFETY:` comment and handles are closed on all paths (RAII guard); `cargo deny` green.

**R5, rust-launcher: mod install for every loader**
- Files: `src-tauri/src/services/friends/modinstall.rs`.
- Accept (agent): `status` is `Unavailable` only for Vanilla or an empty project id; `install` builds the query of 3.7 (loader, MC version, quilt→fabric fallback, Fabric API dependency only for Fabric/Quilt) — tested with the existing fake Modrinth seam for each loader; no listed version → `errors.friends.modNotAvailable{version}`.

**J1, mod-core: protocol v2 client core**
- Files (from M1): `mod/core/src/main/java/dev/laux/pumpkin/friends/core/bridge/{BridgeClient, Wire, Limits, Backoff, Connector, EnvConnector, Connectors, Attach, Hmac, V1Adapter}.java`, `core/ops/{Ops, Op, ErrorCode, Result}.java`, `core/state/{TopicStore, Topics, Sanitize, StateListener}.java`, `core/report/{GameFacts, AccountProver, ManifestSource}.java` (interfaces only), `core/ModConfig.java`, `mod/core/src/test/**` (except the J2 tests).
- Accept (agent): tests `WireTest`, `HmacTest`, `AttachTest`, `OpsTest`, `TopicStoreTest`, `V1AdapterTest`, `BridgeHarnessTest` (env v2 attach incl. `attachNeed` handling through the `GameFacts`/`ManifestSource`/`AccountProver` interfaces, env v1 fallback) of 10.1 green on JDK 17; Appendix B vectors asserted; the token never appears in any sent line (test scans the scripted launcher's received bytes); every op of 5.7 has an `Op` builder and every code of 5.8 an `ErrorCode` constant (test compares against a list copied from 5.7/5.8); no Minecraft import in `core` (Gradle check).

**U1, mod-adapter: compat layer, widget kit and hooks on 26.3**
- Files (from M1): `mod/src/main/java/dev/laux/pumpkin/friends/compat/**`, `ui/kit/{PumpkinScreen, TabBar, ScrollPane, Fit}.java`, `client/{ScreenHooks, LanWatcher}.java`, `platform/Platform.java`, `platform/fabric/FabricEntry.java`, removal of `client/{PauseMenuButton, FriendsScreen, Toasts, LanControl}.java`.
- Accept (agent): every signature of 3.4 exists for node 26.3-fabric; `ui/kit` uses only allowed calls (3.4 rule 3; a grep test in `check-conditionals.sh` for forbidden imports in `ui/`); pause/title buttons and key registered through `Platform`; `:26.3-fabric:build` green. Owner: buttons placed without overlap on 26.3 next to Mojang's FriendsButton.

**Wave 2**

**F1, frontend: backend, Tauri bindings, mock**
- Files: `src/lib/backend.ts`, `src/lib/backend-tauri.ts`, `src/lib/mock-friends.ts`, `src/lib/mock-backend.ts`, `src/i18n/{de,en}/friendsMod.ts` (new, empty dict), `src/i18n/{de,en}/mock.ts`, `src/i18n/de.ts`, `src/i18n/en.ts`.
- Accept (agent): every command and event of 9.3 in `Backend`, `BackendEvents`, `eventSubscriptions`, `backend-tauri.ts` with exact snake_case names; mock implements them and scenario `freunde-spiel` with the hooks of 9.5; `pnpm build`, `pnpm check:lib` green.

**R2, rust-launcher: bridge v2 server (env path) and per-link writer**
- Files: `src-tauri/src/services/modbridge/{mod.rs, server.rs, connection.rs, tests.rs}`.
- Accept (agent): v1 tests green unchanged; `launch_env` for every loader except Vanilla plus `PUMPKIN_IPC_PROTOCOLS=1,2`; `attach` with a launch token admits the instance link (owner PID check through an injected `ConnectionOwners`, mismatch → `notGame`, lookup error → admit + log); unknown keyId and wrong proof close silently; `welcome` v2; requests forwarded as `GameSignal::ModCall` and answered (`res`/`pending`); in-flight 8 → `busy`; topics coalesced per 250 ms, events drop-oldest at 32, responses never dropped; 64 KiB cap after welcome, 16 KiB before (all in `modbridge/tests.rs`).

**R4d, rust-launcher: running-games registry and external hosting**
- Files: `src-tauri/src/services/friends/games.rs` (new), `friends/hosting.rs` (from K1), `friends/sessions.rs`, `friends/status.rs`, `friends/tests_external.rs` (new).
- Accept (agent): `RunningGames` replaces `hosting.games`; `ExternalAttached` + `Spawned{ext:…}` register an external game; `host_start` for it uses the reported manifest (`manifest::validate`), `verify_port(link.pid, port)`, `game_label` set; port owned by another PID → `portNotGame`; reported 1.19.4 → `versionUnsupported`; invalid manifest → `manifestInvalid`; `Exited{ext:…}` ends the session `gameExited`; presence "playing" while an external game runs; all existing hosting tests green.

**J2, mod-core: discovery, attach, game report, account proof**
- Files: `mod/core/src/main/java/.../core/bridge/{Discovery, DiscoveryConnector}.java`, `core/bridge/Connectors.java` (from J1), `core/report/{GameReport, ManifestScanner}.java`, tests `DiscoveryTest`, `ManifestScannerTest`, `ForeignAttachTest`, `mod/core/src/test/.../ScriptedLauncher.java` (from J1), `mod/scripts/FakeLauncher.java`.
- Accept (agent): tests of 10.1 for these classes green; `ForeignAttachTest` runs the full discovery attach (report, 3 manifest parts, account proof with the Appendix B `serverId`) against `ScriptedLauncher`; `ok:false` account proof when `AccountProver` throws; reject reasons of 5.8 drive the documented retry behaviour; `FakeLauncher` v2 runs a scenario from JSON and writes a discovery file. Owner: `runClient` against `FakeLauncher` connects through the discovery file.

**U2a, mod-adapter: hub, friends, requests, add friend**
- Files: `mod/src/main/java/.../ui/{HubScreen, FriendsTab, RequestsTab, AddFriendScreen, FriendActionsScreen, ConfirmFlow, LauncherWaitScreen}.java`, `ui/kit/Rows.java`, `client/{FriendsMod, ToastFeed}.java` (from M1/U1: wiring of `Connectors`, `GameFacts`, `AccountProver` via `compat.Session`), lang keys (append).
- Accept (agent): `:26.3-fabric:build` green; `check-lang.mjs` green; every op used by these screens is one of 5.7 and every error code shown has a lang key; no vanilla call outside the allowed set. Owner: on 26.3 the flows of 10.5 steps 2-3 work against the FakeLauncher and the real launcher; 320×240 and 960×540 layouts are readable.

**V1, mod-adapter: 26.2 and 26.1 on Fabric, NeoForge infrastructure**
- Files (from U1): `mod/compat/**` (26.1/26.2 branches), `platform/fabric/FabricEntry.java` (`getButtons`/`getWidgets`), `platform/neoforge/NeoForgeEntry.java` (new), `mod/build.neoforge.gradle.kts` (new, applies `gradle/release.gradle.kts`), `mod/src/main/resources/META-INF/neoforge.mods.toml`, `mod/settings.gradle.kts`, `mod/stonecutter.gradle.kts`, `mod/versions/{26.3-neoforge, 26.2-fabric, 26.2-neoforge, 26.1-fabric, 26.1-neoforge}/gradle.properties`.
- Accept (agent): all six 26.x nodes build in `mod.yml`; `FriendToast` only on >= 26.2 (SystemToast on 26.1); `publishServer` per 26.1/26.2/26.3 signature. Owner: 10.5 steps 1-2 on each 26.x node and loader.

**Wave 3**

**R3, rust-launcher: foreign attach, pairing, liveness**
- Files: `src-tauri/src/services/modbridge/foreign.rs` (new), `modbridge/foreign_tests.rs` (new), `modbridge/mod.rs` and `modbridge/server.rs` (from R2), `src-tauri/src/services/friends/service.rs` (`apply_settings` → `set_foreign`), `src-tauri/src/state.rs`, `src-tauri/src/lib.rs` (paths for `start`).
- Accept (agent): every foreign test of 10.2 (`modbridge` list) green with fake `ForeignDeps`; discovery written on start/toggle with rotation, `foreignOff` when off, removed on stop; `ExternalAttached` + `Spawned` on welcome; reconnect resumes; liveness `Exited` within 10 s of process death (injected clock); pairing goes through the `PairingApprover` seam (R4b provides the real one; R3 ships a deny-all default). Owner: none (covered in O1).

**R4a, rust-launcher: mod_link dispatch, aliases, topics, operations**
- Files: `src-tauri/src/services/friends/mod_link.rs` → `friends/mod_link/{mod.rs, dispatch.rs, aliases.rs, topics.rs, ops_friends.rs, ops_host.rs, tests.rs}`, stubs `mod_link/{ops_join.rs, consent.rs, audit.rs}` (→ R4c, R4b, R4b), `friends/sessions.rs` (from R4d: route `ModCall`).
- Accept (agent): every op of 5.7 except the join ops dispatched to the right service function (fake service, table-driven); `invalidArgs` for every malformed arg; aliases stable per connection; the 8 topics built per 5.4 with worst-case size test < 60 KiB; v1 snapshot path unchanged (existing tests green); the consent stub denies every scoped op with `denied`.

**F2a, frontend: prompts, events, undo, review notice**
- Files: `src/components/friends/ModPromptDialog.tsx` (new), `src/components/friends/FriendDialogs.tsx`, `src/components/friends/useFriendEvents.ts`, `src/pages/friends/FriendRow.tsx`, `src/i18n/{de,en}/friendsMod.ts` (from F1), `src/i18n/{de,en}/friends.ts`.
- Accept (agent): the three prompt variants of 9.5 render from the mock (`modPrompt(kind)`), "Ablehnen" has the initial focus (check script), queue FIFO; `friends-mod-action` toast with "Rückgängig" calls `friends_mod_undo`; `friends-mod-open` routes every `ModOpenTarget`; `friends-mod-join-launch` runs the existing join path; `addedInGame` badge with Behalten/Entfernen; `pnpm build`/`check:lib` green.

**F2b, frontend: settings, game access, audit, external games**
- Files: `src/pages/settings/FriendsTab.tsx`, `src/pages/settings/GameAccessSection.tsx` (new), `src/pages/settings/ModAuditList.tsx` (new), `src/pages/friends/ExternalGamesCard.tsx` (new), `src/pages/Friends.tsx`, `src/components/friends/sharingModel.ts` (+ `.check.mjs`), `src/components/friends/useFriends.ts`, `src/pages/detail/FriendsModRow.tsx`, `src/i18n/{de,en}/friendsSettings.ts`, `src/i18n/{de,en}/friendsHost.ts`.
- Accept (agent): switch writes `allowForeignGames` via `friends_update_settings`; Flatpak hint only on Linux with the Prism Flatpak flag from the mock; link cards with Entziehen/Trennen calling `friends_mod_revoke`; audit list; external session card with Entfernen/Teilen beenden; `sharingModel.check.mjs` covers `gameLabel` sessions; mod row for all four loaders.

**U2b, mod-adapter: invites, join, share, options**
- Files: `mod/src/main/java/.../ui/{InvitesTab, InviteScreen, ShareTab, OptionsTab, BlockedScreen}.java`, `client/JoinFlow.java`, `mod/core/src/main/java/.../core/ops/JoinTarget.java` + `JoinTargetTest.java` (new), lang keys (append).
- Accept (agent): `:26.3-fabric:build` green; the target validator `core/ops/JoinTarget.java` (owned by U2b, with `JoinTargetTest`) refuses hosts outside 127.0.0.0/8, names instead of IPv4 literals and ports outside 1..65535, and `JoinFlow` uses it; every danger action goes through `LauncherWaitScreen`. Owner: 10.5 steps 4-6 on 26.3 Fabric.

**V2a, mod-adapter: 1.21.9-1.21.11 on Fabric and NeoForge (first remapped node)**
- Files (from V1): `mod/compat/**`, `platform/**`, `mod/stonecutter.gradle.kts` (replacements `Identifier`↔`ResourceLocation`), `mod/settings.gradle.kts`, `mod/build.fabric.gradle.kts` (remap path via loom-back-compat), `mod/build.neoforge.gradle.kts`, `mod/versions/{1.21.11-fabric, 1.21.11-neoforge}/gradle.properties`.
- Accept (agent): both nodes build on JDK 21; all 26.x nodes still build. Owner: 10.5 steps 1-2.

**B2, build-ci: fingerprint check and release collection**
- Files: `mod/gradle/release.gradle.kts` (from M1), `mod/scripts/fingerprint/**` (new), `.github/workflows/mod.yml` (from M1: `fingerprint` and `collect` steps).
- Accept (agent): `./gradlew :<node>:fingerprint` passes for every existing node and fails on a deliberately injected reference to a member missing in one version of the range (test fixture); `./gradlew buildAndCollect` writes `mod/build/release/` with all jars and `jars.json` exactly per 3.7 (validated by a JSON schema check in the job).

**Wave 4**

**R4b, rust-launcher: consent, prompts, audit, undo, commands**
- Files: `friends/mod_link/{consent.rs, audit.rs, tests_consent.rs}` (from R4a), `friends/session_events.rs`, `friends/requests.rs` (set `addedInGame` when an in-game request is confirmed), `friends/service.rs` (from R3: `block_peer`), `src-tauri/src/friends_session_commands.rs`, `src-tauri/src/lib.rs` (handlers, append), `modbridge/foreign.rs` hook: provide the real `PairingApprover` (wiring only, from R3).
- Accept (agent): the scope table of 6.2 as a table-driven test over all ops × link kinds; prompts once/forGame/deny/timeout/caps of 6.4; danger never grantable; pairing prompt facts per 9.2, sticky deny; audit ring + 7-day file; undo for every row of 6.3; `addedInGame` set on in-game accept and on later confirmation; `friend.acknowledge` refused for `addedInGame`; commands and events of 9.3 emitted with fixture-equal payloads; v1 first share now uses `ModPrompt::Scope{share}`.

**R4c, rust-launcher: in-game join**
- Files: `friends/mod_link/ops_join.rs` (from R4a), `friends/joining.rs` (from K1), `friends/matching.rs`, `friends/tests_join_here.rs` (new).
- Accept (agent): `invite.plan` for instance and external links (`ReportedHashes`), `here` filled, lists capped; `invite.joinHere` per 8.2 (no spawn wait, 120 s timer, `connects_from(link.pid)`, owner re-check), `join.failed`, macOS `localhost` nonce rule (cfg-tested via an injected listener IP), `invite.joinLaunch` emits `friends-mod-join-launch` with alias-resolved instance; existing joining tests green.

**V2b, mod-adapter: 1.21.2-1.21.8 and 1.21-1.21.1 on Fabric and NeoForge**
- Files (from V2a): `mod/compat/**`, `platform/**`, `mod/settings.gradle.kts`, `mod/stonecutter.gradle.kts`, `mod/versions/{1.21.4-fabric, 1.21.4-neoforge, 1.21.1-fabric, 1.21.1-neoforge}/gradle.properties`.
- Accept (agent): four nodes build and pass `fingerprint` for their whole range (else the node is split and the split is recorded in MOD2 2 and `jars.json`). Owner: 10.5 steps 1-2 on 1.21.1 NeoForge and 1.21.4 Fabric at least.

**Wave 5**

**V3, mod-adapter: 1.20-1.20.1 on Fabric and Forge**
- Files (from V2b): `mod/compat/**`, `platform/**` (+ `platform/forge/ForgeEntry.java`), `mod/build.forge.gradle.kts` (new, MDG legacyforge), `mod/src/main/resources/{META-INF/mods.toml, pack.mcmeta}`, `mod/settings.gradle.kts`, `mod/versions/{1.20.1-fabric, 1.20.1-forge}/gradle.properties`.
- Accept (agent): both nodes build on JDK 17 and pass `fingerprint`; all earlier nodes still build. Owner: 10.5 steps 1-3 on Fabric and Forge 1.20.1, and steps 1-3 on NeoForge 47.1 with the Forge jar before it is tagged `neoforge`.

**B3, build-ci: multi-jar release**
- Files: `.github/workflows/mod-release.yml`, `mod/quilt-tested.txt` (new, empty), `mod/README.md` (release section; from M1).
- Accept (agent): `build` job has no secret and no cache, checks each jar's id/version and `MOD_PROJECT_ID`; `publish` loops `jars.json`, verifies sha256, refuses existing `version_number`, tags `quilt` only for nodes in `quilt-tested.txt`, Fabric API dependency only on Fabric/Quilt entries; a dry-run mode (`workflow_dispatch` input `dry_run`) prints every request instead of sending (exercised in CI with `act`-free shell tests of the jq loop).

**Wave 6**

**O1, docs + integration: cleanup and owner checklist**
- Files: removal of `ModConfirmEvent`, `friends_mod_confirm`, `friends-mod-confirm`, fixture key `event.modConfirm`, `src/components/friends/ModConfirmDialog.tsx` (touching `contract.rs`, `contract_tests.rs`, `friends-types.ts`, `friends-fixtures.ts`, `backend.ts`, `backend-tauri.ts`, `mock-friends.ts`, `friends_session_commands.rs`, `lib.rs`), `mod/README.md` (owner checklist per node), `docs/friends/VERIFICATION.md`, `docs/friends/MOD2.md` (hand-off facts), `src-tauri/src/services/modbridge/e2e_tests.rs` (new).
- Accept (agent): `e2e_tests.rs` drives the real bridge + real `mod_link` with fake friends services over loopback using recorded mod lines (attach, every op of 5.7 once, prompts answered) and asserts the responses; no reference to the removed items remains (`rg`); every CI green. Owner: VERIFICATION M2 filled for every 2.0 node and launcher of 10.5 → release gate.

**Wave 7 (Mod 2.1, scheduled after the 2.0 release)**

**R6, rust-launcher: version floor 1.18**
- Files: `src-tauri/src/services/friends/{contract.rs, contract_tests.rs, mcproto.rs, manifest.rs}`, `src-tauri/src/services/{launch_args.rs, launch.rs, lan_detect.rs}`, `src/lib/friends-types.ts`, `src/lib/friends-fixtures.ts`, `docs/friends/testdata/login-start/*.bin` (captured packets).
- Accept (agent): steps 1-4 of 3.8 with tests; `MIN_MC_LABEL = "1.18"` on both sides with fixture equality. Owner: capture the 1.19.2 Login Start packet; host and join on 1.18.2 and 1.19.2 (two PCs).

**V4, mod-adapter: 1.20.2-1.20.6 on Fabric** (from V3: `compat/**`, `platform/**`, `settings.gradle.kts`, `versions/{1.20.6-fabric, 1.20.4-fabric}/gradle.properties`). Accept (agent): build + fingerprint. Owner: 10.5 steps 1-3.

**V5, mod-adapter: 1.18.2, 1.19.2, 1.19.4 on Fabric and Forge** (from V4: same file set plus `versions/{1.19.4,1.19.2,1.18.2}-{fabric,forge}/gradle.properties`). Accept (agent): build + fingerprint; `Label` widget for the PoseStack family; `Forge 1.18.2` uses `ScreenEvent.InitScreenEvent.Post`. Owner: 10.5 steps 1-5 on 1.19.2 Fabric and 1.18.2 Forge.

### 11.3 Dependency graph (summary)
```
W0  D0   M1
W1  K1   RB   R1a  R1b  R5   J1(M1)  U1(M1)
W2  F1(K1)  R2(RB)  R4d(K1,RB)  J2(J1)  U2a(U1,J1)  V1(U1)
W3  R3(R2,R1a,R1b)  R4a(R2,R4d,K1)  F2a(F1)  F2b(F1)  U2b(U2a)  V2a(V1)  B2(V1)
W4  R4b(R4a,R3)  R4c(R4a,R4d)  V2b(V2a,B2)
W5  V3(V2b)  B3(B2)
W6  O1(R4b,R4c,F2a,F2b,U2b,J2,V3,B3,R5)
W7  R6  V4(V3)  V5(V4)
```

---

## 12. Risks and owner decisions

### 12.1 Risks (honest)
1. **A granted hostile mod can befriend an attacker** (A1/A2). Accepting and adding in-game is required; the design makes it visible (prompt, toast, review badge, audit) and undoable, not impossible.
2. **Unsafe FFI** in `procinfo` (Windows token/SID/times, macOS `proc_pidinfo`) is the highest implementation risk; mitigated by RAII guards, small surface and the child-process tests on three OSes.
3. **Linux reverse lookup** scans `/proc/*/fd` of same-uid processes: cost (tens of ms) and races; readability of a Flatpak JVM's fds from the host is assumed and must be confirmed by the owner. macOS `lsof` takes 100-500 ms per attach.
4. **Era ranges** (e.g. 1.21.2-1.21.8 in one jar) are claims until the fingerprint check passes; a failing check splits the node (more jars, more owner tests).
5. **26.x cadence:** every quarterly Minecraft release so far changed at least one signature we use; each needs a node and a compat branch. NeoForge 26.3 has no stable build yet.
6. **Nonce check on older clients:** pre-1.20.2 handshakes may carry a reverse-resolved host name; on Windows/Linux `127.a.b.c` has no PTR and stays literal, on macOS the `localhost` exception applies. Must be confirmed per family by the owner (10.5 step 5).
7. **Foreign manifests are self-reported:** wrong folders (Forge `mods/<version>/`, custom layouts) give wrong match verdicts; the host's server still rejects mismatched clients at login.
8. **Second game instance:** `invite.joinLaunch` starts another Minecraft while the current one keeps running (memory).
9. **Sandboxes:** Flatpak needs a manual override; Snap is unsupported; WSL/VM/containers never work.
10. **Quilt:** Quilted Fabric API is unmaintained since 2024-12; Quilt support rests on Fabric API running on Quilt Loader and on owner smoke tests.
11. **Mojang's own Friends list** on 26.2+ overlaps in purpose; players may be confused by two friends systems.
12. **Effort figures** (research: about 17-20 person-days for 2.0 mod work plus the Rust/frontend packages) are estimates; obfuscated-era Gradle caches (0.5-1 GB each) make the first CI runs slow.

### 12.2 Owner decisions (defaults chosen in this spec; the owner may override)
- **D1 Default of "Spiele aus anderen Launchern erlauben":** OFF (the discovery file lets any mod in any of your games ask for pairing). Alternative: ON when Friends is enabled.
- **D2 First opt-in stays in the launcher:** turning Friends on cannot happen in-game because the bridge does not exist before the opt-in (SPEC 12.1 promise "nothing listens before you turn it on"). Alternative: keep a loopback listener always running, which breaks that promise.
- **D3 Account proof through the game's own Mojang login** for foreign games (one `sessionserver` join per game start, made by vanilla code, not by our own network code). Alternative: no proof, which means foreign games cannot be proven online and therefore could not host.
- **D4 Positioning on 26.2+ next to Mojang's Friends list:** ship, never bind `O`, keybinding unbound by default, title button skips when it would overlap.
- **D5 Scope of "later":** Forge above 1.20.1, NeoForge 1.20.2-1.20.6 and 1.16.5/1.17.1 are not scheduled; the owner decides per demand.

---

## Appendix A: mod lang key groups (`assets/pumpkin_friends/lang/{en_us,de_de}.json`)
`pumpkin_friends.button.*` (pause, title, done, more, ...), `.tab.*`, `.status.*` (every hub state of 7.3), `.friends.*`, `.requests.*`, `.invites.*`, `.share.*`, `.options.*`, `.danger.*`, `.wait.*`, `.confirm.*`, `.join.*`, `.toast.*` (every `notify.kind` of 5.5), `.error.*` (every code of 5.8 plus `unknown`, `timeout`, `notConnected`), `.key.open`, `.key.category`. `check-lang.mjs` asserts identical key sets and that every `ErrorCode` and `notify.kind` has a key. German is the source language, English the twin.

## Appendix B: golden vectors (Rust `modbridge/hmac.rs` tests and Java `HmacTest`/`AttachTest`)
Inputs (hex):
```
token      000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
nonceM     202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f
nonceL     404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f
launcherId a0a1a2a3a4a5a6a7a8a9aaabacadaeaf
nonceA     606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f
```
Outputs:
```
launcherProof = 570b314d006ea844708df1dc375495e258ded70a7af0731cb5bc53f7100ea65b
modProof      = 9813a4597a418afc970ed719452b9465b04dfd600ca3ba4166ca6725dea579d0
serverId      = 3fd66141e73fc9e5cd6cf6c870312fe6b72d7e2b
RFC 4231 case 2: HMAC-SHA256("Jefe", "what do ya want for nothing?")
              = 5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843
```
keyId         = cf30c015424732d9

## Appendix C: API differences the adapters cover (from the version research)
| Era | Text | Button | Screen/render | Toast | Widgets | `publishServer` | `ConnectScreen` | `ServerData` |
|---|---|---|---|---|---|---|---|---|
| 1.18.2 | `TextComponent`/`TranslatableComponent` | `new Button(x,y,w,h,Component,OnPress)` | `addRenderableWidget`, `render(PoseStack,..)` | `mc.getToasts()`, `SystemToastIds` | `EditBox(Font,x,y,w,h,Component)` | `(GameType,bool,int)` | `startConnecting(Screen,Minecraft,ServerAddress,ServerData)` | `(String,String,boolean)` |
| 1.19-1.19.2 | `Component.literal/translatable` | same | same; `rebuildWidgets` from 1.19.2 | same | same | same | same | same |
| 1.19.3-1.19.4 | same | `Button.builder`; `getX/setX`, `renderWidget` (1.19.4) | PoseStack; `Tooltip` | same | same | same | same | same |
| 1.20-1.20.1 | same | same | `GuiGraphics` | same | same | same | `+ boolean quickPlay` | same |
| 1.20.2-1.20.4 | same | same | `renderBackground(GuiGraphics,int,int,float)`; `mouseScrolled` 4 args | `SystemToastId` (1.20.4) | `Checkbox.builder` (1.20.4) | same | same | `(String,String,Type)` |
| 1.20.5-1.21.1 | same | same | same | same | same | same | `+ TransferState` | same |
| 1.21.2-1.21.8 | same | same | 1.21.6 GUI render state rewrite (text/fill API kept) | `mc.getToastManager()`, `Toast.render(GuiGraphics,Font,long)` | same | same | same | same |
| 1.21.9-1.21.11 | same | `onPress(InputWithModifiers)` | `MouseButtonEvent`/`KeyEvent`; `Identifier`, `init(int,int)` (1.21.11) | same | same | same | same | same |
| 26.1 | same | same | `GuiGraphicsExtractor`, `extractRenderState`; `Minecraft.setScreen` | `mc.getToastManager()` | same | `(GameType,bool,int)` | same | same |
| 26.2 | same | same | `mc.gui.screen()` / `gui.setScreen` | `gui.toastManager()`, `FriendToast` | same | `(MultiplayerScope,GameType,bool,int)` | same | same |
| 26.3 | same | same | same | same | same | `(MultiplayerScope,bool,int)` | same | same |
Pause-menu guard: "is `PauseScreen` and has widgets" on every version (`showsPauseMenu()` only from 1.20.3). Session join: authlib `joinServer(GameProfile,String,String)` before 1.20.2, `joinServer(UUID,String,String)` from 1.20.2.
