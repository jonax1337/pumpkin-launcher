# Pumpkin Friends: verification record

Results for the release gates of `SPEC.md` section 1.3. The owner fills this in; agents only
prepare the tables. A gate is met when every required row is filled and passes.

How to get each result, in order and in plain German: [`OWNER-CHECKLIST.md`](OWNER-CHECKLIST.md). The
sections below follow its steps: G1 is step 2, G2 is steps 1 and 3, G3 is step 5, G4 is step 6, G5 is
step 7. Section N (finding friends by name) is step 8. Section M3 (the in-game mod, `INGAME.md`) is
step 9.

## 0.2.0: release gate (checklist step 0)

The gate for the 0.2.0 release candidate (first release with the in-game mod). The owner fills this in;
"expected" is what counts as a pass. The smoke rows below re-run the local smoke on the release commit
(the 2026-10-04 entries in M3.1 prove the cells, these prove the release commit).

| # | Gate | Expected | Result | Date | Notes |
|---|---|---|---|---|---|
| V1 | Every version field is 0.2.0: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` + `Cargo.lock`, `mod/gradle.properties` | All four show 0.2.0; no file names 2.1.0/2.0.1 as a current version | | | |
| V2 | Mod dist of the release commit (`gradlew build modIndex` in `mod/`) | `mod-index.json` has `modVersion: "0.2.0"`, seven jars `pumpkin_friends-0.2.0+<node>.jar`; `validate-mod-index.mjs` and `checkJarBudget` pass | | | |
| V3 | Local smoke on the release commit, all seven cells (`tools/mod-smoke/run.ps1`) | Every cell `passed`; the game log names `pumpkin_friends 0.2.0+<node>` (rows below) | | | |
| V3a | 26.3-fabric | `passed` | | | |
| V3b | 1.21.1-fabric | `passed` | | | |
| V3c | 1.21.8-fabric | `passed` | | | |
| V3d | 1.21.11-fabric | `passed` | | | |
| V3e | 1.21.1-neoforge | `passed` | | | |
| V3f | 26.2-neoforge | `passed` | | | |
| V3g | 1.20.1-forge | `passed` | | | |
| V4 | Release workflow first run (tag `v0.2.0`): mod jobs green, dist check passed, embedding log line present, smoke feature absent | *Mod node list*, the seven *Mod node* jobs and *Mod package* green; *Build* logs `Embedding pumpkin_friends 0.2.0 (7 jars).`; no `-D features=smoke`/`--features smoke` anywhere in the run | | | |
| V5 | Shipped binaries embed the mod | Installed 0.2.0 launcher: instance row shows "Freunde-Menü im Spiel: aktiv" for a supported cell; nothing appears in the instance's `mods/` folder | | | |
| V6 | Draft reviewed and published (`docs/friends/RELEASE-0.2.0.md` as the tag text) | Installers tested, release published; updater offers 0.2.0 | | | |
| V7 | In-game owner pass with a second account (checklist 0.7 = step 9) | Every M3 row filled (9.0 visual pass, 9.1 deep run per loader, 9.2 short run per node, 9.3-9.8); "M3 met" checked | | | |

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
| [ ] | The owner confirmed that fetching the player certificate (`/player/certificates`) and the account attributes (`/player/attributes`) is covered by the Mojang/Microsoft approval and terms (BYNAME OD-N3; unverified until then). | |

G4 met: [ ] (date, initials)

## G5: CI and release readiness

Checklist step 7.

| Check | Result | Date |
|---|---|---|
| CI green on `main` (13.5), including the `mod` job | | |
| `pnpm build` and `pnpm check:lib` pass | | |
| Release binary size delta re-measured with the real endpoints (SPEC 3.1) | | |
| Doc-sync (SPEC 13.5, item 5): sections 3 to 9, 11 and Appendix A match the code | | |
| *Obsolete once the injection ships (`INGAME.md` section 8: no Modrinth project, M3 replaces it):* mod published on Modrinth, `MOD_PROJECT_ID` set in `mod-release.yml` and `modinstall.rs` (no gate; without it the mod install is unavailable) | | |
| Closed-beta decision recorded (checklist step 7): n0 relays, build route | | |

G5 met: [ ] (date, initials)

## N: finding friends by name (owner tests of `BYNAME.md` 10.4 and `BYNAME-ATTEST.md` 8.3)

Checklist step 8, with the exact commands. Order: O-1, O-2, O-3, then tag and release, then O-4 to O-8. Result is `pass` or
`fail`; put measured values and exact messages into the notes.

| # | Case | Pass criterion | Result | Date | Notes |
|---|---|---|---|---|---|
| O-1 | `cd directory && node test.mjs`; `node scripts/mojang-keys.mjs check` | Every case `ok`; "ok: 2 keys match" | | | |
| O-2 | `SELECT (SELECT COUNT(*) FROM users),(SELECT COUNT(*) FROM letters)` on the remote D1 returns `0, 0`; `npx wrangler d1 migrations apply pumpkin-friends-directory --remote` (0002); **then** `npx wrangler deploy`; `curl.exe -s -X POST https://pumpkin-friends-directory.jonas-laux.workers.dev/v1/auth/session -H "content-type: application/json" -d "{}"` | Count `0, 0`; migration 0002 applied before the deploy; curl prints `{"error":"gone"}` | | | |
| O-3 | Real login with a dev build (`$env:PUMPKIN_FRIENDS_DIRECTORY=...; npm run tauri:remote`), findable on, then `npx wrangler d1 execute pumpkin-friends-directory --remote --command "SELECT uuid FROM users"` | Status "Auffindbar als <name>" within 30 s; the query lists exactly your UUID. Proves the live private-key encoding, pinned key #0 and the L3 layout. On failure: note the launcher log line (code only) and stop the release | | | |
| O-4 | Two PCs, two accounts, 2.0.1: A sends to B by name while B's launcher is closed; B starts | B sees "Minecraft: <A's current name>" within 30 s of opening Friends; accepting makes both friends within 30 s | | | |
| O-5 | Running 1.20+ game on a real online server; restart the launcher so that a new certificate is fetched; wait until "Auffindbar"; chat again, stay 2 min | Chat works, no "chat validation error" kick. Records whether a certificate fetch affects a running game | | | |
| O-6 | Cloudflare dashboard › Workers › pumpkin-friends-directory › Metrics after O-3 and O-4 | CPU time p99 < 10 ms; subrequests 0 | | | |
| O-7 | A child or multiplayer-disabled account, if available | `notAllowed` shown, codes still work. Record the status codes of `/player/certificates` and `/player/attributes` and whether `multiplayerServer.enabled` is `false` | | | |
| O-8 | GitHub › Actions › "Mojang keys" › Run workflow; confirm the workflow is enabled | Green, and enabled (GitHub disables scheduled workflows after 60 days without activity; the `keepalive` job re-enables it) | | | |
| N4 | Decline, then A re-sends | A sees `nameCooldown`; B sees nothing | | | |
| N5 | Block A, A sends after the cooldown | A sees "gesendet", B's inbox stays empty | | | |
| N6 | Findable off | D1 rows gone at once; A's send → `nameNotFindable` | | | |
| N8 | Worker stopped, or wrong URL via env | By-name shows `directoryUnavailable`; presence, invites and a tunnel join keep working | | | |
| N9 | While Minecraft joins a real online server, accept a by-name request (the only remaining `join`) | Record whether the server join is affected | | | |

