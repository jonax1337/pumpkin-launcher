# Pumpkin Friends (Fabric mod)

Client-only Fabric mod for Minecraft **26.3** that connects the game to the Pumpkin Launcher's
Friends feature (`docs/friends/SPEC.md`, sections 7 and 11). From the pause menu it shows your
friends, opens the singleplayer world to LAN, invites online friends, lists guests (with
"Entfernen"), stops sharing, and shows received invites. Notifications appear as toasts.

Without the launcher the mod does nothing: if the game was not started by the launcher with
Friends enabled, it writes one log line and starts no thread and no UI. The launcher treats
everything the mod sends as untrusted, and the first share of every game start must be confirmed
in the launcher.

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

## Versions

Checked against `meta.fabricmc.net` and `maven.fabricmc.net` on 2026-10-03:

| Item | Version |
|---|---|
| Minecraft | 26.3 (`"minecraft": "~26.3"`) |
| Fabric Loader | 0.19.5 |
| Fabric API | 0.161.0+26.3 |
| Loom | `net.fabricmc.fabric-loom` 1.18.2 (no remapping) |
| Gradle wrapper | 9.7.1 (distribution SHA-256 pinned in `gradle/wrapper/gradle-wrapper.properties`) |
| JDK | Temurin 25, `options.release = 25`, `"java": ">=25"` |
| JUnit | 6.1.3 |

## Build and test

Everything runs without admin rights and without a system-wide Java or Gradle. The dev-env
script downloads a full Temurin 25 JDK from the Adoptium API into `mod/.jdk/` (gitignored),
verifies its SHA-256 against the checksum the API reports, and sets `JAVA_HOME` for the current
shell. Mojang's bundled Java runtimes are never used.

Windows (PowerShell), from the `mod` folder:

```powershell
.\scripts\dev-env.ps1
.\gradlew.bat build
.\gradlew.bat test
```

Linux and macOS, from the `mod` folder (note the leading dot, so `JAVA_HOME` stays set):

```sh
. scripts/dev-env.sh
./gradlew build
./gradlew test
```

The jar lands in `build/libs/`. `./gradlew build` compiles every class against the real 26.3
game and Fabric API, so a changed game signature fails the build. Run `./gradlew genSources` as
a separate invocation if you want readable game sources in your IDE.

The tests cover the Minecraft-free parts: `ProtocolTest`, `BackoffTest`, `StateStoreTest`,
`SanitizeTest`, and `BridgeHarnessTest`, which plays the launcher side of the protocol from a
script (`ScriptedLauncher`) against the real bridge client.

## Layout

```
src/client/java/dev/laux/pumpkin/friends/
  FriendsClient.java   entry point: launcher environment present -> bridge, else nothing
  bridge/              connection to the launcher (no Minecraft classes)
  state/               sanitised state for the client thread (no Minecraft classes)
  mc/                  pause-menu button, friends screen, LAN watcher, toasts
src/test/java/...      JUnit tests and the scripted launcher
scripts/               dev-env.ps1, dev-env.sh, FakeLauncher.java
```

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
   line, then start the game with `.\gradlew.bat runClient` (or `./gradlew runClient`).

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
been checked in the game yet. The owner runs this list as part of E10 (SPEC 13.4) and records the
results in `docs/friends/VERIFICATION.md`.

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
