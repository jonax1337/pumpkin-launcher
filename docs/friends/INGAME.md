# Pumpkin Friends in-game: an auto-injected, launcher-only mod

Concept of 2026-10-03, amended 2026-10-04 with the findings of waves 0 and 1 (`INGAME-API.md`, `INGAME-SMOKE.md`, `mod/README.md`, the Rust code on `feat/ingame-mod`). Where this document and an older text disagree, this document wins. Replaces the draft `MOD2.md` and its review `MOD2-REVIEW.md` (both stay in the repo as superseded research; section 13 lists what was carried over and what fell away). Base documents: `SPEC.md` (friends feature, bridge), `BYNAME.md` and `BYNAME-ATTEST.md` (add by name; the directory login uses Mojang's player certificate), `PRIVACY.md`, `INGAME-API.md` (Minecraft API evidence, real node list), `INGAME-SMOKE.md` (what the smoke runs proved). Written against `feat/ingame-mod` at e36d48c; the next launcher release is **0.2.0** (A23; the 2.x version numbers and tags were deleted on 2026-10-04, so the `2.0.1` seen in older logs and fixtures is history).

## Status (2026-10-04)

Branch `feat/ingame-mod`. **Waves 0 and 1 are merged** (D0, S0, S1, L1, L2a, M1a, D1, M1b, L2b, W1, S2), **wave 2 is in flight** (U1 with the compat layer and the widget kit is merged, render proof of the kit demo on the four Fabric nodes; F1 is merged, A20; D2 is this change; U2, J1, V1a and G1 are open). The launcher side is complete: embedding build step, injection in `prepare_launch`, `InjectionState` persistence, `friends_ingame_status` / `set_enabled` / `retry`, the events `friends-ingame` / `friends-ingame-failed`, the settings `ingame_menu` and `ingame_actions` (A14).

**Five cells are smoke-proven** (real runs on the owner's Windows machine, evidence and log excerpts in `INGAME-SMOKE.md`, entries in `mod/verified.json`): `26.3-fabric` (full mod, bridge handshake), `1.21.1-fabric` (obfuscated, remapped jar + Mixin), `1.21.1-neoforge` and `1.20.1-forge` (`--fml.mavenRoots`), `26.2-neoforge` (`-Dfml.modFolders`); the non-ASCII path (ü + space) and the `FILE_SHARE_READ` handle (hold and release) passed for all five (A21). **`1.21.8-fabric` and `1.21.11-fabric` are the only unverified nodes** and stay off until package V1a smokes them. Nothing is released to players yet: the injection exists only on `feat/ingame-mod`.

| Package | State | What exists |
|---|---|---|
| D0 docs | merged | `SPEC.md`, `PRIVACY.md`, `VERIFICATION.md`, owner checklist carry the in-game concept |
| S0 API spike | merged | `tools/mc-api-probe/`, `INGAME-API.md` (11 API runs, 19 nodes, loader hooks) |
| S1 topology | merged | `mod/` Stonecutter project, `nodes.txt`, `mod-index.json` writer, `validate-mod-index.mjs`, layer check, `mod.yml` node matrix; seven nodes exist (four full fabric nodes, one NeoForge per FML era, the Forge tracer) |
| L1 injection core | merged | `services/friends/ingame/`: index + validation, node selection, Java check, materialise, argument merge, gate, breaker state, startup-failure patterns |
| L2a bridge 2 | merged | `services/modbridge/`: protocol 2, owner check, exclusive bind, launch records, scopes, op/topic types, golden fixtures `mod/fixtures/protocol/` |
| M1a mod core | merged | `mod/core/`: bridge client, backoff, protocol, state store, sanitiser, JUnit tests |
| D1 concept amendments | merged | A1 to A13 in this document |
| M1b mod core, second half | merged | view-models and layout, self-hash for `hello.mod.build`, `ready`, all topics |
| L2b bridge ops | merged | dispatch of every op of 5.4, topic pushes, consent backend (two scopes, caps), `launcher.open`, activity list, `Expectations.pre_granted` |
| W1 wiring | merged | injection called from `prepare_launch` / `spawn_game` / `launch_env`, launch registration with `node_id`, `build_id`, `pre_granted`, live breaker scan and post-mortem, A12 items removed |
| S2 smoke harness | merged | `src-tauri/tests/smoke` (Cargo feature `smoke`, never default, never in the release workflow, A18), `tools/mod-smoke/`, `.github/workflows/mod-smoke.yml`; five cells green (A21) |
| F1 frontend | merged | instance status row, settings, consent dialog (scope + summary, 1 s guard), breaker dialog, activity list, mod-open navigation (A20) |
| D2 (this change) | merged | A14 to A24 folded in, docs re-aligned |
| U1 compat + kit | merged | compat layer for the four eras, widget kit with layout models, kit demo screen with render proof on the four Fabric nodes (`mod/scripts/kit-demo.mjs`), pause-menu hook, toasts |
| U2, J1, V\*, G1 | open | see 11.2 |

Owner brief that shaped this concept (2026-10-03):
1. **No foreign launchers.** Only games started by the Pumpkin Launcher matter.
2. **No manual install.** The user never installs, updates or even sees the mod. When the instance fits (Minecraft version, loader, Java), the launcher builds it into the game by itself.
3. **A real in-game friends menu**, not a status toy: the UI is part of the game.

Words used here:
- **Launcher**: the Pumpkin Launcher (Tauri app). The only process with a network stack for friends.
- **Mod**: the client mod `pumpkin_friends`. It has no network code except a loopback socket to the launcher.
- **Node**: one build target `<minecraft range>-<loader>` that produces exactly one jar.
- **Link**: the authenticated bridge connection between one running game and the launcher.
- **Injection**: the launcher adds the mod to one game launch through loader start-up options, without writing anything into the instance.

---

## 0. The concept in one page

**What the player experiences.** They switch Friends on once, in the launcher (as today). From then on, every Microsoft-account launch of an instance that the launcher can serve starts with a "Pumpkin Friends" button in the pause menu. It opens a hub: friends with presence, requests (accept/decline), invites (join), "share my world", add a friend by name. Nothing was installed, nothing appears in the `mods/` folder, nothing shows up in exports or mod lists. Instances the launcher cannot serve simply work as before, and the instance page says why.

**How it works, in five lines.**
1. The mod jars are **built in the launcher's own CI and embedded in the launcher binary** (one jar per node, plus an index with SHA-256). No Modrinth project, no download, no update flow: mod and launcher are one artifact.
2. At launch the launcher **picks the node** for the instance (exact Minecraft version, loader, loader version, Java major) and, if one fits, **writes the jar to its own data folder** and passes it to the loader through an official extra-mods start-up option (Fabric: `-Dfabric.addMods`; NeoForge/Forge: FML options, see 3.5).
3. The mod finds the launcher through the environment variables the launcher already sets, connects to `127.0.0.1`, and the launcher **verifies the connection belongs to the game process it spawned** (token and OS socket owner).
4. The mod is a thin client: all friend logic stays in Rust. The wire protocol is typed requests and whole-state pushes.
5. Everything the mod touches in Minecraft sits behind a small `compat` layer, so a new Minecraft version costs one node, not a rewrite.

**Why this is smaller than the MOD2 draft.** Dropping foreign launchers removes the discovery file, the mutual HMAC, pairing prompts, the Mojang account proof, process-identity code for foreign PIDs, and 0.1.0 compatibility. Embedding the jars removes the Modrinth project, the publish pipeline, the install button, the mod/launcher version handshake and the "is our mod in the manifest" special cases.

**Decisions taken in this concept** (all overridable; section 14 lists them with the alternative):

| # | Decision |
|---|---|
| 1 | Injection happens only while Friends is switched on, only for Microsoft-account launches, and only if a verified node fits. |
| 2 | The jar lives in the launcher data folder, never in the instance. No managed copy in `mods/` in v1. |
| 3 | The mod depends on nothing the user must have: no Fabric API requirement. One soft Mixin on Fabric, loader events on NeoForge/Forge. |
| 4 | Jars are embedded in the launcher (`include_bytes!`), hash-checked before every launch. |
| 5 | A support-matrix cell is shipped only after a headless CI smoke test of that exact cell passed with the real injection path. Unverified cells are off, not guessed. |
| 6 | Vanilla instances, Quilt, offline accounts: no injection in v1. |
| 7 | Identity and privacy operations (enable, disable, rotate, reset, relay consent, copying the peer id) stay launcher-only for good. |
| 8 | Three releases: R-A (core loop on the verified nodes), R-B (friend management, more nodes), R-C (audit, undo, polish). |
| 9 | A start failure caused by the mod switches injection off for that instance and says so (circuit breaker). |

---

## 1. Scope

### 1.1 Goals
- **G1 Zero-touch.** No install step, no update step, no file in the instance.
- **G2 Parity where it makes sense.** Every everyday friends action works in-game (list, requests, invites, share, join, add by name; later codes, rename, remove, block). Identity and privacy operations are launcher-only on purpose (decision 7).
- **G3 Safe by construction.** The mod cannot start a network connection to anything but the launcher. The launcher treats every mod request as untrusted (section 5.1 is honest about what that does and does not buy).
- **G4 Cheap to extend.** A new Minecraft release is one node plus changes inside `compat/`.
- **G5 Never break the game.** If the mod cannot be loaded safely it is not injected; if it breaks a start anyway, the next launch is without it (3.8).

### 1.2 Non-goals
- Any launcher other than the Pumpkin Launcher; games started from outside it.
- Installing the mod by hand; publishing it on Modrinth/CurseForge.
- A background service, a listening socket in the mod, HTTP/P2P/Mojang calls in the mod.
- Turning Friends on from inside the game (the bridge does not exist before the opt-in; SPEC 12.1 stays true).
- Quilt, Vanilla (no loader), offline accounts, Minecraft below the launcher's sharing floor (1.20, `MIN_MC_RELEASE_TIME`), servers, Forge above 1.20.1, NeoForge 20.x, Minecraft 1.16 to 1.19 (all "later, on demand", section 2.3).
- Friend faces in-game, a client chat command, automated in-game UI tests beyond the smoke test.

---

## 2. Where the mod runs: support matrix

### 2.1 The rule
A cell `(Minecraft release id, loader)` is **supported** if and only if
1. the embedded index has a node whose `minecraft` list contains that exact release id and whose loader and minimum loader version match,
2. the Java that will run the game has a major version of at least `node.javaMin`,
3. the node's `verified` entry exists in the index (smoke test passed in CI for that node on the commit that built it). `verified` null or absent means the cell is OFF (`Node::is_verified`).

The `minecraft` list is **explicit release ids, not an open range**. A Minecraft release that is newer than the index gets no node and therefore no injection until a launcher release adds it. This is deliberate: a wrong guess means a game that does not start (3.8 limits the damage, it does not remove it). Snapshots, pre-releases and release candidates never match.

### 2.2 Node list (spike S0; amendment A1)

The real list is `INGAME-API.md` section 5: **19 nodes, 11 Fabric, 7 NeoForge, 1 Forge**, machine-readable with the field names of `mod-index.json` (source `tools/mc-api-probe/nodes.json`, checked against the Mojang manifest). Each node is one API run (`INGAME-API.md` section 4: inside a run no member the mod uses changes its signature). Rules:

- **Node id** = `<highest release id of the node>-<loader>`: `1.21.1-fabric` serves 1.20.5 to 1.21.1. The id is a name; nothing parses it as a version (`mod/README.md`).
- **NeoForge only for versions with a stable build.** Releases that have beta builds only (1.21.2, 1.21.6, 1.21.7, 1.21.9, 26.1, 26.1.1, 26.3) stay Fabric-only until a stable build exists.
- **Forge** only 1.20.1 (47.x). Quilt, NeoForge 20.x, Minecraft below 1.20: not in the list (2.3).
- `javaMin` is the lowest Java Mojang requires for any release of the node; Fabric `loaderMin` is the highest loader floor of the node's releases; NeoForge `loaderMin` is the first non-beta build of its lowest series.

| Minecraft | Java | Fabric node | NeoForge node | Forge node |
|---|---|---|---|---|
| 26.3 | 25 | `26.3-fabric` | - (beta only) | later |
| 26.2 | 25 | `26.2-fabric` | `26.2-neoforge` | later |
| 26.1 - 26.1.2 | 25 | `26.1.2-fabric` | `26.1.2-neoforge` (26.1.2 only) | later |
| 1.21.11 | 21 | `1.21.11-fabric` | `1.21.11-neoforge` | later |
| 1.21.9 - 1.21.10 | 21 | `1.21.10-fabric` | `1.21.10-neoforge` (1.21.10 only) | later |
| 1.21.6 - 1.21.8 | 21 | `1.21.8-fabric` | `1.21.8-neoforge` (1.21.8 only) | later |
| 1.21.2 - 1.21.5 | 21 | `1.21.5-fabric` | `1.21.5-neoforge` (1.21.3 - 1.21.5) | later |
| 1.20.5 - 1.21.1 | 21 | `1.21.1-fabric` | `1.21.1-neoforge` (1.21 - 1.21.1) | later |
| 1.20.3 - 1.20.4 | 17 | `1.20.4-fabric` | later | later |
| 1.20.2 | 17 | `1.20.2-fabric` | later | later |
| 1.20 - 1.20.1 | 17 | `1.20.1-fabric` | (NeoForge 20.x: later) | `1.20.1-forge` |

Stage: **seven nodes exist** in `mod/nodes.txt` (S1, widened by the later waves): the four Fabric nodes `26.3-fabric`, `1.21.1-fabric`, `1.21.8-fabric`, `1.21.11-fabric`, plus `1.21.1-neoforge` (FML 9, `fmlMavenRoot`), `26.2-neoforge` (FML 11, `fmlModFolders`) and `1.20.1-forge`. **Five of them are smoke-proven** (`mod/verified.json`, A17, evidence in `INGAME-SMOKE.md`); `1.21.8-fabric` and `1.21.11-fabric` are the only unverified nodes and stay off until V1a smokes them (A21). The remaining twelve nodes of `INGAME-API.md` section 5 arrive with R-B (11.1). Every node is a compile target, a smoke run and an owner-checked cell, so the count is a budget: merging nodes (for example 1.21.9-1.21.10 with 1.21.11) needs reflection or `MethodHandle` for the differing calls and is not planned before R-B.

### 2.3 "Later" and "never"
- **Later, on demand**: Forge above 1.20.1 (third toolchain, EventBus changes), NeoForge 20.2-20.6 (needs NeoGradle), Minecraft 1.18.2-1.19.4 (needs the launcher's sharing floor lowered, a security decision, see MOD2-REVIEW), Quilt (Quilted Fabric API has no 26.x release; a Quilt cell needs its own smoke proof), Vanilla instances (opt-in "add Fabric", section 3.9).
- **Never**: Minecraft 1.15 and older, Java agents with bytecode patching.

---

## 3. Injection: how the mod gets into the game

### 3.1 Principle
The jar is **launcher data, not instance content**. It is materialised under `<data>/runtime/friends-mod/<modVersion>/` (flat as `<file>` for `fabricAddMods` and `fmlModFolders`, in its own Maven folder for `fmlMavenRoot`, 3.5) and handed to the loader by start-up options. Consequences (all wanted):
- Instance export (`.mrpack`), duplicate, templates, pack update, `adopt_untracked` and the content scan never see it: they walk the instance folder.
- The host's content manifest and the guest's matching never see it. The SPEC 5.5/5.6 special case "ignore our mod if its sha512 resolves to `MOD_PROJECT_ID`" is gone for good: the "our mod" special cases in `friends/lookup.rs` and `manifest.rs` are removed with it (A12, section 8).
- A user cannot delete it by editing mods, a modpack update cannot overwrite it.
- Nothing needs cleaning up when the launcher is removed except its data folder.

### 3.2 Embedding
- The Gradle build (`modIndex` task in `mod/`) writes `mod-index.json` next to the jars. `modVersion` exists **once**, at the top level. Per node: `id`, `loader` (`fabric|neoforge|forge`), `loaderMin`, `minecraft[]` (explicit release ids), `javaMin`, `strategy` (`fabricAddMods|fmlMavenRoot|fmlModFolders`), `file`, `sha256`, `verified` (null or absent, or `{smoke: "YYYY-MM-DD", owner: null|"YYYY-MM-DD"}`). Field names are camelCase; unknown fields are rejected. `verified` is filled from `mod/verified.json` (A17): **only a passed smoke run adds an entry**, never a human.
- Validation is strict and runs in two places with the same rules, `mod/scripts/validate-mod-index.mjs` (build) and `src-tauri/src/services/friends/ingame/{index,validate}.rs` (launcher, `mod/index.schema.json` as schema): node ids and file names are unique, `(loader, minecraft id)` is unique across nodes, the strategy must suit the loader (`fabricAddMods` for Fabric, `fmlMavenRoot` and `fmlModFolders` for NeoForge and Forge), ids, file names and `modVersion` start with a letter or digit and use only letters, digits and `._+-` (at most 128 characters), `minecraft` is a non-empty list of release ids without duplicates, `javaMin` is 8 to 64, `sha256` is 64 lowercase hex characters, `file` ends in `.jar`. A node whose entry is invalid makes the whole index unusable. `verified` null or absent = the cell is OFF.
- `src-tauri/build.rs` (or a generated `mod_jars.rs`) embeds the index and the jars with `include_bytes!`. Bytes inside the signed launcher binary are harder to tamper with than resource files next to it.
- Budget: each jar at most 300 KB, all jars together at most 8 MB; CI fails above that. The jars are compressed already; no extra compression.
- Dev builds without jars (`tauri dev`) get an empty index: injection reports "not available in this build". `cd mod && ./gradlew modIndex` produces the jars for local work.
- Release CI order: `mod` matrix (build + smoke) -> artifact -> per-OS launcher build consumes the artifact. The mod version equals the launcher version.

### 3.3 When the launcher injects
All of these must hold, checked in `prepare_launch` right before the argument list is built:
1. Friends is enabled and the bridge is running (as today: the bridge only exists after the opt-in).
2. The launch uses a Microsoft account (`online_account`), as today for the bridge env.
3. The instance's loader is Fabric, NeoForge or Forge (Quilt and Vanilla: none). A NeoForge or Forge cell is on only once its own `verified` entry exists.
4. A node fits (2.1) and the Java check passes.
5. The user did not switch the mod off globally or for this instance, and the circuit breaker (3.8) is not tripped for it.
6. No other copy of `pumpkin_friends` is in the instance (a dev jar, a copy someone built). Detection reuses the mod metadata reader that the content analysis already has (`content/jar_meta.rs`). Two mods with one id are resolved differently by every loader (Fabric picks one silently, Forge 1.12 crashes), so the launcher skips and says so.

If any check fails, the launch is **byte-identical to today**: no argument, no env.

### 3.4 Java check
A Fabric mod with `depends: java >= N` that meets an older Java produces the loader's error screen, i.e. a game that does not start. The launcher therefore compares the Java it resolved (Mojang runtime component or the user's custom `java_path`) with `node.javaMin` before injecting. For custom Java paths it reads the major from the runtime's `release` file or by running `java -version` once and caching the answer per path.

### 3.5 Strategy per loader (evidence in Appendix A)

| Loader / era | Strategy id | What the launcher adds | Evidence |
|---|---|---|---|
| Fabric (loader >= 0.12) | `fabricAddMods` | `-Dfabric.addMods=<jar>` (or `@listfile`). **Obfuscated nodes (1.20 to 1.21.11) must ship the Loom-remapped jar** (intermediary names plus refmap): a jar passed through `fabric.addMods` is not remapped at runtime outside a development environment (A4). 26.x nodes stay in Mojang names | Fabric Loader source (`ArgumentModCandidateFinder`, `FabricLoaderImpl`, `INGAME-API.md` 6.1); NoRiskClient ships exactly this in production (`docs/research-noriskclient.md:92-96`). **Proven by the smoke** on `26.3-fabric` (Mojang names, bridge handshake) and `1.21.1-fabric` (remapped jar, Mixin applies), `INGAME-SMOKE.md` rows 1. |
| NeoForge 21.x up to FML 9 and Forge 1.17.1-1.20.2 | `fmlMavenRoot` | `--fml.mavenRoots <dir> --fml.mods dev.laux.pumpkin:pumpkin_friends:<ver>`. The jar lies in its own folder per node, `<runtime>/maven-<nodeId>/dev/laux/pumpkin/pumpkin_friends/<version>/pumpkin_friends-<version>.jar`, and `<dir>` is `<runtime>/maven-<nodeId>` (A9) | FML `MavenDirectoryLocator` read in source for Forge 1.20.1-47.4.0 and NeoForge FML 4.0.44; **proven by the smoke** on `1.21.1-neoforge` (21.1.253) and `1.20.1-forge` (47.4.26), `INGAME-SMOKE.md` rows 3 and 5. |
| NeoForge 21.9+ and 26.x (FML 10+) | `fmlModFolders` | `-Dfml.modFolders=pumpkin%%<jar>` | FML `InDevFolderLocator` source: always registered, no production guard. It is a development feature and may change. **Proven by the smoke** on `26.2-neoforge` (26.2.0.88), `INGAME-SMOKE.md` row 4; the unsmoked FML 10/12 series stay off with their nodes. |
| Quilt, Vanilla | none | nothing | out of scope in v1 |

Rules for the table:
- It is **data in the index**, not code branches. A cell whose strategy fails the smoke test has `verified` empty and is off.
- Fallback "managed copy in `mods/`" exists only on paper (Appendix A). It would need exclusions in export, duplicate, adopt, content scan and manifest plus crash cleanup, and it makes the mod visible. A cell that only works that way stays unsupported until someone decides the exclusion work is worth it.
- The mod is **never** injected through a Java agent or the classpath: a classpath jar is not a loader-sanctioned mod source on production Fabric, and a bytecode-patching agent is a per-version maintenance sink.

### 3.6 Merging with the user's start-up options
The launcher builds arguments in `launch::build_args`; injected options go **after** the version JSON's JVM args and **before** the user's `extra_jvm_args`, so a user can still override. For `fabricAddMods` and `fmlModFolders` the property may already be set by the user or a pack (`-Dfabric.addMods=...` is common in dev setups). A second `-D` of the same name makes the last one win, which would drop either ours or theirs, so the launcher **parses the existing value and merges**: path-list values are joined with the platform separator; an `@listfile` value is rewritten into a combined list file in the launcher data folder. Rust tests cover: no existing property, plain value, list file, duplicate occurrences, quoted values.

Duplicates (A9, `ingame/args.rs`, `property.rs`):
- **Duplicate `-Dfabric.addMods` / `-Dfml.modFolders`** follow JVM semantics: the **last** occurrence is the user's value; all occurrences are removed from the user's arguments and reported as `replaced` (for the log). Our entry is appended exactly once.
- **`fmlMavenRoot`** options may repeat, so the user's own `--fml.mavenRoots` / `--fml.mods` stay; only an identical pair of ours is removed and reported.
- `args::build` returns the user arguments **already reduced by what was replaced** (`user_jvm`, `user_game`); the caller uses those instead of the originals.

### 3.7 Integrity
- Compile-time SHA-256 per jar. Before every launch the launcher checks the materialised file; if missing or different it rewrites it atomically (temp file + rename) and marks it read-only.
- On Windows the launcher keeps the file open with `FILE_SHARE_READ` until the game has spawned, so the check-to-load window is closed. (`MaterialisedJar` holds the handle; every loader read the jar in both smoke scenarios, handle held and released, on all five cells — `INGAME-SMOKE.md` row 6b.)
- The index entry's `sha256` is also part of the launch record (`Expectations.build_id`, 5.3); the mod reports a prefix of the SHA-256 of its own jar in `hello` and the launcher refuses a mismatch with `reject{build}`. This catches "another copy of the mod answered". A jar cannot embed its own hash, so the mod computes it at runtime (5.3, A6).
- This protects against corruption and accidental overwrites. It does not protect against an attacker who can already change the launcher binary or run code as the same user (5.1).

### 3.8 Circuit breaker
The only way this feature can hurt a player is a game that does not start. So:
- The launcher watches the first 90 seconds of a launch (`STARTUP_WINDOW`). **The log decides; exit code and window only gate the log check** (A8): a crash that does not name the mod (out of memory, broken pack, a foreign mod) never trips the breaker, a non-zero exit alone is not a reason. The log shows a loader/Mixin failure that names `pumpkin_friends` (or the package `dev.laux.pumpkin`) within 25 lines of the failure line (Fabric "Incompatible mod set", Mixin apply/injection errors, FML "mod loading error" lines naming the mod id, `UnsupportedClassVersionError` for the jar) -> the instance's injection state becomes `autoOff{reason, launcherVersion}`.
- Two entry points in `ingame/startup_failure.rs`: `analyze_log` is the live scan of the first 90 s (Fabric shows its error page and ends the process only when it is closed, so waiting for the exit is too late); `analyze_exit` is the post-mortem after the process ended (exit code not 0 or killed from outside, uptime within the window, then the same log check).
- The player sees a dialog once: "Das Spiel ist beim Start abgestürzt. Das Freunde-Menü könnte die Ursache sein. Ohne starten?" with "Ohne Freunde-Menü starten" and "Trotzdem erneut versuchen".
- `autoOff` is lifted when the launcher version changes (a fixed node may exist) or when the player flips the toggle. Detection patterns are data with tests (fixture logs for each loader).
- False negatives are possible (a crash after 90 s). That is accepted; the in-game mod itself is exception-guarded (4.2).

### 3.9 What the player sees in the launcher
The instance page replaces today's "add mod" row (`FriendsModRow`) by a status row. It never offers an install button.

| State | Text (de) | Notes |
|---|---|---|
| active | "Freunde-Menü im Spiel: aktiv (Fabric 1.21.1)" | "verbunden" while a link is up |
| off by user | "Freunde-Menü im Spiel: aus" + switch | per-instance and global switch |
| vanilla | "Braucht einen Loader. Fabric hinzufügen?" | one click changes the instance loader; never automatic |
| unsupported | "Für NeoForge 1.20.4 noch nicht verfügbar" | lists the reason code: version, loader, Java |
| java | "Java {n} oder neuer nötig" | |
| id collision | "Im Ordner mods liegt schon eine pumpkin_friends-Datei" | |
| offline account | "Nur mit Microsoft-Konto" | |
| tripped | "Nach einem Startfehler ausgeschaltet" + "Erneut versuchen" | circuit breaker |

Friends settings get two controls: "Freunde-Menü im Spiel" (global, default on when Friends is on) and "Aktionen im Spiel" (`Immer fragen` default, or `Erlauben`; 5.5).

---

## 4. The mod

### 4.1 Layers (one source tree)
```
mod/
  core/        Minecraft-free Java: bridge client, protocol, state store, sanitiser, view-models, layout.
               Compiles to Java 17 bytecode (--release 17), runs on every node. All logic and all unit tests.
  compat/      Everything that differs between Minecraft versions: Screen/widget construction, text,
               toasts, clipboard, LAN publish, connect, disconnect. One implementation per node range.
  platform/    One thin entry class per loader: Fabric (Mixin + ClientModInitializer), NeoForge, Forge.
  ui/          Screens built from core view-models and the compat widget kit. No version conditionals.
```
Rules enforced by a CI script: version conditionals only in `compat/` and `platform/`; `ui/` calls only a short allow-list of vanilla types; `core/` never imports Minecraft.

### 4.2 Hooks and dependencies
- **No Fabric API requirement.** The only hook needed is "a screen was initialised, add a button to the pause screen". On Fabric that is one `@Inject(method="init", at=@At("TAIL"), require=0)` into `PauseScreen`, so a changed signature degrades to "no button" and a log line instead of a crash. On NeoForge/Forge it is the screen-init event. Nested Fabric API modules were considered and rejected: a nested module that is newer than the user's own copy can replace it and trip other mods' dependency checks. **A22: the mod has no Fabric API dependency and the smoke installs no companion** (the `depends` block of `mod/descriptors/fabric/fabric.mod.json` lists only `fabricloader`, `minecraft` and `java`); do not reintroduce one.
- **Work comes to the main thread through `Minecraft.execute`**, not a tick hook: the bridge thread posts runnables; a 1-second poster covers the LAN watcher. This avoids a second hook family.
- **No key binding in R-A.** Registration has to happen before options load and differs per loader. R-B adds an unbound binding.
- **Soft failure everywhere.** Every entry point runs inside a guard that logs and disables the mod's UI for the session on any exception. The mod must never throw into the game.
- **Client-only declaration (A3, evidence `INGAME-API.md` 6).**

  | Loader | Declaration |
  |---|---|
  | Fabric | `fabric.mod.json` `"environment": "client"`; `ClientModInitializer` belongs to the loader, no Fabric API |
  | NeoForge | `@Mod(value = "pumpkin_friends", dist = Dist.CLIENT)`; the FML sources have no display-test key |
  | Forge 1.20.1 | `clientSideOnly = true` in `mods.toml`: it implies `IGNORE_ALL_VERSION` for the server list and skips the jar on a dedicated server. `IGNORE_SERVER_VERSION` is the constant for server-only mods and is wrong here |

  Read from loader sources; that a modded server accepts the client is reasoned, not tried (`INGAME-API.md` 8).
- **Toasts (A10).** `compat.Toast` uses `SystemToast.SystemToastIds.PERIODIC_NOTIFICATION` before Minecraft 1.20.3 (the toast id becomes a class `SystemToastId` there) and a toast id of its own after. It never reuses `FRIEND_SYSTEM_NOTIFICATION`: Mojang's own friends UI exists from 26.2 (`INGAME-API.md` 0.9, 7.6). From 1.21.2 the manager is `getToastManager()`, from 26.2 it hangs off `Gui` (`INGAME-API.md` 4).
- **No network code.** The only socket is `127.0.0.1:<port>` from the environment, and the connect target is never taken from anywhere else.

### 4.3 Build tooling
- Stonecutter (release 0.9.8; 0.10 is alpha) with one project per node, Fabric Loom 1.18.2 (no remap on 26.x, remap plugin below via `loom-back-compat`), NeoForge ModDevGradle 2.0.x, ModDevGradle `legacyforge` for Forge 1.20.1. Source in Mojang mappings everywhere (Yarn is gone from 26.1). **The shipped Fabric jar is not in Mojang names below 26.x:** obfuscated nodes (1.20 to 1.21.11) ship the Loom-remapped jar with refmap (3.5, A4); 26.x nodes ship Mojang names.
- **Settled in S1:** the node id and the Minecraft version are separate fields (`mod/nodes.txt`, `mod/README.md`), so an id such as `1.21.1-neoforge` is never parsed as a semver prerelease. The layout stays flat: one source tree, one build script per loader.
- **Gradle runs on JDK 21 or newer for every node** (A5; Stonecutter refuses a Java 17 JVM). The node's JDK drives only `--release`, the run task and the test JVM, found through `PUMPKIN_JDK_<major>` (`mod/README.md`, `nodes.txt` column `java` as the single source of truth, read by the `dev-env` scripts and the workflow). The Gradle JVM is `max(node.java, 21)`.
- **Compile-matrix instead of fingerprinting** (MOD2-REVIEW blocker): each node range is compiled against both ends and one middle version; a descriptor-exact override check covers `Screen` methods the UI overrides. The `javap` fingerprint is only a supplement. The runs and their breaks are in `INGAME-API.md` section 4.
- **The widget kit is compiled and checked against 1.21.1, 1.21.8, 1.21.11 and 26.3** (A11): the 11 API runs contain four render and input models (before 1.21.6, 1.21.6 to 1.21.8, 1.21.9 to 1.21.11, 26.x), so two eras do not freeze the compat contract.

### 4.4 UI robustness rule
Anything whose signature changes between eras is avoided in `ui/`: the mod overrides as few input methods as possible, prefers vanilla widgets with built-in behaviour (`Button`, `EditBox`), and scrolls by buttons plus wheel through one compat method. That keeps the node count driven by real API breaks, not by our own cleverness.

---

## 5. The launcher-mod channel

### 5.1 Trust model, stated honestly
Code running in the game JVM is code running as the player's OS user. Any other mod in the same instance can read the environment (token and port), connect to the bridge, and speak the protocol. On Windows and Linux that code can also read the friends identity key from the OS keyring. Older vanilla releases additionally cache the account's player certificate, private key included, in `<gameDir>/profilekeys/`; whoever holds it can open directory sessions for the account for about 48 hours (`BYNAME-ATTEST`, review finding 2; the launcher already keeps that folder out of packs and templates). So:
- Consent and scopes limit **abuse of the bridge API by greedy or semi-trusted mods**. They are not a defence against malware, and the privacy text says so.
- The launcher therefore keeps the mod's capabilities narrow: no identity operations, no settings that widen exposure, no raw peer ids, no network targets chosen by the mod.
- Whether the connection comes from the game process the launcher spawned is checked by the OS (5.2). That stops a leaked token from being used by a different process, and it is the single hardening the current v1 path lacks.

### 5.2 Connecting and verifying
1. At spawn the launcher creates the **launch record**: `{token, instanceId, node, expectedPid (set when the child is created), online_account, startedAt}` and passes `PUMPKIN_IPC_PORT`, `PUMPKIN_IPC_TOKEN`, `PUMPKIN_IPC_PROTOCOL=2` in the environment (as today; the token never appears on a command line).
2. The bridge listens on `127.0.0.1` with **exclusive address use on Windows** (`SO_EXCLUSIVEADDRUSE`, so a same-user socket cannot co-bind), port chosen by the OS.
3. The mod sends `hello`. The launcher looks the token up, then proves the TCP connection belongs to `expectedPid` with `sockowner::connects_from(pid, peer, local)` (already used for LAN and join; no new reverse lookup). A mismatch gets `reject{owner}`.
   - If the pid is not set yet (the mod connected before spawn bookkeeping finished) the launcher answers `reject{retry}`; the mod backs off and retries.
   - IO errors in the lookup **fail closed** (`reject{owner}`); per-PID unreadable `/proc` entries on Linux are skipped, only a failure to read the socket tables is an error.
   - If the player set a wrapper as Java (a script that spawns the real JVM), the owner is a child of the spawned pid. v1 accepts only the spawned pid and reports "Verbindung nicht zuordenbar" in the instance row; accepting descendants is a later option.
4. One live link per launch. A second connection with the same token gets `reject{duplicate}`; counters and grants belong to the launch, not to the connection, so reconnects cannot reset them.

### 5.3 Protocol 2
The mod and launcher always ship as one build, nothing from protocol 1 was ever published, so protocol 2 replaces it with no compatibility layer. JSON lines, UTF-8. **The shapes are defined by the Rust types (`modbridge/protocol.rs`, `ops.rs`, `topics.rs`) and by the golden lines in `mod/fixtures/protocol/`** (its `README.md` is the reference); the Rust tests and the Java core tests read the same files (`mod/core` test `Fixtures`). A change there is a protocol change.

**Framing and limits.** Until `welcome`: lines up to 1 KiB, `hello` within 2 s, at most 4 unauthenticated connections. After: mod to launcher up to 16 KiB, launcher to mod up to 64 KiB. The mod may send 20 messages per second and keep 8 requests in flight. Outgoing queue 64 per link; a stalled writer (5 s) closes the link. **Either side may send `ping`** (answered by `pong`); the launcher sends one every 10 s, any line from the mod counts as a sign of life, and 30 s without a line from the mod closes the link (`framing.rs` `Liveness`).

**Handshake.**
```
mod -> launcher  {"type":"hello","protocol":2,"token":"<64 hex>","mod":{"version":"2.1.0","build":"<sha256 prefix>"},
                  "game":{"minecraft":"1.21.1","loader":"neoforge","loaderVersion":"21.1.172","java":21}}
launcher -> mod  {"type":"welcome","protocol":2,"launcher":"2.1.0","scopes":{"share":"ask","social":"ask"}}
              or {"type":"reject","reason":"token|protocol|owner|build|duplicate|retry"}
```
The `game` block is diagnostics; the launcher knows the truth and logs a mismatch. `scopes` values are `ask` or `allow` (`allow` when the setting "Aktionen im Spiel" pre-grants, 5.5).

**`hello.mod.build` (A6).** The mod computes the SHA-256 of **its own jar file** at runtime (the code source of its own class) and sends a lowercase hex **prefix of at least 16 characters**, or the literal `"dev"` when it does not run from a `.jar` (development environment). The launcher compares the prefix with the full SHA-256 it holds in `Expectations.build_id`: a report shorter than 8 characters or not a prefix is `reject{build}`; the check is skipped when `build_id` is `None`, so `"dev"` is accepted only for a launch registered without a build id (`modbridge/state.rs` `build_matches`). A jar cannot embed its own hash, so there is no build-time constant.

**Reject.** `reject` is followed by the launcher closing the connection. A `hello` in the shape of protocol 1 (`"protocols":[...]`, `mod` as a string) gets `reject{protocol}` instead of being dropped as garbage (`server.rs`); so does a protocol-2 shaped `hello` with another `protocol` number.

**Requests and responses.**
```
{"type":"req","id":"a1","op":"friend.addByName","args":{"name":"Notch"}}
{"type":"res","id":"a1","ok":true,"result":{}}
{"type":"res","id":"a1","ok":false,"error":{"code":"nameUnknown","params":{}}}
{"type":"pending","id":"a1","prompt":"scope","scope":"social"}   // launcher dialog is open; final res follows within 125 s
```
Ids match `^[a-z0-9]{1,12}$`. Mod-side timeouts: 15 s, 30 s for slow operations, 130 s after `pending`. `pending` is `{type, id, prompt: "scope", scope: "share"|"social"}`; the launcher's own deadline for any answer is 125 s (`REQUEST_DEADLINE`).

**Error codes** (`error.code`, `params` always an object; the mod maps them to texts): `notEnabled`, `peerOffline`, `guestLimit{max}`, `lanPortUnknown`, `portNotGame`, `denied`, `versionUnsupported{min}`, `msAccountRequired`, `busy`, `rateLimited`, `unsupportedOp` (the op exists but this launcher release does not handle it yet), `badRequest` (unknown op, wrong arguments, duplicate or invalid id), `unknownFriend` (alias not known on this link), `notFound`, `nameUnknown`, `directoryUnavailable`, `instanceMismatch` (`invite.joinHere`: the running game does not fit the invite — other instance, version or content), `forbidden` (never allowed for the mod, even with consent: `friend.acknowledge` of a notice only the user can review in the launcher), `timeout`, `internal`. One golden line per code: `errors.jsonl`.

**State topics (launcher to mod).** Whole-value pushes with a per-topic revision, coalesced to one per topic per 250 ms. The mod replaces its copy; it never patches.
`me`, `friends`, `requests`, `invites`, `session`, `join`, `game` (R-A); `codes`, `blocked` (R-B). The `me` topic carries the **directory line** (`active|off|unreachable|notAllowed|unavailable`, A15) that the "Per Name" tab of 6.2 mirrors. Friends are addressed by **per-link aliases** (`f1`, `f2`, ...), never by peer id. Each topic has a hard element cap and a Rust test that its worst case fits in 60 KiB.

**Events (launcher to mod).** Wire shape `{"type":"event","event":"notify","kind":"...","name":"..."}` (`name` optional) and `{"type":"event","event":"closing","reason":"..."}`. `notify` kinds for toasts: `requestReceived`, `inviteReceived`, `friendOnline`, `guestJoined`, `guestLeft`, `sessionEnded`, `joinEnded`, `scopeDenied`. `closing` reasons: `launchEnded`, `bridgeStopped`, `replaced` (a new start of the instance replaced the token); the launcher closes right after. Queue of 32, drop-oldest; responses never drop.

**Mod to launcher besides requests.** `lanOpened{port}`, `lanClosed` (hints only; the launcher re-verifies the port against the game pid, SPEC 6.1), `ready{screens: [string]}` (diagnostic, used by the smoke test and the instance row; `screens` are the names of the screens the mod offers, for example `["hub","share"]`), `ping`, `pong`.

### 5.4 Operations

Scope column: `-` needs none, `S` share, `C` social. Stage column: release that ships it.

| Op | Does | Scope | Stage |
|---|---|---|---|
| `state.sync` | resend all topics | - | A |
| `launcher.open{target}` | bring the launcher window to the friends page (friends, requests, invites, settings); 1 per 10 s; never while a dialog is open | - | A |
| `request.answer{id,accept}` | accept or decline an incoming request | C | A |
| `request.cancel{id}` | withdraw an outgoing request | - | A |
| `friend.addByName{name}` | send a request by Minecraft name (BYNAME); launcher-side rate limited. While any game link is active the launcher answers from the cached player certificate only and never fetches a new one (`directoryUnavailable` instead, A16 and the note below) | C | A |
| `invite.decline{id}` | decline an invite | - | A |
| `invite.plan{id}` | match verdict for the running instance and alternatives (SPEC 5.6) | - | A |
| `invite.joinHere{id}` | join the invite from the running game (section 7) | C | A |
| `join.leave` | leave the joined session | - | A |
| `host.invite{friends[],showWorld}` | start sharing the published LAN world and invite | S | A |
| `host.kick{friend}`, `host.stop` | remove a guest, end sharing | - | A |
| `join.failed{}` | the mod reports that its connect to the join failed (7); op #22 | - | A |
| `friend.addByCode{code}`, `code.create`, `code.revoke{id}` | codes | C | B |
| `friend.rename`, `friend.remove`, `friend.block`, `blocked.unblock` | graph changes | C | B |
| `friend.acknowledge{id}` | clear a "renamed" notice only (never `identityChanged`, never `addedInGame`) | C | B |
| `friends.retry` | redeliver pending requests now | - | B |

The table is complete for protocol 2: `OP_NAMES` in `modbridge/ops.rs` holds exactly these **22 ops** and `mod/fixtures/protocol/ops.jsonl` has a golden request for each, `join.failed` included (A15; the earlier text assumed no such op). `friends/mod_link_ops.rs` dispatches every op of the table (L2b is merged); the launcher additionally sees a join itself through the `join` topic (`waitingForGame`, `connecting`, `connected`) and `notify{joinEnded}`.

**While any game link is active the launcher never fetches a new player certificate** (A16): the directory loop, `friend.addByName` and `friends.retry` all work cached-only and answer `directoryUnavailable` when the cache is empty or stale, so a running game's chat key is never disturbed by a certificate fetch. The guard lives in the by-name service (`game_link_active` / `CertificateSource`); it is unconditional, not tied to owner test O-5.

Never in-game, no op exists: enable, disable, rotate identity, reset, settings changes (display name, findable, relay), relay consent, copying the full peer id, reviewing `identityChanged`/`addedInGame` notices. The Options tab shows them read-only with "Im Launcher öffnen".

### 5.5 Consent
Two scopes, asked **once per game launch** in the launcher:
- `share` (host.invite): "Dieses Spiel möchte deine Welt mit ausgewählten Freunden teilen."
- `social` (graph changes, answering requests, joining): "Dieses Spiel möchte Freunde hinzufügen, Anfragen beantworten und Einladungen annehmen."

Prompt buttons: "Ablehnen" (initial focus) and "Erlauben (bis Spielende)". The setting "Aktionen im Spiel" (`ask` default, or `allow`) can pre-grant, so players who trust their mod set never see the prompt. The launcher passes it as **`Expectations.pre_granted`** when it registers the launch (A13), so the grant belongs to the launch record like every other counter; `welcome.scopes` then reports `allow`. (3.9 and the first text of this section said "per instance"; the setting is one global control, 3.9. `pre_granted` is a field of `Expectations` since L2b.) In-game, a pending request shows a `LauncherWaitScreen` ("Bestätige im Pumpkin Launcher", Abbrechen only stops waiting).

Hardening carried from the MOD2 review:
- The dialog keeps every non-deny button disabled for at least 1 s after it is visible and focused, restarting on each focus change, and ignores a pointer-up whose pointer-down happened before the dialog appeared.
- `launcher.open` never restores or focuses the window while a dialog is open.
- Every counter, prompt cap and grant is keyed on the launch record, so reconnecting does not reset it.
- Caps: 1 open prompt per launch, at most 3 prompts per 10 minutes, then silent `denied`.

### 5.6 Rate limits (per launch, sliding window)
`friend.addByName` 5 per minute and 20 per hour; `request.answer` 20 per minute; `host.invite` 3 per minute (as today); `launcher.open` 1 per 10 s; everything else 30 per minute. Exceeding returns `rateLimited` and counts toward the 20 msg/s connection limit.

### 5.7 Visibility
Every `social` and `share` operation executed from the game raises a launcher toast ("Im Spiel: Anna als Freund hinzugefügt") and an entry in an in-memory activity list (last 100) on the friends page. R-C adds persistence, a "Rückgängig" button for add/accept/remove/block/rename, and the review notice `addedInGame` for friendships created in-game.

---

## 6. In-game UI

### 6.1 Entry points
- **Pause menu button** "Pumpkin Friends" placed below the last vanilla button column; skipped when it would overlap a widget. Shown whenever the mod is not inert, also while disconnected (the hub then explains).
- **R-B:** a text button `PF` left of "Mehrspieler" on the title screen (skipped when overlapping, e.g. Mojang's own friends button on 26.2+) and an **unbound** key binding "Pumpkin Friends öffnen". Key `O` is never bound.
- Every entry opens the hub on the tab with pending items first: Anfragen, else Einladungen, else Freunde.

### 6.2 Screens
Design size 320x240 GUI px, also checked at 427x240, 480x270, 640x360 and 960x540. Content width `min(310, width-20)`, rows 24 px (36 px for two-line rows), buttons 20 px.
```
HubScreen   title · status line · TabBar · ScrollPane · footer ["Fertig"]
├─ Freunde        rows: name · sub-line (Online / Spielt / Relay / notice) · [Beitreten|Einladen] · […] (R-B)
│                 footer [Freund hinzufügen] -> AddFriendScreen (Per Name (R-A) | Code eingeben, Mein Code (R-B))
├─ Anfragen (n)   incoming: name · "Minecraft: {mcName}" · fingerprint · [Annehmen][Ablehnen]
│                 outgoing: text · [Zurückziehen]            footer [Jetzt zustellen] (R-B)
├─ Einladungen (n) rows: "{from} · {title}" · [Ansehen -> InviteScreen] [Ablehnen]
├─ Teilen         state machine (6.4)
└─ Optionen       read-only: fingerprint, network line, who may do what ("Aktionen im Spiel: fragen"),
                  [Im Launcher öffnen]; R-B adds the toast switches
LauncherWaitScreen   "Bestätige im Pumpkin Launcher" · [Abbrechen]
ConfirmFlow          in-game yes/no for destructive in-game steps (remove, block, leave world)
```
The "Per Name" tab mirrors the launcher: `directory` states `unreachable`, `notAllowed` and `off` show the launcher's texts. R-A has no code entry in-game, so on `unreachable` the tab offers "Im Launcher öffnen" (friend codes) instead of "nutze einen Code".

Esc goes to the parent screen. Tab order follows visual order; Enter in an `EditBox` submits. Every row is a focusable widget with a full narration line. All text goes through `pumpkin_friends.*` language keys (`en_us`, `de_de`); the lang files are **append-only** (A19: a key is never renamed or removed, because old jars keep running against them); player-controlled strings are sanitised and only ever rendered as literals. Errors are shown inline with a "⚠" prefix plus a toast for asynchronous results.

### 6.3 Hub states
| State | Body |
|---|---|
| connecting / backoff | "Verbinde mit dem Launcher…" |
| pending prompt | "Bestätige dieses Spiel im Pumpkin Launcher." |
| rejected (`owner`, `build`, `protocol`) | text from the error catalogue, with "Im Launcher öffnen" |
| `me.enabled == false` | "Pumpkin Friends ist im Launcher ausgeschaltet." + [Im Launcher öffnen] |
| availability `identityLost` / `noSecretStore` | status text + [Im Launcher öffnen] |
| loading | "Lade…" until the first push of each topic |
| empty lists | "Noch keine Freunde" (+ add button), "Keine offenen Anfragen", "Keine Einladungen" |

### 6.4 Teilen tab
| Condition | Shows |
|---|---|
| on a multiplayer server | "Auf Servern nicht möglich." |
| `game.hostable == false` | reason (`versionUnsupported{min}`, `msAccountRequired`, `manifestInvalid`) |
| `join.here` | "Bei {host} · {path} · {rtt} ms" + [Verlassen] |
| singleplayer, not published | [Für Freunde öffnen] -> `compat.Lan.publish(freePort)`, then wait for `game.lan.verified` |
| published, no session | "Port N · geprüft", toggles for invitable friends (max 7), "Weltname zeigen", [Einladen] |
| session here | guests (state, path, RTT, [Entfernen], "Erneut einladen"), [Weitere einladen], [Teilen beenden] -> `host.stop`; on 26.2 and newer additionally `compat.Lan.unpublish()`, otherwise see the rule below |
| session of another game | "Gerade teilt {instance}." |

**No unpublish before Minecraft 26.2 (A2).** `IntegratedServer.unpublishServer()` exists only from 26.2 (`INGAME-API.md` 4, 26.1.2 -> 26.2). `compat.Lan` therefore has `canUnpublish`: true on the 26.2+ nodes (`26.2-*`, `26.3-fabric`), false on all older ones. On older nodes "Teilen beenden" ends the session in the launcher (`host.stop`) and the LAN world **stays open to the LAN until the world is left**; the tab says so ("Die Welt bleibt im LAN offen, bis du sie verlässt") and returns to "published, no session". `compat.Lan.publish` also differs per era (`MultiplayerScope` parameter from 26.2, removed `GameType` parameter at 26.3).

### 6.5 Testable by construction
Every screen is split into (a) a **view-model and layout in `core`** (rectangles, row heights, scroll offsets, tab wrapping, text clipping through an injected width function) and (b) thin widget glue in `compat/ui`. Layout is unit-tested at the five resolutions with golden rectangle lists; `rebuild()` preserves `EditBox` text, focus and scroll position (vanilla re-runs `init()` on every resize) and has its own test. Only pixels are left to the smoke test and the owner pass.

### 6.6 Look and licensing
Pure vanilla widgets, no textures, no Mojang or Minecraft branding in the UI (consistent with the `PRIVACY.md` checklist). Friend faces are deferred.

---

## 7. Joining from inside the game

`invite.joinHere` is the only flow that changes what the running game does, so it keeps SPEC 6.2 intact:

**Launcher.**
1. The link's game has `online_account == true`, else `msAccountRequired` (the MOD2 review found this check missing).
2. Scope `social` granted; invite open; host reachable (dial within 8 s).
3. The running instance must **match** the host's manifest (`matching::plan` with the running instance first). Otherwise the answer is `invite.plan`'s verdict (`missingContent`, `versionUnsupported`) and the hub offers "Im Launcher öffnen" or, if a matching instance exists, "Passende Instanz starten".
4. Re-verify the owner (5.2) at this point; bind a single-owner loopback listener (`127.a.b.c:port`); create the join with `game_pid = link pid`; reply `{host, port}`. One join at a time; all SPEC 6.2 limits apply (first connection within 120 s, nonce check in the handshake, `connects_from(game_pid, ...)`).

**Mod.** Validate that `host` is in `127.0.0.0/8`; ask "Welt verlassen und beitreten?" through `ConfirmFlow`; leave the world; connect through `compat.Connect` to the literal address; after a disconnect, or when the `join` topic has not reached `connected` after 30 s, show the failure locally and report it with `join.failed{}` (op #22, 5.4; A15). The mod never resolves names and never connects anywhere else.

**Pre-grant.** With "Aktionen im Spiel: Erlauben" (`Expectations.pre_granted`, 5.5) scope `social` is already granted, so `invite.joinHere` skips the launcher prompt; the confirmation in the game (`ConfirmFlow`) and every other check of this section stay.

"Passende Instanz starten" asks the launcher to run the existing `usePlay` flow (`instance_launch` with `friendJoin`); the current game stays open (memory cost is shown in the confirm text).

---

## 8. Launcher changes

| Module | Change |
|---|---|
| new `services/friends/ingame/` (`index`, `select`, `materialise`, `args`, `breaker`) | node index, node selection, Java check, jar materialisation + hash check, argument merging, circuit breaker. Pure functions with tables of tests. |
| `commands.rs` (`prepare_launch`, `spawn_game`, `mod_bridge_env`) | call the injection step; widen the Fabric-only gate in `launch_env` to "node exists"; watch the first 90 s for the breaker. |
| `launch.rs` (`build_args`) | accept `injected_jvm_args` / `injected_game_args` between version JVM args and user args. |
| `modbridge/` | protocol 2; `hello` owner check via `sockowner::connects_from`; exclusive bind on Windows; launch-record keyed counters. |
| `friends/mod_link.rs` | split into `dispatch` (ops), `topics`, `consent`; scopes `share`/`social`; new ops of 5.4; `launcher.open`. |
| `friends/joining.rs`, `hosting.rs` | `joinHere` entry; `online_account` check on the join path. |
| **removed for good** (A12): `friends/modinstall.rs`, the command `friends_mod_install`, `MOD_PROJECT_ID`, the Modrinth lookup, `FriendsModRow`'s add button, the `ModState` values `notInstalled` and `installed` (Rust `contract.rs`, TypeScript `friends-types.ts`), the "our mod" special cases in `lookup.rs` / `manifest.rs` / matching, the Modrinth publish workflow | the mod is no longer content. **All of them are deleted** (W1 for the Rust side, F1 for the frontend; both merged): `MOD_PROJECT_ID` and `modinstall` no longer appear anywhere in `src-tauri`, and `FriendsModRow.tsx` is the status row of 3.9. |
| `friends/mod_link.rs` / `Expectations` | register the launch with `node_id`, `build_id` (the index `sha256`), `online_account` and `pre_granted` (A13) |
| frontend: instance status row, two settings, `ModConfirmDialog` (two scopes, 1 s guard), activity list, breaker dialog | |
| `contract.rs` / `friends-types.ts` / fixtures | status enum (3.9) replacing `ModState`, consent scopes, activity entry; golden fixtures shared with the Java tests. |
| CI | `mod.yml` matrix + smoke; release workflow consumes the mod artifact; delete `mod-release.yml` and the Modrinth environment. |

---

## 9. Documentation changes (package D0 done; D1 amended this document; D2, this change, closed the rest)

- `SPEC.md`: 7.1/7.4 (bridge: protocol 2, owner check, scopes), 11 (mod: embedded and injected, node table replaces "26.3 only"), 11.5 (modinstall removed), 5.5/5.6 (our mod no longer in manifests), 12.1/12.2 (see below), OD-1/OD-3, non-goals. D2 struck the "Current code" blocks that described removed code (modinstall, Modrinth distribution, protocol 1, the fabric-only hand install) and pointed the sections at this document.
- `PRIVACY.md` (the certificate-login sections on what the launcher sends to Mojang; the in-game mod and the `profilekeys` exposure) and the opt-in text (10.9): "Wenn Freunde an ist, lädt der Launcher beim Spielstart eine kleine Mod in deine Spiele. Sie liegt außerhalb deines Instanzordners, hat keine Netzwerkverbindung außer zum Launcher auf diesem PC und kann nichts ändern, was du nicht im Spiel anstößt. Andere Mods im selben Spiel können dieselbe Verbindung nutzen; deshalb fragt der Launcher vor Freundes- und Teilen-Aktionen aus dem Spiel."
- 12.1 stays true: before the opt-in, nothing listens and nothing is injected.
- New section for the keyring exposure of same-user code (from the MOD2 review).

---

## 10. Testing

| Layer | What | Where |
|---|---|---|
| 1. Java core | protocol, state store, sanitiser, backoff, view-model layout at 5 resolutions, rebuild state | JUnit 6 on JDK 17, no Minecraft |
| 2. Rust | node selection tables, argument merging, Java check, materialise/hash, breaker patterns on fixture logs, bridge: token + owner (fake socket table incl. unreadable PIDs), counters survive reconnect, op rate limits, consent paths, `joinHere` rules | `cargo test`, three OSes |
| 3. Interop | real `ModBridge` driven by the real Java core client; golden JSON fixtures are shared files read by both sides | CI job after layers 1-2 |
| 4. **Smoke (per node)** | a real Minecraft client, started through the launcher's own launch path with real injection; the mod connects, passes the owner check and sends `ready`; harness exits the game. Fails on any loader/Mixin error in the log | **Real and green for five cells on this Windows machine** (`INGAME-SMOKE.md`, A18/A21); the CI job `.github/workflows/mod-smoke.yml` (Linux, Xvfb + software GL, nightly and on `mod/**` and injection changes) has never been executed |
| 5. Owner pass | per release on Windows: for each loader one deep run (start, hub, accept a request, share and join with a second account), for each other node a 3-step run (start, hub opens, one request answered) | `OWNER-CHECKLIST.md` |

The smoke harness (`src-tauri/tests/smoke`, Cargo feature `smoke`, never default, never in the release workflow, A18) runs the launch pipeline without a Tauri window (the services are plain Rust) and overrides only the online-account gate for its offline test account. Still not proven: that Minecraft 26.x starts under software rendering **in CI** (the local runs used the owner's GPU; a Vulkan renderer would change this) and the smoke of the two pending fabric nodes (V1a).

---

## 11. Releases and work packages

Each release must be shippable alone. A cell is in a release only if its smoke test is green.

### 11.1 Releases
- **R-A (first public in-game release, launcher 0.2.0 or later per A23).** The five smoke-proven cells (`26.3-fabric`, `1.21.1-fabric`, `1.21.1-neoforge`, `26.2-neoforge`, `1.20.1-forge`) plus `1.21.8-fabric` and `1.21.11-fabric` once V1a smokes them; every other cell stays off. Features (A24): hub with Freunde, Anfragen, Einladungen, Teilen, Optionen (read-only), add friend by name, accept/decline requests, invites view/decline/joinHere, share/kick/stop, toasts, instance status row, settings, consent with two scopes, circuit breaker.
- **R-B.** More nodes (the rest of `INGAME-API.md` section 5), friend management (codes, rename, remove, block, blocked list, retry), title-screen button and key binding.
- **R-C.** Persistent activity log, undo, `addedInGame` review, polish.

If smoke shows that NeoForge/Forge injection does not work in production, R-A is Fabric-only and the other loaders wait for the managed-copy decision (3.5). The concept stays valid; the matrix shrinks. (The smoke has since proven all three loaders, `INGAME-SMOKE.md`; the sentence stays as the rule for future nodes.)

### 11.2 Packages and order

The split below replaces the first plan of 2026-10-03: L2 became L2a + L2b, M1 became M1a + M1b, O1 is part of L2b, and W1 (the wiring of the injection core) and D1/D2 (documents) are new. "State" is the state on `feat/ingame-mod` at 2026-10-04.

| Wave | Package | Content | Needs | State |
|---|---|---|---|---|
| 0 | **S0** API spike | compile-against-both-ends tool, per-era API table, real node list (`INGAME-API.md`) | - | merged |
| 0 | **S1** topology spike | Stonecutter project `mod/`, three tracer nodes, `nodes.txt`, index writer and validator, CI node matrix, node-id naming | - | merged (the real injection flags and the non-ASCII path are proven by S2, not by the dev-environment tracer run) |
| 0 | **D0** docs | section 9 | - | merged |
| 0 | **L1** injection core | index, selection, Java check, materialise, argument merge, breaker (Rust, building blocks only) | S1 | merged |
| 0 | **L2a** bridge 2 | protocol 2, owner check, exclusive bind, launch records, scopes, op and topic types, golden fixtures | - | merged |
| 0 | **M1a** mod core | Java core: bridge client, protocol, state store, sanitiser | S0 | merged |
| 1 | **D1** concept amendments | this document (A1 to A13) | wave 0 | merged |
| 1 | **M1b** mod core, second half | view-models and layout (6.5), the self-hash for `hello.mod.build` (5.3), `ready`, remaining topics | M1a | merged |
| 1 | **L2b** bridge ops | dispatch of every op of 5.4, topic pushes, consent dialog backend (two scopes, caps), `launcher.open`, activity list, `Expectations.pre_granted` | L2a | merged |
| 1 | **W1** wiring | call the injection step from `prepare_launch` / `spawn_game` / `launch_env`, register the launch with `node_id`, `build_id`, `pre_granted`, live breaker scan (`analyze_log`) and post-mortem (`analyze_exit`), remove the A12 items on the Rust side | L1, L2a | merged |
| 1 | **S2** smoke harness | launch through the launcher pipeline, `ready` handshake, CI job; proves the injection flags per node | S1, W1 | merged (five cells green, `INGAME-SMOKE.md`; the CI job itself never ran) |
| 2 | **F1** frontend | instance status row (3.9), settings, consent and breaker dialogs, contract types, removal of `FriendsModRow`'s add button and the `ModState` values `notInstalled` / `installed` | W1, L2b | merged (A20) |
| 2 | **D2** docs, second pass | SPEC, PRIVACY, VERIFICATION, owner checklist, README re-aligned with the amended concept and the state after wave 1; A14 to A24 folded into this document | D1, wave 1 | this change |
| 2 | **U1** compat + kit | compat for **four eras**, compiled and checked against 1.21.1, 1.21.8, 1.21.11 and 26.3 (A11); widget kit, throwaway screen proving button, `EditBox`, scroll pane, narration, resize; toasts (A10), `canUnpublish` (A2) | M1a, S0 | merged (kit demo render proof on the four Fabric nodes; `Checkbox.Builder#maxWidth` is deliberately not used, the kit sizes its toggles itself) |
| 3 | **U2** screens (R-A set) | the R-A feature set of A24: hub with Freunde, Anfragen, Einladungen, Teilen, Optionen (read-only); add friend **by name**; accept/decline requests; invites view/decline/joinHere; share/kick/stop; toasts. No codes, no rename/remove/block, no […] row menu, no keybinding, no title-screen button (all R-B) | U1, M1b, L2b | open |
| 3 | **J1** join here | launcher + mod | U2, L2b | open (the launcher side of `invite.joinHere` and `join.failed` exists since L2b; J1 builds the mod flow of 7) |
| 3 | **V\*** nodes | one package per node group of `INGAME-API.md` section 5, including the Loom-remapped jars of the obfuscated Fabric nodes (A4); V1a smokes `1.21.8-fabric` and `1.21.11-fabric`, the only unverified nodes | U1 | open |
| 4 | **G1** release gate | CI matrix green, owner Windows pass, size budget, release workflow. **A23: the next launcher release is 0.2.0** (the 2.x numbers and tags were deleted on 2026-10-04); G1 must align `modVersion` with the launcher version, nothing else about versioning changes | all of R-A | open |

Ownership rule: `contract.rs`, `friends-types.ts` and the shared fixtures may be amended by the package that needs the change, with the Rust, TypeScript and fixture edits in the same change; a package adds its types in a separate block and does not reorder existing code. `compat/` additions needed by a screen package are made by that package for every existing node.

---

## 12. Risks

1. **Production injection on NeoForge 21.9+/26 uses a development feature** (`fml.modFolders`) and may change or vanish. Mitigation: smoke test per release; cell off if red. The flag works on FML 11 in a production launch (26.2-neoforge smoke run, `INGAME-SMOKE.md` row 4); FML 10 and 12 series stay unsmoked with their nodes (`INGAME-API.md` 8).
2. **Headless CI for 26.x** may not start (renderer). The local smoke runs used the owner's GPU; the CI workflow has never been executed and says so in its header (`INGAME-SMOKE.md` section 5). Fallback is an owner-run smoke script, which is what the five green cells are.
3. **Non-ASCII user folders on Windows** can break JVM option paths. The required case (ü + space, `D:\pumpkin-build\smoke\Jürgen Müller\`) passed on all five cells without a list file; a CJK path stayed silent for 240 s and is not investigated (`INGAME-SMOKE.md` section 5).
4. **A crash that happens after the 90-second window** is not caught by the circuit breaker. Accepted; the per-instance switch is the manual exit.
5. **Same-JVM code can use the bridge** (5.1). Mitigation: narrow API, prompts, visibility; honest privacy text.
6. **Every mod fix is a launcher release.** Accepted for what it buys (no distribution channel, one signed artifact); the updater makes it quick, the breaker makes a bad node survivable.
7. **26.x cadence.** Every quarterly release so far changed a signature we use; each needs a node and a smoke run. The explicit-id rule means new releases stay un-injected until then.
8. **Mojang's own friends list on 26.2+** overlaps in purpose. We ship, never bind `O`, and skip the title button when it would collide.
9. **Forge/NeoForge client-only declaration** was read from loader sources in S0 (4.2: `clientSideOnly = true`, `@Mod(dist = Dist.CLIENT)`), not tried against a modded server; S2 and the owner pass must show that a client with the mod joins a modded server.
10. **Effort.** Node count (19) and per-node proof dominate. S0/S1 turned the guesses into numbers; the Fabric nodes below 26.x additionally need the remapped jar (A4).

---

## 13. What changed against MOD2

**Dropped (foreign-launcher only):** discovery file, `attach` with mutual HMAC, game report, Mojang account proof, pairing prompts and sticky denials, `ProcessKey`/`procinfo` for foreign processes, `ExternalGame`, v1 compatibility, golden HMAC vectors, "Spiele aus anderen Launchern erlauben".
**Dropped (embedding):** Modrinth project, `mod-release.yml`, `MOD_PROJECT_ID`, install command and button, Fabric API install, "our mod" matching exception, manifest special cases.
**Kept and reduced:** per-node matrix and build architecture (3.x of MOD2), topics/ops/events design, UI tree, Teilen state machine, join flows, scopes (3 -> 2).
**Review findings carried over:** honest threat model, exclusive bind on Windows, PID check on the token path, `online_account` on `joinHere`, counters keyed on the launch, fail-closed owner lookup, clickjack guard, `friend.rename` in the social scope, `identityChanged` launcher-only, three-release cut, compile-both-ends instead of fingerprint, four eras (1.21.1, 1.21.8, 1.21.11, 26.3) before the UI contract is frozen, tracer topology spike, matrix CI instead of one job, view-model layout tests, `rebuild()` state preservation, shared golden fixtures, early interop gate, reduced first-release parity, title button and shortcuts deferred, one JDK source of truth.
**Moot:** discovery squatting, cross-game redirection, foreign account proof, pairing starvation, custom-session launchers, handshake manifest sizes, Flatpak/WSL/Snap, UNC discovery paths.

---

## 14. Decisions taken and what they cost

| # | Decision | Alternative | Cost of the alternative |
|---|---|---|---|
| 1 | Inject only while Friends is on, only for online launches | always inject, inert until opt-in | every game would carry code it does not use; weakens the "nothing before opt-in" story |
| 2 | Jar outside the instance | managed copy in `mods/` | exclusions in export, duplicate, adopt, content scan, manifest; visible file; crash cleanup |
| 3 | No Fabric API requirement, one soft Mixin | nested Fabric API modules | version-clash risk with the user's own Fabric API |
| 4 | Embedded jars | Modrinth distribution | project, token, 2FA environment, download and trust chain, install flow, version handshake |
| 5 | Unverified cells stay off | optimistic ranges | games that do not start |
| 6 | Vanilla/Quilt/offline out | hidden Fabric for vanilla; Quilt via `loader.addMods` | changes the instance; unproven Fabric API on Quilt 26.x |
| 7 | Identity/privacy ops launcher-only | confirm-each-time in-game | UI and review surface for rarely used actions |
| 8 | `Immer fragen` default for in-game actions | pre-granted | none for safety, but one alt-tab per launch on the first action; a pre-grant switch exists for people who accept that (`Expectations.pre_granted`, 5.5) |
| 9 | Explicit release ids | open ranges | new Minecraft releases break silently |
| 10 | The 19-node list of `INGAME-API.md` 5, ids carry the highest release | the provisional ranges of the first concept | ranges that were never compiled; a node that straddles an API break does not build |
| 11 | The mod hashes its own jar for `hello.mod.build` (prefix, or `dev`) | a build-time constant | impossible: a jar cannot embed its own hash |
| 12 | The breaker lets the log decide; exit code and 90 s window only gate it | non-zero exit alone trips it | a crash the mod did not cause (memory, foreign mod) would switch the feature off |

Owner tasks that remain: the Windows owner pass per release, a second Microsoft account for share/join runs, and the answers to any decision above you want to flip. No Modrinth project, token or publish approval is needed any more.

---

## Appendix A: injection mechanisms (research, 2026-10-03)

"Source" = read in loader source or artifacts; "unproven" = must be shown by experiment (S1/S2). This appendix is the research record of 2026-10-03; the smoke runs of 2026-10-04 have since proven the `fabricAddMods`, `fmlMavenRoot` and `fmlModFolders` rows in real clients (Appendix B, `INGAME-SMOKE.md`).

| Loader | Mechanism | Detail | Status |
|---|---|---|---|
| Fabric >= 0.12 | `-Dfabric.addMods=<list>` (also `--fabric.addMods`) | entries split on `File.pathSeparator`; accepts a jar, a directory (walked for `.jar`), an unpacked mod directory, or `@listfile` (one path per line); files must end in `.jar`, hidden/dot files are skipped; a missing path logs a warning. **The jar is not remapped at runtime** (`requiresRemap = isDevelopmentEnvironment()`), so on 1.20 to 1.21.11 it must already be in intermediary names (A4) | source; NoRiskClient ships `-Dfabric.addMods=@<file>` today |
| Fabric | classpath jar | only scanned in development | does **not** work in production |
| Quilt >= 0.15 | `-Dloader.addMods=<list>` | directory entries need a trailing `/*`; a missing path is a GUI error | source; out of scope |
| NeoForge FML 1-9 (20.2-21.8), Forge 1.17.1-1.20.2 | `--fml.mavenRoots <absDir> --fml.mods g:a:v` (or `--fml.modLists`) | jar at `<root>/dev/laux/pumpkin/pumpkin_friends/<v>/pumpkin_friends-<v>.jar`; a missing coordinate is a loading error | locator in source; flag names inferred |
| NeoForge FML 10+ (21.9+, 26.x) | `-Dfml.modFolders=<label>%%<jar>` | `InDevFolderLocator`, always registered; jar needs `META-INF/neoforge.mods.toml` | source; development feature, unproven in production |
| NeoForge FML 10+ | classpath jar with `META-INF/neoforge.mods.toml` | `InDevJarLocator` | unproven (class-loading identity) |
| Forge 1.20.3-26.x (49.x-66.x) | none found; the classpath locator may discover a `mods.toml` jar | | unproven; out of scope |
| Forge 1.12.2 | `--mods <relative path>` | Windows absolute-path behaviour unclear | out of scope |
| any | managed copy in `mods/` | universal and supported | rejected for v1 (3.5) |
| any | Java agent | | rejected |

Duplicate mod ids: Fabric keeps one candidate silently (root before nested, then higher version); NeoForge/Forge 47+ keep the newest and log it; Forge 1.12 crashes. Hence the id-collision rule in 3.3.

Sources: Fabric Loader (`ArgumentModCandidateFinder`, `SystemProperties`, 0.12 announcement), Quilt Loader (`ArgumentModCandidateFinder`), FancyModLoader (`InDevFolderLocator`, `InDevJarLocator`), fmlloader 47.4.0 sources, the `docs/research-noriskclient.md` notes, the 26.1.2.114/26.2.0.88 NeoForge installers.

## Appendix B: things only an experiment can settle (spike checklist)

**Items 1 to 6 are settled by the smoke runs of S2** (real runs, evidence and log excerpts in `INGAME-SMOKE.md`, 2026-10-04); item 7 is settled only for the owner's GPU, not for headless CI, and items 9 and 10 remain source-read, not observed.

1. `-Dfabric.addMods` on Fabric 26.3 and on an obfuscated version (the lowest obfuscated node): the Loom-remapped jar (intermediary names, refmap) loads, the Mixin applies, no `.fabric/processedMods` surprises. **Passed** on `26.3-fabric` and `1.21.1-fabric` (today the lowest obfuscated node; a `1.20.1-fabric` node does not exist yet).
2. Fabric duplicate id (user copy lower, equal, higher). **Settled for the equal case** by the `duplicate-id` scenario (the gate refuses beside a copy in `mods/`); lower/higher copies remain untried.
3. NeoForge 21.1.x via `--fml.mavenRoots`; 20.4 and 21.8 optional. **Passed** on `1.21.1-neoforge` (21.1.253).
4. NeoForge 26.1.2.114 and 26.2.0.88 via `-Dfml.modFolders`; class-loading guard quiet. **Passed** on `26.2-neoforge` (26.2.0.88); 26.1.2.114 has no node yet.
5. Forge 1.20.1 (47.4.x) via `--fml.mavenRoots`; client-only declaration `clientSideOnly = true`. **Passed** on `1.20.1-forge` (47.4.26).
6. Windows: non-ASCII data path; `FILE_SHARE_READ` handle held while loaders read the jar. **Passed** for all five cells (path `D:\pumpkin-build\smoke\Jürgen Müller\`, hold and release).
7. Headless start of 26.x clients under software rendering. **Open**: the CI workflow never ran; the local smoke used the owner's GPU.
8. ~~Stonecutter node naming with `-neoforge`/`-forge` suffixes and predicates.~~ Settled by S1: node id and Minecraft version are separate fields (`mod/README.md`).
9. Screen-init hook per loader (Fabric Mixin target `PauseScreen#init`, NeoForge/Forge `ScreenEvent.Init.Post`) on the tracer versions. Read from sources for all versions in `INGAME-API.md` 6; the smoke proves the Fabric Mixin on `1.21.1-fabric` (tracer + mixin line) and the mod load on the other cells; the button in a real pause menu is first seen by the owner pass.
10. Behaviour of a client-only NeoForge/Forge mod against modded servers (not relevant for the loopback tunnel, relevant if players also use their instances on servers). **Open**; the smoke used no server.