Facts that stay **unverified** until the rows above are filled (BYNAME-ATTEST, "Facts that stay unverified"):

| Fact | Settled by | Result | Date |
|---|---|---|---|
| The player certificate's lifetime is about 48 h (`refreshedAfter` about 40 h after issue) | Observation over more than two days after O-3 and O-4 | | |
| Which restricted accounts (banned, child, multiplayer-disabled) get 401/403 from `/player/certificates`, and what `/player/attributes` returns for them | O-7 | | |
| Fetching a certificate has no effect on a running game's chat key | O-5 | | |
| The live private-key encoding is PKCS#8 or PKCS#1 (both are accepted) and pinned key #0 signs today | O-3 | | |
| Using `/player/certificates` and `/player/attributes` from a third-party launcher is permitted by Mojang's terms | Owner (OD-N3) | | |
| Mojang publishes a new key in `/publickeys` before it signs with it | Daily "Mojang keys" workflow over time (O-8) | | |
| Production D1 holds no rows from 2.0.0 | O-2 | | |

| Decision | Result | Date |
|---|---|---|
| OD-N11: the owner accepts that the Worker no longer enforces Mojang's multiplayer restrictions and bans (the launcher checks `/player/attributes`; acceptance still needs a Mojang `join`) | | |

N met: [ ] (date, initials)

