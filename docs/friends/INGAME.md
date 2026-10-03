# Pumpkin Friends in-game: an auto-injected, launcher-only mod

Status: concept (2026-10-03). Replaces the draft `MOD2.md` and its review `MOD2-REVIEW.md` (both stay in the repo as research; section 13 lists what was carried over and what fell away). Base documents: `SPEC.md` (friends feature, bridge v1), `BYNAME.md` and `BYNAME-ATTEST.md` (add by name; since 2.0.1 the directory login uses Mojang's player certificate), `PRIVACY.md`. Written against `main` at 2.0.1.

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
3. the node's `verified` entry exists in the index (smoke test passed in CI for that node on the commit that built it).

The `minecraft` list is **explicit release ids, not an open range**. A Minecraft release that is newer than the index gets no node and therefore no injection until a launcher release adds it. This is deliberate: a wrong guess means a game that does not start (3.8 limits the damage, it does not remove it). Snapshots, pre-releases and release candidates never match.

### 2.2 Planned nodes (provisional; spike S0 fixes the real break points)

Priority follows what players run today and what is cheap to prove. "Tracer" nodes are built first to prove the topology (S1).

| Minecraft | Java | Fabric | NeoForge | Forge | Stage |
|---|---|---|---|---|---|
| 26.3 | 25 | node | node (stable build only; the beta is CI-only) | later | R-A (Fabric tracer), NeoForge when stable |
| 26.2, 26.1.x | 25 | node each | node each | later | R-A/R-B |
| 1.21.9-1.21.11 (probably split at 1.21.11) | 21 | 1-2 nodes | 1-2 nodes | later | R-B |
| 1.21.2-1.21.8 (probably 2-3 nodes: render rewrite at 1.21.6) | 21 | 2-3 nodes | 2-3 nodes | later | R-B |
| 1.21-1.21.1 | 21 | node | **tracer** | later | R-A |
| 1.20.5-1.20.6 | 21 | node | later | later | R-B |
| 1.20.2-1.20.4 | 17 | node | later | later | R-B |
| 1.20-1.20.1 | 17 | node | (Forge jar only) | **tracer** | R-A |

Expect about 12 Fabric, up to 8 NeoForge and 1 Forge jar at full coverage. Why this is a budget and not a promise: every node is a compile target, a CI smoke run and an owner-checked cell. The MOD2 review already warned that its 14-jar plan was an optimistic floor; this plan keeps the ranges as hypotheses until S0 has compiled against both ends of each range.

### 2.3 "Later" and "never"
- **Later, on demand**: Forge above 1.20.1 (third toolchain, EventBus changes), NeoForge 20.2-20.6 (needs NeoGradle), Minecraft 1.18.2-1.19.4 (needs the launcher's sharing floor lowered, a security decision, see MOD2-REVIEW), Quilt (Quilted Fabric API has no 26.x release; a Quilt cell needs its own smoke proof), Vanilla instances (opt-in "add Fabric", section 3.9).
- **Never**: Minecraft 1.15 and older, Java agents with bytecode patching.

---

## 3. Injection: how the mod gets into the game

### 3.1 Principle
The jar is **launcher data, not instance content**. It is materialised at `<data>/runtime/friends-mod/<modVersion>/<node>.jar` and handed to the loader by start-up options. Consequences (all wanted):
- Instance export (`.mrpack`), duplicate, templates, pack update, `adopt_untracked` and the content scan never see it: they walk the instance folder.
- The host's content manifest and the guest's matching never see it. The SPEC 5.5/5.6 special case "ignore our mod if its sha512 resolves to `MOD_PROJECT_ID`" disappears (the code in `friends/lookup.rs` and `manifest.rs` becomes dead and is removed).
- A user cannot delete it by editing mods, a modpack update cannot overwrite it.
- Nothing needs cleaning up when the launcher is removed except its data folder.

### 3.2 Embedding
- The Gradle build writes `mod-index.json` next to the jars: per node `id`, `loader`, `loaderMin`, `minecraft[]`, `javaMin`, `strategy`, `file`, `sha256`, `modVersion`, `verified`.
- `src-tauri/build.rs` (or a generated `mod_jars.rs`) embeds the index and the jars with `include_bytes!`. Bytes inside the signed launcher binary are harder to tamper with than resource files next to it.
- Budget: each jar at most 300 KB, all jars together at most 8 MB; CI fails above that. The jars are compressed already; no extra compression.
- Dev builds without jars (`tauri dev`) get an empty index: injection reports "not available in this build". `pnpm mod:build` produces the jars for local work.
- Release CI order: `mod` matrix (build + smoke) -> artifact -> per-OS launcher build consumes the artifact. The mod version equals the launcher version.

### 3.3 When the launcher injects
All of these must hold, checked in `prepare_launch` right before the argument list is built:
1. Friends is enabled and the bridge is running (as today: the bridge only exists after the opt-in).
2. The launch uses a Microsoft account (`online_account`), as today for the bridge env.
3. The instance's loader is Fabric (R-A), later NeoForge/Forge once their cells are verified.
4. A node fits (2.1) and the Java check passes.
5. The user did not switch the mod off globally or for this instance, and the circuit breaker (3.8) is not tripped for it.
6. No other copy of `pumpkin_friends` is in the instance (a dev jar, a copy someone built). Detection reuses the mod metadata reader that the content analysis already has (`content/jar_meta.rs`). Two mods with one id are resolved differently by every loader (Fabric picks one silently, Forge 1.12 crashes), so the launcher skips and says so.

If any check fails, the launch is **byte-identical to today**: no argument, no env.

### 3.4 Java check
A Fabric mod with `depends: java >= N` that meets an older Java produces the loader's error screen, i.e. a game that does not start. The launcher therefore compares the Java it resolved (Mojang runtime component or the user's custom `java_path`) with `node.javaMin` before injecting. For custom Java paths it reads the major from the runtime's `release` file or by running `java -version` once and caching the answer per path.

### 3.5 Strategy per loader (evidence in Appendix A)

| Loader / era | Strategy id | What the launcher adds | Evidence |
|---|---|---|---|
| Fabric (loader >= 0.12) | `fabricAddMods` | `-Dfabric.addMods=<jar>` (or `@listfile`) | Fabric Loader source (`ArgumentModCandidateFinder`); NoRiskClient ships exactly this in production (`docs/research-noriskclient.md:92-96`). Not yet exercised by us on 26.3. |
| NeoForge 21.x up to FML 9 and Forge 1.17.1-1.20.2 | `fmlMavenRoot` | `--fml.mavenRoots <dir> --fml.mods dev.laux.pumpkin:pumpkin_friends:<ver>`, with the jar laid out as a Maven repository under `<dir>` | FML `MavenDirectoryLocator` read in source for Forge 1.20.1-47.4.0 and NeoForge FML 4.0.44; the flag names are inferred from the service option names. |
| NeoForge 21.9+ and 26.x (FML 10+) | `fmlModFolders` | `-Dfml.modFolders=pumpkin%%<jar>` | FML `InDevFolderLocator` source: always registered, no production guard. It is a development feature and may change. |
| Quilt, Vanilla | none | nothing | out of scope in v1 |

Rules for the table:
- It is **data in the index**, not code branches. A cell whose strategy fails the smoke test has `verified` empty and is off.
- Fallback "managed copy in `mods/`" exists only on paper (Appendix A). It would need exclusions in export, duplicate, adopt, content scan and manifest plus crash cleanup, and it makes the mod visible. A cell that only works that way stays unsupported until someone decides the exclusion work is worth it.
- The mod is **never** injected through a Java agent or the classpath: a classpath jar is not a loader-sanctioned mod source on production Fabric, and a bytecode-patching agent is a per-version maintenance sink.

### 3.6 Merging with the user's start-up options
The launcher builds arguments in `launch::build_args`; injected options go **after** the version JSON's JVM args and **before** the user's `extra_jvm_args`, so a user can still override. For `fabricAddMods` and `fmlModFolders` the property may already be set by the user or a pack (`-Dfabric.addMods=...` is common in dev setups). A second `-D` of the same name makes the last one win, which would drop either ours or theirs, so the launcher **parses the existing value and merges**: path-list values are joined with the platform separator; an `@listfile` value is rewritten into a combined list file in the launcher data folder. Rust tests cover: no existing property, plain value, list file, duplicate occurrences, quoted values.

### 3.7 Integrity
- Compile-time SHA-256 per jar. Before every launch the launcher checks the materialised file; if missing or different it rewrites it atomically (temp file + rename) and marks it read-only.
- On Windows the launcher keeps the file open with `FILE_SHARE_READ` until the game has spawned, so the check-to-load window is closed. (Effect on loader reads: to be proven in S1.)
- The index entry's `sha256` is also part of the launch record; the mod reports its own build id in `hello` (5.3) and the launcher refuses a mismatch. This catches "another copy of the mod answered".
- This protects against corruption and accidental overwrites. It does not protect against an attacker who can already change the launcher binary or run code as the same user (5.1).

### 3.8 Circuit breaker
The only way this feature can hurt a player is a game that does not start. So:
- The launcher watches the first 90 seconds of a launch. If the process exits with a non-zero code in that window, or the log shows a loader/Mixin failure that names `pumpkin_friends` (Fabric "Incompatible mod set", "Mixin apply failed", FML "mod loading error" lines naming the mod id, `UnsupportedClassVersionError` for the jar), the instance's injection state becomes `autoOff{reason, launcherVersion}`.
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
- **No Fabric API requirement.** The only hook needed is "a screen was initialised, add a button to the pause screen". On Fabric that is one `@Inject(method="init", at=@At("TAIL"), require=0)` into `PauseScreen`, so a changed signature degrades to "no button" and a log line instead of a crash. On NeoForge/Forge it is the screen-init event. Nested Fabric API modules were considered and rejected: a nested module that is newer than the user's own copy can replace it and trip other mods' dependency checks.
- **Work comes to the main thread through `Minecraft.execute`**, not a tick hook: the bridge thread posts runnables; a 1-second poster covers the LAN watcher. This avoids a second hook family.
- **No key binding in R-A.** Registration has to happen before options load and differs per loader. R-B adds an unbound binding.
- **Soft failure everywhere.** Every entry point runs inside a guard that logs and disables the mod's UI for the session on any exception. The mod must never throw into the game.
- **Client-only declaration.** Fabric `environment: client`; NeoForge/Forge client-only entry with the display-test setting that stops the server list from flagging a mismatch (Forge 1.20.1 `displayTest=IGNORE_SERVER_VERSION`; to be proven in S1).
- **No network code.** The only socket is `127.0.0.1:<port>` from the environment, and the connect target is never taken from anywhere else.

### 4.3 Build tooling
- Stonecutter (release 0.9.8; 0.10 is alpha) with one project per node, Fabric Loom 1.18.2 (no remap on 26.x, remap plugin below via `loom-back-compat`), NeoForge ModDevGradle 2.0.x, ModDevGradle `legacyforge` for Forge 1.20.1. Mojang mappings everywhere (Yarn is gone from 26.1).
- **Open risk, settled in S1 before anything else:** node ids such as `1.21.1-neoforge` must not be parsed as semver prereleases by Stonecutter predicates; node id and Minecraft version are separate fields, or the layout is one branch per loader.
- JDKs: one source-of-truth file read by both `dev-env` scripts and the workflows. `--release` per node, not one toolchain per node.
- **Compile-matrix instead of fingerprinting** (MOD2-REVIEW blocker): each node range is compiled against both ends and one middle version; a descriptor-exact override check covers `Screen` methods the UI overrides. The `javap` fingerprint is only a supplement.

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
The mod and launcher always ship as one build, nothing from protocol 1 was ever published, so protocol 2 replaces it with no compatibility layer. JSON lines, UTF-8.

**Framing and limits.** Until `welcome`: lines up to 1 KiB, `hello` within 2 s, at most 4 unauthenticated connections. After: mod to launcher up to 16 KiB, launcher to mod up to 64 KiB. The mod may send 20 messages per second and keep 8 requests in flight. Outgoing queue 64 per link; a stalled writer (5 s) closes the link. Ping every 10 s, 30 s of silence closes.

**Handshake.**
```
mod -> launcher  {"type":"hello","protocol":2,"token":"<64 hex>","mod":{"version":"2.1.0","build":"<sha256 prefix>"},
                  "game":{"minecraft":"1.21.1","loader":"neoforge","loaderVersion":"21.1.172","java":21}}
launcher -> mod  {"type":"welcome","protocol":2,"launcher":"2.1.0","scopes":{"share":"ask","social":"ask"}}
              or {"type":"reject","reason":"token|protocol|owner|build|duplicate|retry"}
```
The `game` block is diagnostics; the launcher knows the truth and logs a mismatch.

**Requests and responses.**
```
{"type":"req","id":"a1","op":"friend.addByName","args":{"name":"Notch"}}
{"type":"res","id":"a1","ok":true,"result":{}}
{"type":"res","id":"a1","ok":false,"error":{"code":"nameUnknown","params":{}}}
{"type":"pending","id":"a1","prompt":"scope","scope":"social"}   // launcher dialog is open; final res follows within 125 s
```
Ids match `^[a-z0-9]{1,12}$`. Mod-side timeouts: 15 s, 30 s for slow operations, 130 s after `pending`.

**State topics (launcher to mod).** Whole-value pushes with a per-topic revision, coalesced to one per topic per 250 ms. The mod replaces its copy; it never patches.
`me`, `friends`, `requests`, `invites`, `session`, `join`, `game` (R-A); `codes`, `blocked` (R-B). Friends are addressed by **per-link aliases** (`f1`, `f2`, ...), never by peer id. Each topic has a hard element cap and a Rust test that its worst case fits in 60 KiB.

**Events (launcher to mod).** `notify{kind, name?}` for toasts (`requestReceived`, `inviteReceived`, `friendOnline`, `guestJoined`, `guestLeft`, `sessionEnded`, `joinEnded`, `scopeDenied`), `closing{reason}`. Queue of 32, drop-oldest; responses never drop.

**Mod to launcher besides requests.** `lanOpened{port}`, `lanClosed` (hints only; the launcher re-verifies the port against the game pid, SPEC 6.1), `ready{screens}` (diagnostic, used by the smoke test and the instance row), `ping`.

### 5.4 Operations

Scope column: `-` needs none, `S` share, `C` social. Stage column: release that ships it.

| Op | Does | Scope | Stage |
|---|---|---|---|
| `state.sync` | resend all topics | - | A |
| `launcher.open{target}` | bring the launcher window to the friends page (friends, requests, invites, settings); 1 per 10 s; never while a dialog is open | - | A |
| `request.answer{id,accept}` | accept or decline an incoming request | C | A |
| `request.cancel{id}` | withdraw an outgoing request | - | A |
| `friend.addByName{name}` | send a request by Minecraft name (BYNAME); launcher-side rate limited. While a game runs the launcher uses only its cached player certificate and never fetches a new one on the mod's behalf (answer `directoryUnavailable` instead) until owner test O-5 shows that a certificate fetch does not disturb a running game's chat key | C | A |
| `invite.decline{id}` | decline an invite | - | A |
| `invite.plan{id}` | match verdict for the running instance and alternatives (SPEC 5.6) | - | A |
| `invite.joinHere{id}` | join the invite from the running game (section 7) | C | A |
| `join.leave` | leave the joined session | - | A |
| `host.invite{friends[],showWorld}` | start sharing the published LAN world and invite | S | A |
| `host.kick{friend}`, `host.stop` | remove a guest, end sharing | - | A |
| `friend.addByCode{code}`, `code.create`, `code.revoke{id}` | codes | C | B |
| `friend.rename`, `friend.remove`, `friend.block`, `blocked.unblock` | graph changes | C | B |
| `friend.acknowledge{id}` | clear a "renamed" notice only (never `identityChanged`, never `addedInGame`) | C | B |
| `friends.retry` | redeliver pending requests now | - | B |

Never in-game, no op exists: enable, disable, rotate identity, reset, settings changes (display name, findable, relay), relay consent, copying the full peer id, reviewing `identityChanged`/`addedInGame` notices. The Options tab shows them read-only with "Im Launcher öffnen".

### 5.5 Consent
Two scopes, asked **once per game launch** in the launcher:
- `share` (host.invite): "Dieses Spiel möchte deine Welt mit ausgewählten Freunden teilen."
- `social` (graph changes, answering requests, joining): "Dieses Spiel möchte Freunde hinzufügen, Anfragen beantworten und Einladungen annehmen."

Prompt buttons: "Ablehnen" (initial focus) and "Erlauben (bis Spielende)". The setting "Aktionen im Spiel" can pre-grant (`Erlauben`) per instance, so players who trust their mod set never see the prompt. In-game, a pending request shows a `LauncherWaitScreen` ("Bestätige im Pumpkin Launcher", Abbrechen only stops waiting).

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

Esc goes to the parent screen. Tab order follows visual order; Enter in an `EditBox` submits. Every row is a focusable widget with a full narration line. All text goes through `pumpkin_friends.*` language keys (`en_us`, `de_de`); player-controlled strings are sanitised and only ever rendered as literals. Errors are shown inline with a "⚠" prefix plus a toast for asynchronous results.

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
| session here | guests (state, path, RTT, [Entfernen], "Erneut einladen"), [Weitere einladen], [Teilen beenden] -> `host.stop`, then `compat.Lan.unpublish()` |
| session of another game | "Gerade teilt {instance}." |

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

**Mod.** Validate that `host` is in `127.0.0.0/8`; ask "Welt verlassen und beitreten?" through `ConfirmFlow`; leave the world; connect through `compat.Connect` to the literal address; report `join.failed` after a disconnect or after 30 s. The mod never resolves names and never connects anywhere else.

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
| remove `friends/modinstall.rs`, `friends_mod_install`, `MOD_PROJECT_ID`, the Modrinth lookup, `FriendsModRow`'s add button, `lookup.rs`/`manifest.rs` "our mod" special cases | the mod is no longer content. |
| frontend: instance status row, two settings, `ModConfirmDialog` (two scopes, 1 s guard), activity list, breaker dialog | |
| `contract.rs` / `friends-types.ts` / fixtures | status enum (3.9), consent scopes, activity entry; golden fixtures shared with the Java tests. |
| CI | `mod.yml` matrix + smoke; release workflow consumes the mod artifact; delete `mod-release.yml` and the Modrinth environment. |

---

## 9. Documentation changes (package D0, before code)

- `SPEC.md`: 7.1/7.4 (bridge: protocol 2, owner check, scopes), 11 (mod: embedded and injected, node table replaces "26.3 only"), 11.5 (modinstall removed), 5.5/5.6 (our mod no longer in manifests), 12.1/12.2 (see below), OD-1/OD-3, non-goals.
- `PRIVACY.md` (extend the 2.0.1 sections on the certificate login and what the launcher sends to Mojang; add the in-game mod and the `profilekeys` exposure) and the opt-in text (10.9): "Wenn Freunde an ist, lädt der Launcher beim Spielstart eine kleine Mod in deine Spiele. Sie liegt außerhalb deines Instanzordners, hat keine Netzwerkverbindung außer zum Launcher auf diesem PC und kann nichts ändern, was du nicht im Spiel anstößt. Andere Mods im selben Spiel können dieselbe Verbindung nutzen; deshalb fragt der Launcher vor Freundes- und Teilen-Aktionen aus dem Spiel."
- 12.1 stays true: before the opt-in, nothing listens and nothing is injected.
- New section for the keyring exposure of same-user code (from the MOD2 review).

---

## 10. Testing

| Layer | What | Where |
|---|---|---|
| 1. Java core | protocol, state store, sanitiser, backoff, view-model layout at 5 resolutions, rebuild state | JUnit 6 on JDK 17, no Minecraft |
| 2. Rust | node selection tables, argument merging, Java check, materialise/hash, breaker patterns on fixture logs, bridge: token + owner (fake socket table incl. unreadable PIDs), counters survive reconnect, op rate limits, consent paths, `joinHere` rules | `cargo test`, three OSes |
| 3. Interop | real `ModBridge` driven by the real Java core client; golden JSON fixtures are shared files read by both sides | CI job after layers 1-2 |
| 4. **Smoke (per node)** | a real Minecraft client, headless (Linux, Xvfb + software GL), started through the launcher's own launch path with real injection; the mod connects, passes the owner check and sends `ready`; harness exits the game. Fails on any loader/Mixin error in the log | CI matrix, nightly and on `mod/**` and injection changes |
| 5. Owner pass | per release on Windows: for each loader one deep run (start, hub, accept a request, share and join with a second account), for each other node a 3-step run (start, hub opens, one request answered) | `OWNER-CHECKLIST.md` |

The smoke harness needs the launch pipeline to run without a Tauri window (services are plain Rust, to be confirmed in S2) and a compile-time `smoke` feature that lets the harness override the online-account gate; that feature is never in release builds. Two things are not proven yet: that Minecraft 26.x starts under software rendering in CI (a Vulkan renderer would change this), and that NeoForge 21.9+/26 honours `fml.modFolders` in a production launch. Both are S1 outcomes, not assumptions.

---

## 11. Releases and work packages

Each release must be shippable alone. A cell is in a release only if its smoke test is green.

### 11.1 Releases
- **R-A (first public in-game release).** Fabric on every node that passes smoke, plus the NeoForge 1.21.1 and Forge 1.20.1 tracers if S1 proves their injection. Features: hub with Freunde, Anfragen, Einladungen, Teilen, add by name, toasts, `joinHere`, instance status row, settings, consent with two scopes, circuit breaker.
- **R-B.** More nodes (1.21.2-1.21.11, 26.x NeoForge, 1.20.x Fabric), friend management (codes, rename, remove, block, blocked list, retry), title-screen button and key binding.
- **R-C.** Persistent activity log, undo, `addedInGame` review, polish.

If S1 shows that NeoForge/Forge injection does not work in production, R-A is Fabric-only and the other loaders wait for the managed-copy decision (3.5). The concept stays valid; the matrix shrinks.

### 11.2 Packages and order

| Wave | Package | Content | Needs |
|---|---|---|---|
| 0 | **S0** API spike | compile-against-both-ends tool; per-era API table for the calls in `compat` (Screen, widgets, toasts, clipboard, LAN publish, connect, disconnect, key mapping, session); fixes the real node list | - |
| 0 | **S1** topology spike | Stonecutter with three hello-world nodes (`26.3-fabric`, `1.21.1-neoforge`, `1.20.1-forge`), the real injection flag per loader, loader start log shows the mod, non-ASCII data path on Windows, `FILE_SHARE_READ` effect, node-id naming | - |
| 0 | **S2** smoke harness | headless launch through the launcher pipeline, `ready` handshake, CI job | S1 |
| 0 | **D0** docs | section 9 | - |
| 1 | **L1** injection core | index, selection, Java check, materialise, argument merge, breaker (Rust) | S1 |
| 1 | **L2** bridge 2 | protocol 2, owner check, exclusive bind, launch records, scopes | - |
| 1 | **M1** mod core | Java core: client, protocol, state store, view-models | S0 |
| 2 | **U1** compat + kit | compat for two eras (26.3 Fabric and 1.21.1 or 1.20.1), widget kit, throwaway screen proving button, `EditBox`, scroll pane, narration, resize | M1, S0 |
| 2 | **O1** ops (R-A set) | dispatch, topics, consent dialog, activity list, `launcher.open` | L2 |
| 2 | **F1** frontend | status row, settings, dialogs, contract types | L1, L2 |
| 3 | **U2** screens (R-A set) | hub, friends, requests, invites, add by name, share, options | U1, O1 |
| 3 | **J1** join here | launcher + mod | U2, O1 |
| 3 | **V\*** nodes | one package per node group from S0 | U1 |
| 4 | **G1** release gate | CI matrix green, owner Windows pass, size budget, release workflow | all of R-A |

Ownership rule: `contract.rs`, `friends-types.ts` and the shared fixtures may be amended by the package that needs the change, with the Rust, TypeScript and fixture edits in the same change. `compat/` additions needed by a screen package are made by that package for every existing node.

---

## 12. Risks

1. **Production injection on NeoForge 21.9+/26 uses a development feature** (`fml.modFolders`) and may change or vanish. Mitigation: smoke test per release; cell off if red.
2. **Headless CI for 26.x** may not start (renderer). Mitigation: S1 answers it early; fallback is an owner-run smoke script.
3. **Non-ASCII user folders on Windows** can break JVM option paths (`C:\Users\Jürgen\...`). Mitigation: list-file form, S1 test with such a path, ASCII-only fallback location.
4. **A crash that happens after the 90-second window** is not caught by the circuit breaker. Accepted; the per-instance switch is the manual exit.
5. **Same-JVM code can use the bridge** (5.1). Mitigation: narrow API, prompts, visibility; honest privacy text.
6. **Every mod fix is a launcher release.** Accepted for what it buys (no distribution channel, one signed artifact); the updater makes it quick, the breaker makes a bad node survivable.
7. **26.x cadence.** Every quarterly release so far changed a signature we use; each needs a node and a smoke run. The explicit-id rule means new releases stay un-injected until then.
8. **Mojang's own friends list on 26.2+** overlaps in purpose. We ship, never bind `O`, and skip the title button when it would collide.
9. **Forge/NeoForge client-only declaration** details (display test, network negotiation) are from memory and must be proven in S1.
10. **Effort.** Node count and per-node proof dominate. S0/S1 turn guesses into numbers before R-A is scheduled.

---

## 13. What changed against MOD2

**Dropped (foreign-launcher only):** discovery file, `attach` with mutual HMAC, game report, Mojang account proof, pairing prompts and sticky denials, `ProcessKey`/`procinfo` for foreign processes, `ExternalGame`, v1 compatibility, golden HMAC vectors, "Spiele aus anderen Launchern erlauben".
**Dropped (embedding):** Modrinth project, `mod-release.yml`, `MOD_PROJECT_ID`, install command and button, Fabric API install, "our mod" matching exception, manifest special cases.
**Kept and reduced:** per-node matrix and build architecture (3.x of MOD2), topics/ops/events design, UI tree, Teilen state machine, join flows, scopes (3 -> 2).
**Review findings carried over:** honest threat model, exclusive bind on Windows, PID check on the token path, `online_account` on `joinHere`, counters keyed on the launch, fail-closed owner lookup, clickjack guard, `friend.rename` in the social scope, `identityChanged` launcher-only, three-release cut, compile-both-ends instead of fingerprint, two eras before the UI contract is frozen, tracer topology spike, matrix CI instead of one job, view-model layout tests, `rebuild()` state preservation, shared golden fixtures, early interop gate, reduced first-release parity, title button and shortcuts deferred, one JDK source of truth.
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
| 8 | `Immer fragen` default for in-game actions | pre-granted | none for safety, but one alt-tab per launch on the first action; a pre-grant switch exists for people who accept that |
| 9 | Explicit release ids | open ranges | new Minecraft releases break silently |

Owner tasks that remain: the Windows owner pass per release, a second Microsoft account for share/join runs, and the answers to any decision above you want to flip. No Modrinth project, token or publish approval is needed any more.

---

## Appendix A: injection mechanisms (research, 2026-10-03)

"Source" = read in loader source or artifacts; "unproven" = must be shown by experiment (S1/S2). Nothing here was run against a real client.

| Loader | Mechanism | Detail | Status |
|---|---|---|---|
| Fabric >= 0.12 | `-Dfabric.addMods=<list>` (also `--fabric.addMods`) | entries split on `File.pathSeparator`; accepts a jar, a directory (walked for `.jar`), an unpacked mod directory, or `@listfile` (one path per line); files must end in `.jar`, hidden/dot files are skipped; a missing path logs a warning | source; NoRiskClient ships `-Dfabric.addMods=@<file>` today |
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

1. `-Dfabric.addMods` on Fabric 26.3 and on an obfuscated version (1.20.1): mod loads, Mixin applies, no `.fabric/processedMods` surprises.
2. Fabric duplicate id (user copy lower, equal, higher).
3. NeoForge 21.1.x via `--fml.mavenRoots`; 20.4 and 21.8 optional.
4. NeoForge 26.1.2.114 and 26.2.0.88 via `-Dfml.modFolders`; class-loading guard quiet.
5. Forge 1.20.1 (47.4.x) via `--fml.mavenRoots`; client-only display test.
6. Windows: non-ASCII data path; `FILE_SHARE_READ` handle held while loaders read the jar.
7. Headless start of 26.x clients under software rendering.
8. Stonecutter node naming with `-neoforge`/`-forge` suffixes and predicates.
9. Screen-init hook per loader (Fabric Mixin target `PauseScreen#init`, NeoForge/Forge screen-init event) on the tracer versions.
10. Behaviour of a client-only NeoForge/Forge mod against modded servers (not relevant for the loopback tunnel, relevant if players also use their instances on servers).
