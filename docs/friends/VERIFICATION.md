# Pumpkin Friends: verification record

Results for the release gates of `SPEC.md` section 1.3. The owner fills this in; agents only
prepare the tables. A gate is met when every required row is filled and passes.

How to get each result, in order and in plain German: [`OWNER-CHECKLIST.md`](OWNER-CHECKLIST.md). The
sections below follow its steps: G1 is step 2, G2 is steps 1 and 3, G3 is step 5, G4 is step 6, G5 is
step 7.

## G1: P2P viability (R0b spike, owner run)

How to run and what each number means: [`tools/p2p-spike/README.md`](../../tools/p2p-spike/README.md).
Required: at least one row each for pair **(a)** two different home ISPs or home + office,
**(b)** home + mobile hotspot (CGNAT), **(c)** any pair with `--relay-only`. Every row needs the
path, the connect time, echo p50/p99 and whether the vanilla LAN join through the spike tunnel worked.

| Date | Pair | PC A network | PC B network | Flags | Path | Connect (ms) | Direct after (ms) | Echo p50 / p99 (ms) | Throughput (MiB/s) | LAN join | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | (a) | | | | | | | | | | |
| | (b) | | | | | | | | | | |
| | (c) | | | `--relay-only` | relay | | skipped | | | | |

G1 met: [ ] (date, initials)

## G2: owner end-to-end table (SPEC 13.4)

Two PCs in different networks, two Microsoft accounts. The real Microsoft login test is done
first (`docs/ACCOUNT-SETUP.md`, section 4; checklist step 1). Result is `pass` or `fail`; put measured
times and exact messages into the notes. The launcher build on both PCs is the same build with the
`beta-relays` feature or a debug build (checklist step 3.1); note which one in the first row below.

| Check | Date | Build / notes |
|---|---|---|
| Real Microsoft login test passed | | |
| Launcher build on both PCs (`beta-relays` or debug, version) | | |

| # | Case | Pass criterion | Result | Date | Notes |
|---|---|---|---|---|---|
| E1 | Code exchange, inviter **offline** at redemption (at least 5 min), then starts its launcher; once the inviter is online, the invitee presses "Jetzt zustellen" | The inviter has the incoming request within 30 s after the press. After the inviter accepts, both sides show the friend within 30 s. (Unattended delivery follows the 4.3 backoff and is not timed here.) | | | |
| E2 | Presence | Online within 10 s of start. Offline within 3 s of a normal exit, within 45 s of killing the process | | | |
| E3 | Vanilla 26.3 host, guest joins via launcher (direct path) | In world, path "Direkt", RTT shown | | | |
| E4 | Same with "always relay" on the guest | Path "Relay". `netstat` on the host shows no connection from the guest's IP | | | |
| E5 | Fabric 26.3 host with the fixture set `fabric-api, lithium, ferrite-core, sodium (client-only), modmenu (client-only)`; guest instance without sodium and modmenu | Plan `ready`, join works | | | |
| E6 | Guest missing `lithium` | Plan `missingContent` with missing = Lithium | | | |
| E7 | Vanilla host, guest without the instance | "Vanilla-Instanz anlegen" → join works | | | |
| E8a | Offline account on the guest | Join refused in the UI before launch | | | |
| E8b | While the host shares a vanilla 26.3 world, a Minecraft 26.3 client with an **offline account** uses Direct Connect to the host's verified LAN port (from a second device in the host's network to `<host LAN IP>:<port>`, or on the host PC to `127.0.0.1:<port>`) | The vanilla login fails; the exact message is recorded (expected "Failed to verify username!", or the client-side "Invalid session"). The player never enters the world. | | | |
| E9 | Every row of 6.5 that needs two PCs | Events as specified | | | |
| E10 | Mod: share from the pause menu with launcher confirmation, toasts, kick, stop; the owner GUI checklist 13.3.2 | Every item of 13.3.2 passes | | | |
| E11 | Host quits to the title screen | Session ends `lanClosed` within 2 s (log) or 30 s (liveness) | | | |
| E12 | Windows Firewall prompt on first enable | Behaviour recorded, both choices still connect (relay at worst) | | | |
| E13 | Child account with multiplayer blocked (if available) | Clear vanilla message recorded | | | |

If a fixture mod has no 26.3 release, substitute another Modrinth mod with the same side
classification, and record it in the notes.

### E10: mod GUI checklist (SPEC 13.3.2, `mod/README.md`)

Run against `java scripts\FakeLauncher.java` first, then against the real launcher (checklist step 3.3).
E10 passes when every row passes in both runs.