## M3: in-game mod (`INGAME.md` sections 2, 10 and Appendix B)

Status: **launcher side merged, smoke real and green for five of seven nodes** (2026-10-04, `INGAME-SMOKE.md`); the
owner pass and the release are pending. The smoke runs so far were local runs on the owner's Windows machine through
the launcher's own launch path (Cargo feature `smoke`, A18), not CI runs: the CI job `.github/workflows/mod-smoke.yml`
has never been executed. The owner steps are checklist step 9. A cell of the support matrix (`SPEC.md` 11.0) ships only
with its smoke entry (`verified.smoke` in `mod-index.json`, filled from `mod/verified.json`, A17); the owner entry
(`verified.owner`) is the Windows pass of the same release. Result is `pass` or `fail`; put the date, the launcher
version and exact messages into the notes.

### M3.1: node groups

The rows are the seven nodes that exist in `mod/nodes.txt` (matching `mod-index.json`). The other twelve nodes of
`INGAME-API.md` section 5 arrive with R-B and get their rows when they exist. Do not add a row for a cell that has no
node.

Smoke is the start through the launcher's own launch path with real injection: the mod connects, passes the owner check
and sends `ready` (`INGAME.md` section 10, layer 4). Owner pass (Windows) is the deep run for one node per loader and
the 3-step run (start, hub opens, one request answered) for every other node (layer 5).

| Node (Minecraft, loader) | Java | Stage | Smoke | Owner pass (Windows) |
|---|---|---|---|---|
| 26.3, Fabric | 25 | R-A | pass (2026-10-04, local smoke: bridge handshake, `ready` screens ["hub"], `INGAME-SMOKE.md` row 1) | |
| 1.21.1, Fabric | 21 | R-A | pass (2026-10-04, local smoke: obfuscated node, remapped jar + Mixin, `INGAME-SMOKE.md` row 1) | |
| 1.21.8, Fabric | 21 | R-A | pass (2026-10-04, local smoke: tracer line, `INGAME-SMOKE.md`) | |
| 1.21.11, Fabric | 21 | R-A | pass (2026-10-04, local smoke: tracer line, `INGAME-SMOKE.md`) | |
| 1.21.1, NeoForge | 21 | R-A | pass (2026-10-04, local smoke: `--fml.mavenRoots`, NeoForge 21.1.253, `INGAME-SMOKE.md` row 3) | |
| 26.2, NeoForge | 25 | R-A | pass (2026-10-04, local smoke: `-Dfml.modFolders`, NeoForge 26.2.0.88, `INGAME-SMOKE.md` row 4) | |
| 1.20.1, Forge | 17 | R-A | pass (2026-10-04, local smoke: `--fml.mavenRoots`, Forge 47.4.26, `INGAME-SMOKE.md` row 5) | |

