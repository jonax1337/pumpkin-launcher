# Pumpkin Friends: verification record

Results for the release gates of `SPEC.md` section 1.3. The owner fills this in; agents only
prepare the tables. A gate is met when every required row is filled and passes.

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
first. Result is `pass` or `fail`; put measured times and exact messages into the notes.

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

G2 met: [ ] (date, initials)