| # | Item | FakeLauncher | Real launcher | Notes |
|---|---|---|---|---|
| 1 | Without env: no button, no crash, one log line | | | |
| 2 | The button appears only while connected | | | |
| 3 | Publish from the mod: the launcher shows the verified port (source `mod`) | | | |
| 4 | Publish from vanilla World Options: same | | | |
| 5 | First invite from the mod: "Bestätige im Launcher", and after allowing it the friend gets a toast with a head | | | |
| 6 | Kick and stop: the friend is disconnected and gets a toast | | | |
| 7 | Kill the launcher mid-session: the UI hides, the game runs on without exceptions | | | |
| 8 | Resize with the pause menu open: no duplicate button | | | |
| 9 | German and English | | | |
| 10 | A name containing `§c` and bidi characters is shown without formatting | | | |

### E9: close behaviour (SPEC 6.5, rows that need two PCs)

| Case | Result | Notes |
|---|---|---|
| Host stops sharing (launcher or mod) | | |
| Host kicks the guest | | |
| Guest declines the invite | | |
| Host quits the world to the title screen | | |
| Host game exits | | |
| Host launcher exits normally (guest ends within 3 s) | | |
| Host launcher crashes (guest `hostOffline` within about 70 s) | | |
| Guest leaves | | |
| Guest game exits | | |
| Guest launcher exits (host sees it within 40 s) | | |
| Guest launch fails before spawn | | |
| Host disables friends (within 3 s) | | |
| Guest disables friends (within 3 s) | | |
| Host changes "always relay" or rotates / resets the identity | | |

G2 met: [ ] (date, initials)

## G3: our own relay (SPEC 1.3, `RELAY-OPS.md` section 8)

Checklist step 5. Run the spike with `--relay https://relay-eu1.<relay-domain>/` on both PCs of one G1
pair. Required: `Relay connected after ... ms` and a `Public address seen by the relay` line that equals
the PC's public address (not `none reported`). Also add the G1 rows of this relay to the G1 table above.

| Date | Relay URL | Relay connected (ms) | Public address seen = real public IP | `/generate_204` returns 204 | `--relay-only` throughput (MiB/s) | `relayserver_conns_rx_ratelimited_total` rose | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

| Check | Result | Date |
|---|---|---|
| `RELAY_MAP` index 0 is our relay in both variants (`src-tauri/src/services/p2p/relays.rs`) | | |
| A release build lists only `RelayOperator::Pumpkin` entries | | |
| Abuse and privacy mailboxes exist, operator and hoster filled in `PRIVACY.md` | | |

G3 met: [ ] (date, initials)

## G4: Mojang and Microsoft compliance (SPEC Appendix C)

Checklist step 6. Where each item is met is listed in `PRIVACY.md`, section 8.

| Done | Item | Date / evidence |
|---|---|---|
| [ ] | The launcher About page and the mod description carry "NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT." | |
| [ ] | No Minecraft logo or Mojang branding in the friends UI or the mod. The name "Pumpkin Friends" does not suggest officialness. | |
| [ ] | Free, with no paid perks or gating. No game files are distributed between peers. Each client downloads from Mojang and Modrinth only. | |
| [ ] | Online-mode only. Offline accounts are refused before launch (E8a, plus the R3 unit test), and the host's game refuses them at login (E8b, with the recorded vanilla message). | |
| [ ] | Child-account behaviour recorded (E13). The feature does not bypass Xbox or Mojang multiplayer restrictions (it uses the vanilla join path). | |
| [ ] | The Usage Guidelines were re-read at release time (date recorded). | |
| [ ] | The owner confirmed that the Microsoft/Mojang app approval covers sharing player names and UUIDs between users. | |
| [ ] | The Modrinth API is used with the launcher User-Agent and within its rate limits. | |

G4 met: [ ] (date, initials)

## G5: CI and release readiness

Checklist step 7.

| Check | Result | Date |
|---|---|---|
| CI green on `main` (13.5), including the `mod` job | | |
| `pnpm build` and `pnpm check:lib` pass | | |
| Release binary size delta re-measured with the real endpoints (SPEC 3.1) | | |
| Doc-sync (SPEC 13.5, item 5): sections 3 to 9, 11 and Appendix A match the code | | |
| Mod published on Modrinth, `MOD_PROJECT_ID` set in `mod-release.yml` and `modinstall.rs` (no gate; without it the mod install is unavailable) | | |
| Closed-beta decision recorded (checklist step 7): n0 relays, build route | | |

G5 met: [ ] (date, initials)