Cross-cutting smoke results of the same runs (all five cells): non-ASCII data path `D:\pumpkin-build\smoke\Jürgen Müller\`
(ü + space) and the `FILE_SHARE_READ` handle in both scenarios (hold, release) passed (`INGAME-SMOKE.md` rows 6a and 6b).

Deep run per loader (owner pass, once per release, with two Microsoft accounts): start, open the hub, accept a request,
share a world and join it from the second account.

| Deep run | Node used | Result | Date | Notes |
|---|---|---|---|---|
| Fabric | | | | |
| NeoForge | | | | |
| Forge | | | | |

### M3.2: unproven mechanisms (`INGAME.md` Appendix B)

Settled by the spikes S0 to S2 and by the owner on Windows. Until a row has a result, the cell it concerns stays off
(`verified` empty in the index).

| # | Mechanism | Settled by | Result | Date | Notes |
|---|---|---|---|---|---|
| B1 | `-Dfabric.addMods` on Fabric 26.3 and on an obfuscated version: mod loads, Mixin applies, no `.fabric/processedMods` surprises | smoke (S2) | pass (local) | 2026-10-04 | 26.3-fabric (full mod) and 1.21.1-fabric (lowest obfuscated node today; a 1.20.1-fabric node does not exist yet), `INGAME-SMOKE.md` row 1 |
| B2 | Fabric duplicate mod id (user copy lower, equal, higher) | smoke (S2) | pass (local, equal case) | 2026-10-04 | `duplicate-id` scenario: the gate refuses beside a copy in `mods/` (`INGAME-SMOKE.md` row 2); lower/higher copies untried |
| B3 | NeoForge 21.1.x via `--fml.mavenRoots` (20.4 and 21.8 optional) | smoke (S2) | pass (local) | 2026-10-04 | 1.21.1-neoforge, NeoForge 21.1.253, `INGAME-SMOKE.md` row 3 |
| B4 | NeoForge 26.1.2.114 and 26.2.0.88 via `-Dfml.modFolders`; class-loading guard quiet | smoke (S2) | pass (local, 26.2 only) | 2026-10-04 | 26.2-neoforge, NeoForge 26.2.0.88, `INGAME-SMOKE.md` row 4; 26.1.2.114 has no node yet |
| B5 | Forge 1.20.1 (47.4.x) via `--fml.mavenRoots`; client-only display test | smoke (S2) | pass (local) | 2026-10-04 | 1.20.1-forge, Forge 47.4.26, `INGAME-SMOKE.md` row 5; the display test against a modded server stays open (B10) |
| B6 | Windows: non-ASCII data path (for example `C:\Users\Jürgen\...`); `FILE_SHARE_READ` handle held while the loaders read the jar | smoke (S2) | pass (local) | 2026-10-04 | `D:\pumpkin-build\smoke\Jürgen Müller\` (ü + space) and hold + release on all five cells, `INGAME-SMOKE.md` rows 6a/6b; a CJK path stayed silent and is not investigated |
| B7 | Headless start of 26.x clients under software rendering in CI | S2 (CI) | open | | the CI workflow never ran; the local smoke used the owner's GPU (`INGAME-SMOKE.md` section 5) |
| B8 | Stonecutter node naming with `-neoforge` and `-forge` suffixes and predicates | S1 | settled | 2026-10-04 | node id and Minecraft version are separate fields (`mod/README.md`) |
| B9 | Screen-init hook per loader (Fabric Mixin target `PauseScreen#init`, NeoForge and Forge screen-init event) on the tracer versions | smoke (S2) | partly | 2026-10-04 | Fabric Mixin proven by the 1.21.1-fabric tracer + mixin line; the button in a real pause menu is first seen by the owner pass |
| B10 | A client-only NeoForge or Forge mod against modded servers (only relevant if instances are also used on servers) | owner | open | | no server in the smoke |

Further checks the concept names (`INGAME.md` sections 3.8, 5.2, 5.4, 3.3). While any game link is active the launcher
never fetches a new player certificate (A16, `INGAME.md` 5.4): the directory loop, `friend.addByName` and `friends.retry`
all work cached-only and answer `directoryUnavailable` when the cache is empty or stale. The rule is unconditional and is
not lifted by owner test O-5 (section N above); O-5 only records whether a fetch would disturb a running game's chat key.

| Check | Result | Date |
|---|---|---|
| Circuit breaker: a deliberately broken node jar (wrong Java, bad `mods.toml`) ends in the dialog "Ohne Freunde-Menü starten" and the next launch starts without the mod | | |
| Wrapper script as Java: the instance row says "Verbindung nicht zuordenbar" and the game still starts | | |
| Second `pumpkin_friends` jar in `mods/`: injection is skipped and the instance row says why | | |

M3 met: [ ] (date, initials)
