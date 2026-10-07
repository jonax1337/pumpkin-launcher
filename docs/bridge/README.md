# Pumpkin Bridge: injection and local protocol

Last updated: 2026-10-06.

Pumpkin Bridge (`pumpkin_bridge`, Java package `dev.laux.pumpkin.bridge`) is the client-only Launcher–Minecraft integration bundled with Pumpkin Launcher. Its shared transport, local protocol and UI home connect the running game to the launcher independently of any feature module. A detached Pumpkin entry in Minecraft's title/pause menus opens the module tile home. Friends is the only currently implemented module, under `modules/friends/`; it owns its state and submenu, not the shared connection or menu shell. Bridge is not a separately installed Friends mod and does not support games started by other launchers.

The shared Bridge listener and injection switches are independent of Friends opt-in. Friends networking, private data and actions still require consent. Identity/privacy settings are launcher-only. See the [Friends specification](../friends/SPEC.md) for peer/world-sharing contracts and [privacy reference](../friends/PRIVACY.md) for same-JVM exposure.

## Compatibility for players

This guide describes Pumpkin Bridge in **0.3.0**. Use the [release history](../../CHANGELOG.md)
for older versions and the [player guide](../../README.md) for installation.

Bridge is bundled with the launcher, not a mod to download into `mods/`. It is injected only
for an exact supported Minecraft/loader combination; Vanilla and unsupported combinations
still launch without it. Check [your installed build](#check-your-installed-build) first:
the [build registry](#support-selection) is not a list of verified or embedded runtime cells.
Enabling Bridge does not enable Friends or grant permission to share a world.

### Check your installed build

In **0.3.0**, open the instance's **Worlds** tab and read the
**Pumpkin Bridge** status row. It reflects that launcher's embedded support, the instance's
loader and game Java, not the latest repository index. **Current UI limitation:** this row
and its per-instance controls appear only while Friends is already enabled, because they
live in the sharing section. Bridge itself works independently of Friends; you do not need
to opt into Friends to use it. The independent global switch is always under
**Settings > Friends > Pumpkin Bridge**.

| Status reason | Meaning and next step |
| --- | --- |
| **Not available in this build** | This launcher has no usable bundled Bridge distribution. Use a release that includes it; adding a JAR to `mods/` is not a replacement. |
| **Not available for … yet** / **Not released for … yet** | The exact release/loader cell is absent or lacks packaged startup evidence. Continue without Bridge, or choose a supported setup that also suits your pack. Reinstalling the same build or manually adding a JAR does not support that cell. |
| **Needs … or newer** / **Needs Java … or newer** | Update the instance's loader or selected game Java to the stated minimum, keeping the pack's requirements in mind. |
| **Switched off in the settings** | Check the independent global switch above; when globally off, the per-instance switch is hidden. |
| **Switched off after a start failure** | Follow [startup recovery](#startup-recovery), rather than treating this as an unsupported cell. |

Vanilla reports **Needs a loader**. **Add Fabric?**, where offered, changes the instance's
loader; it is not a universal fix for an existing modpack. Other reasons identify an unknown
loader/Java version, a duplicate `pumpkin_bridge` file, a non-Microsoft account or a stopped
launcher connection. Resolve the stated condition rather than bypassing the injection gate.

Jump to [implementation](#implementation-map), [support](#support-selection),
[embedded files](#embedded-index-and-files), [loader strategies](#loader-strategies),
[startup recovery](#startup-recovery), [connection ownership](#connection-and-ownership),
[Protocol 2](#protocol-2), [operations and consent](#operations-and-consent) or
[in-game behavior](#in-game-navigation-and-world-behavior).

## Implementation map

| Area | Source, relative to repository root |
| --- | --- |
| Launcher injection | `src-tauri/src/services/modbridge/ingame/` |
| Spawn integration | `src-tauri/src/ingame_launch.rs`, `src-tauri/src/services/modbridge/launch.rs` |
| Local listener/protocol | `src-tauri/src/services/modbridge/{listener,server,protocol,ops,topics,limits}.rs` |
| Friends feature handler | `src-tauri/src/services/friends/mod_link*.rs` |
| Java connection/request transport | `mod/core/src/main/java/dev/laux/pumpkin/bridge/transport/` |
| Module registration and home | `mod/src/main/java/dev/laux/pumpkin/bridge/ui/home/BridgeHomeScreen.java`, `mod/src/main/java/dev/laux/pumpkin/bridge/ui/kit/BridgeModule.java` |
| Friends model and screens | `mod/core/src/main/java/dev/laux/pumpkin/bridge/modules/friends/`, `mod/src/main/java/dev/laux/pumpkin/bridge/modules/friends/` |
| Version/loader differences | `mod/src/main/java/dev/laux/pumpkin/bridge/compat/`, `mod/src/main/java/dev/laux/pumpkin/bridge/platform/`; shared initialization in `mod/src/main/java/dev/laux/pumpkin/bridge/platform/shared/BridgeBootstrap.java` |
| Authoritative support/build data | `mod/nodes.txt`, `mod/verified.json`, `mod/index.schema.json` |
| Local protocol fixtures | `mod/fixtures/protocol/` |

Build setup is documented in [mod README](../../mod/README.md). Minecraft member signatures are in [MINECRAFT-API.md](MINECRAFT-API.md); source artifacts, not historical recommended node lists, determine compatibility.

## Support selection

A release/loader cell is injected only if the embedded index explicitly claims its exact Minecraft release, loader and minimum loader version, the selected game Java meets `javaMin`, and `verified.smoke` is populated. Global/per-instance injection settings, a live shared listener, a Microsoft account and no duplicate/auto-disabled Bridge are additional gates. Unsupported cells launch normally without injection. Vanilla has no loader and gets no Bridge; Quilt has its own registered identity and strategy.

[`mod/nodes.txt`](../../mod/nodes.txt) lists 102 build targets across Fabric, Quilt, Forge
and NeoForge for 27 selected Minecraft releases, including 1.16.5, 1.18.2 and 1.19.2
anchors and explicit modern releases. For example, find the exact `1.21.1-neoforge`
row, then its matching entry in [`mod/verified.json`](../../mod/verified.json).
The build embeds the validated package; automatic injection requires recorded startup evidence.
102 registered targets do not mean 102 verified runtime combinations. Wider matrix
ranges are compile targets, not implicit support claims. Future releases do not
match a neighboring node automatically.

The production core targets Java 8; Gson 2.8.0 and Log4j API 2.8.1 are compile-only baselines, not bundled old game logging implementations. Minecraft 1.16.5 uses Java 8 and patched runtime Log4j 2.17.1. Gradle/plugin Java and game Java are separate constraints; test tooling requires JDK 17 or newer.

`mod/verified.json` is the current evidence source: smoke dates select cells eligible for automatic injection, not which validated JARs are packaged; `owner` is a separate nullable field. A `ready` handshake advertises capabilities, not rendered menus, approved social actions or successful sharing/joining. Existing local Windows evidence does not establish cross-network/two-account Friends correctness, CI software-rendered startup or non-Windows runtime behavior.

## Embedded index and files

The top-level index has `modVersion` and nodes. Each node carries `id`, `loader`, `loaderMin`, exact `minecraft[]`, `javaMin`, `strategy`, `file`, `sha256` and optional/null `verified:{smoke,owner}`. Unknown fields, duplicate claims/files/IDs and invalid versions/strategies/hashes make the index unusable. The schema and validators live in `mod/index.schema.json`, `mod/scripts/validate-mod-index.mjs` and Rust `ingame/{index,validate}.rs`.

The build embeds index/JAR bytes in the launcher; the launcher materialises them under `<app-data>/runtime/bridge-mod/<modVersion>/`, using a node-specific Maven tree where needed. They never enter `instances/<id>/minecraft/mods/`. Exports, templates, duplication, pack updates, content adoption and Friends manifests operate on instance content and need no Bridge exception.

Before launch, materialised JARs are SHA-256 checked. Missing/changed files are rewritten atomically and made read-only. Windows keeps a `FILE_SHARE_READ` handle until spawn to narrow check-to-load replacement. Build identity is also registered with the local launch token and verified against the mod's reported JAR hash. This detects corruption/accidental copies, not malicious same-user code or a replaced launcher binary.

A manually installed `pumpkin_bridge` duplicate suppresses injection; it is ordinary instance content, not a matching bypass. Existing user loader options are preserved rather than replaced wholesale.

## Loader strategies

| Strategy | Loader/era | Added startup data |
| --- | --- | --- |
| `fabricAddMods` | Fabric | `-Dfabric.addMods=<jar>` or merged list file; pre-26 targets use remapped production JARs |
| `quiltAddMods` | Quilt | `-Dloader.addMods=<jar>`; Quilt identity/version, no Fabric API dependency |
| `fmlMavenRoot` | Forge 1.16.5-1.20.2 and NeoForge through FML 9 | `--fml.mavenRoots <tree>` and `--fml.mods dev.laux.pumpkin.bridge:pumpkin_bridge:<version>` |
| `fmlModFolders` | NeoForge FML 10+ | `-Dfml.modFolders=pumpkin%%<jar>` |
| `forgeClasspath` | Forge 1.20.3+ | One materialised production JAR appended to the launch classpath |

Extra-mod/folder properties follow JVM last-value semantics: replaced duplicate occurrences are removed and the combined entry is added once. Repeated user FML options are preserved; identical injected options are not repeated. List files are combined under launcher data. The caller uses reduced `user_jvm`/`user_game` argument outputs, not the originals plus replacements.

There is no fallback copy into `mods/`, Java agent or generic Fabric classpath injection. A failing strategy leaves the cell unsupported until it is corrected. A Fabric/Loom development run is not evidence that Quilt injection works.

Custom game Java is read from its runtime `release` file or a cached `java -version` lookup. A too-old game runtime skips injection instead of causing loader startup failure.

## Startup recovery

For the current controls, use the instance's **Worlds > Pumpkin Bridge** row (subject to
the [Friends-off visibility limitation](#check-your-installed-build)). When it says
**Switched off after a start failure**, **Try again** clears that automatic disablement
for another launch. To leave Bridge off for this instance, use **Pumpkin Bridge for this
instance**. The global **Settings > Friends > Pumpkin Bridge** switch remains independent
of Friends consent and is available even when the row is hidden.

The circuit breaker watches the first ninety seconds. A loader/Mixin failure naming `pumpkin_bridge` or `dev.laux.pumpkin.bridge` marks the instance `autoOff{reason,launcherVersion}`. Unrelated crashes do not trigger it. Live log analysis catches error-screen failures before the player closes Minecraft; exit analysis uses the same scoped patterns.

The launcher offers restart without Bridge or retry, without changing Friends consent. A launcher-version change or explicit retry lifts the auto-off state. Failures after the startup window can escape detection; the mod's entry points also guard exceptions and disable its UI rather than throw into the game.

The existing `friends_ingame_*` commands and `friends-ingame*` events remain the instance settings API. Their names do not define a second injection mechanism or the mod identity.

## Connection and ownership

At spawn the launcher registers a launch token, instance/node/build expectations, online-account state and spawned game PID. It supplies `PUMPKIN_IPC_PORT`, `PUMPKIN_IPC_TOKEN` and `PUMPKIN_IPC_PROTOCOL=2` in the environment, never token-bearing command-line arguments.

The listener binds only `127.0.0.1`, with exclusive address use on Windows. The Java client also connects explicitly to IPv4 loopback. A hello must use a registered token and come from the spawned game's process according to the OS TCP ownership lookup. Missing PID bookkeeping returns `retry`; lookup failure/mismatch fails closed with `owner`. A wrapper that spawns a different JVM is not silently accepted as the original PID.

One live link is allowed per launch. Duplicate connections are rejected; grants and counters belong to the launch record and survive reconnects. Friend aliases belong to the connection and are rebuilt on reconnect. The token ends with the launch, not with a temporary transport failure.

Disable, reset and identity changes revoke feature grants, queued private topics/responses and work/publication generations without stopping the shared listener. `state.sync` and `launcher.open` remain shared operations. A private write interrupted during revocation can close that one socket to avoid completing a stale partial JSON line; the game can reconnect with its launch token. Previously delivered information cannot be recalled.

## Protocol 2

The exact JSON shapes are Rust `modbridge/protocol.rs`, `ops.rs`, `topics.rs` and shared fixtures in `mod/fixtures/protocol/`. Java core and Rust consume the same fixtures. Protocol changes must update both ends together; there is no legacy protocol compatibility shim.

Frames are UTF-8 JSON lines with `type`. Initial exchange:

```text
hello{protocol:2,token,mod:{version,build},
      game:{minecraft,loader,loaderVersion,java}}
welcome{protocol:2,launcher,scopes:{share,social}}
  or reject{reason}
```

Reject reasons include `token`, `protocol`, `owner`, `build`, `duplicate`, `retry`. Reject closes the connection. The game block is diagnostic; backend launch records remain authoritative. Scope values are `ask` or `allow`.

The mod hashes its own production JAR. FML uses the loader-registered ModFile path; Fabric/Quilt use the sole original `ModOrigin.getPaths()` entry through `BuildId.ofLocation`, not transformed CodeSource. Production reports a lowercase SHA-256 prefix, normally at least sixteen characters; backend checking rejects a prefix shorter than eight or one that does not match. Development locations report `dev`; expected hashes are never substituted for computed ones.

### Requests, topics and events

A request is `req{id,op,args}`. IDs match `^[a-z0-9]{1,12}$`; duplicates/invalid arguments are refused. A response is `res{id,ok,result}` or `res{id,ok:false,error:{code,params}}`. When launcher consent is pending, `pending{id,prompt:"scope",scope}` precedes the final response. The backend deadline is 125 seconds; Java waits longer after pending so the consent response can arrive.

Whole-value topic pushes carry per-topic revisions. The client replaces state, never patches. Topics include `me`, `friends`, `requests`, `invites`, `session`, `join`, `game`, `codes` and `blocked`; `me` includes directory availability. Friend IDs in this channel are per-connection aliases, not raw peer IDs. Private topics are gated/redacted by Friends availability.

Events are `event{event:"notify",kind,name?}` or `event{event:"closing",reason}`. Notifications include request/invite receipt, online friends, guest changes, session/join end and denied scope. Closing reasons include launch end, stopped Bridge and replacement. The mod additionally sends `lanOpened{port}`, `lanClosed`, `ready{screens}`, `ping` and `pong`; LAN frames are hints, never verified port ownership. Current ready capabilities are `home` and `friends`.

| Limit | Value |
| --- | --- |
| Before welcome | 1 KiB/line, hello within 2 seconds, four unauthenticated connections |
| Mod to launcher | 16 KiB/line, twenty messages/second, eight requests in flight |
| Launcher to mod | 64 KiB/line; topics fit within 60 KiB |
| Queues | 64 outgoing frames, 32 events (oldest event dropped, responses not dropped) |
| Topic coalescing | 250 milliseconds |
| Stalled writer | Five-second deadline |
| Liveness | Ping every ten seconds; thirty seconds without a mod line closes the link |

## Operations and consent

`modbridge/ops.rs` defines twenty-two operations; argument/error shapes are in its types and golden fixture lines, rather than a parallel schema here.

| Group | Operations | Consent |
| --- | --- | --- |
| Shared/read | `state.sync`, `launcher.open`, `invite.plan`, `friends.retry` | No private-action grant; availability still enforced |
| Requests | `request.answer`, `request.cancel` | Social for answering; cancellation does not widen exposure |
| Add/code management | `friend.addByName`, `friend.addByCode`, `code.create`, `code.revoke` | Social |
| Graph changes | `friend.rename`, `friend.remove`, `friend.block`, `blocked.unblock`, `friend.acknowledge` | Social; acknowledge only an ordinary rename notice |
| Join | `invite.joinHere`, `invite.decline`, `join.leave`, `join.failed` | Social for join; teardown/decline needs none |
| Hosting | `host.invite`, `host.kick`, `host.stop` | Share for invitations; teardown needs none |

No operation enables/disables Friends, rotates/resets identity, changes findability/relay settings, accepts relay terms, copies the full peer ID or approves identity-change/added-in-game notices. Those actions stay in the launcher.

The launcher asks for `share` and `social` once per launch, default deny focus. Global `ingameActions=allow` can pre-grant; otherwise the grant lasts only until game end. One prompt may be open per launch; at most three prompts/ten minutes. Non-deny buttons have a one-second focused delay and cannot accept a pointer release begun before the dialog appeared. `launcher.open` cannot steal focus while a dialog is open.

Per-launch sliding limits: name addition five/minute and twenty/hour, answering twenty/minute, host invites three/minute, window opening once/ten seconds, other operations thirty/minute. Reconnects do not reset these limits.

Scopes limit API abuse by semi-trusted mods, not arbitrary malicious code running as the user. Other mods can read the port/token, speak the channel and access same-user keys. The OS-owner check prevents simple token use by a different process, not same-JVM impersonation.

## In-game navigation and world behavior

The detached logo does not move Vanilla controls. Home contains registered feature tiles; Friends keeps its own screen, tabs, scroll/focus and parent navigation. ESC/back follows the parent screen. Compatibility/platform code owns loader/version differences; shared UI model/layout is Minecraft-independent.

Sharing uses Vanilla publish-to-LAN, then verified launcher hosting. Before Minecraft 26.2, stop ends the tunnel but cannot unpublish the LAN server: the world remains available on the local network until it is left. Newer supported versions can unpublish. The UI must tell the player which behavior applies.

`invite.joinHere` first asks for a plan for the running instance. A mismatch does not silently change content or launch a different game. On acceptance it confirms leaving the current world, uses the launcher-issued join address and reports connection failure through `join.failed`. All guest/host trust and manifest checks remain in Rust.

Build/runtime tooling is documented where it lives: [mod README](../../mod/README.md), [API probe](../../tools/mc-api-probe/README.md), [production launch harness](../../tools/mod-smoke/README.md). This document deliberately carries no rollout waves, owner task table or historical smoke transcript.
