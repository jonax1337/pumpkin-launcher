# p2p-spike: runbook for gate G1

This little program checks, before the Friends feature ships, whether two PCs in **different
networks** can reach each other the way the launcher will (iroh 1.3, dial by id, relay as
fallback). You run it on two Windows PCs, copy a few numbers into a table, and that is gate **G1**
(`docs/friends/SPEC.md`, section 1.3). Nothing here touches the launcher or your Minecraft files.

You need:

- two Windows PCs that are **not** in the same network (details per test below),
- someone at the second PC, or remote access to it,
- for the Minecraft test: Minecraft Java Edition on both PCs and **two different Microsoft
  accounts** (one per PC; the same account twice gets kicked),
- about 20 minutes per network pair.

## 1. Build the program (once, on the developer PC)

Open PowerShell in the repository folder and run:

```powershell
cd tools\p2p-spike
cargo build --release
```

The result is a single file: `tools\p2p-spike\target\release\p2p-spike.exe`. It needs no
installation and no extra runtime. Copy this file to a folder on **both** PCs, for example
`C:\spike` (USB stick, cloud drive or chat all work).

## 2. Open PowerShell in that folder (both PCs)

Open the folder `C:\spike` in Explorer, click into the address bar, type `powershell` and press
Enter. A blue or black window opens; all commands below are typed there. Every command starts
with `.\p2p-spike.exe`.

If Windows says the file is blocked: right-click `p2p-spike.exe` → *Properties* → tick
*Unblock* → *OK*.

## 3. Measure one network pair

We call the two PCs **A** (waits) and **B** (dials). It does not matter which is which.

**On PC A** run:

```powershell
.\p2p-spike.exe listen
```

The first time, Windows Firewall asks whether `p2p-spike.exe` may communicate. Tick **both**
"Private" and "Public" and click **Allow**. (If you click Cancel, the test still works, but
probably only through the relay; write that into the notes column.)

After a few seconds PC A shows something like this:

```text
Relay connected after 812 ms.
Home relay: https://euc1-1.relay.n0.iroh.link./
Public address seen by the relay: 203.0.113.7:61432

Your id: 3f9ac02177de01b4c3a7...(64 characters)
On the other PC run:
  .\p2p-spike.exe dial 3f9ac02177de01b4c3a7... --echo 1000 --throughput 50
Waiting for connections. Press Ctrl+C to stop.
```

Send the line after "On the other PC run:" to PC B (copy and paste, for example by chat or
e-mail). The id stays the same when you restart `listen` later in the same folder (it lives in
the file `spike-key.txt`), so you only send it once.

**On PC B** paste and run exactly that line:

```powershell
.\p2p-spike.exe dial 3f9ac02177de01b4c3a7... --echo 1000 --throughput 50
```

Allow the firewall prompt here too. The run takes about one minute and ends with a block like:

```text
=== RESULT (copy these lines into the G1 table) ===
path:           direct via 198.51.100.20:53211, rtt 24 ms
connect time:   412 ms
direct after:   1830 ms
echo p50 / p99: 23.9 / 41.2 ms (min 21.0, max 88.4)
throughput:     11.6 MiB/s
===================================================
```

What the lines mean:

| Line | Meaning | Good sign |
|---|---|---|
| `Relay connected after … ms` | This PC reached the relay server (the fallback). | appears within a few seconds |
| `WARNING: no relay reachable …` | The relay could not be reached at all. | should not appear; write it down |
| `Public address seen by the relay` | The internet address of this PC as the relay sees it (QUIC address discovery). `none reported` is normal with `--relay-only`. | an address appears |
| `path` | How the data flows at the end: `direct` (PC to PC) or `relay` (through the relay server). | `direct` (but `relay` also works) |
| `connect time` | Time from dialing until the connection stood. | below 2000 ms |
| `direct after` | How long it took to switch from relay to a direct path. `never` = it stayed on the relay for 15 s. `skipped` = you used `--relay-only`. | a number |
| `echo p50 / p99` | Round-trip time of a tiny message, typical (p50) and worst 1 % (p99). Minecraft feels fine below about 100 ms. | p99 below 150 ms |
| `throughput` | How fast 50 MiB went from B to A. | above 1 MiB/s |

PC A shows `connected`, the path lines and `disconnected` for each run; you do not need to copy
them. Leave PC A running for the next steps, or stop it with **Ctrl+C**.

## 4. Relay-only run

Repeat the dial on PC B with `--relay-only` added. This forces the relay path and is one required
table row (pair c):

```powershell
.\p2p-spike.exe dial 3f9ac02177de01b4c3a7... --relay-only --echo 1000 --throughput 50
```

## 5. Minecraft LAN world through the tunnel

This checks that a real vanilla LAN game works through the connection.

1. **PC A:** start Minecraft, open a singleplayer world, press **Esc** → **Open to LAN** →
   **Start LAN World**. The chat shows `Local game hosted on port 54321` (your number differs).
2. **PC A:** in PowerShell press **Ctrl+C** to stop the running `listen`, then start it again with
   that port:

   ```powershell
   .\p2p-spike.exe listen --forward 127.0.0.1:54321
   ```

3. **PC B:** run (the id from before, the port `25599` is fixed and only used on PC B):

   ```powershell
   .\p2p-spike.exe dial 3f9ac02177de01b4c3a7... --local 127.0.0.1:25599
   ```

   It prints the result block and then `Tunnel ready. In Minecraft: Multiplayer > Direct Connection > 127.0.0.1:25599`.
4. **PC B:** start Minecraft (the **same version** as PC A) → **Multiplayer** → **Direct
   Connection** → server address `127.0.0.1:25599` → **Join Server**.
5. **Pass** = PC B spawns in PC A's world and both players see each other. Walk around for a
   minute. Write `yes` into the "LAN join" column, otherwise `no` plus the error message.
6. Stop with **Ctrl+C** on both PCs.

If the 25599 port is taken, use any other number between 20000 and 60000 on PC B (in both the
command and the Minecraft address).

## 6. Which network pairs are needed (G1)

Run sections 3 to 5 for each pair. At least these three rows must exist:

| Pair | How to set it up |
|---|---|
| (a) | Two different home internet connections (for example your home and a friend's home), or home + office. |
| (b) | PC A at home, PC B on a **mobile hotspot**: turn on the hotspot on a phone and connect PC B's Wi-Fi to it (switch off PC B's cable/LAN). Mobile networks usually use CGNAT, the hard case. |
| (c) | Any pair from (a) or (b), dialed with `--relay-only` (section 4). |

More rows (other ISPs, VPN on, a university network) are welcome.

## 7. Write the numbers down

Open `docs/friends/VERIFICATION.md`, section **G1**, and add one row per run:

| Column | Take it from |
|---|---|
| Date | today |
| Pair | a, b or c (section 6) |
| PC A network / PC B network | what kind of connection, e.g. "Telekom DSL home", "Vodafone mobile hotspot" |
| Flags | `--relay-only` or empty |
| Path | the first word after `path:` (`direct` or `relay`) |
| Connect (ms) | `connect time` |
| Direct after (ms) | `direct after` (a number, `never` or `skipped`) |
| Echo p50 / p99 (ms) | the two numbers after `echo p50 / p99` |
| Throughput (MiB/s) | `throughput` |
| LAN join | `yes` / `no` from section 5 |
| Notes | firewall answer, anything odd |

Paste the full result block into the notes or below the table if in doubt; more detail is better.

## 8. When something goes wrong

| You see | What to do |
|---|---|
| `no answer within 8 s` on PC B | Is `listen` still running on PC A? Was the id copied completely (64 characters)? Run the dial again. |
| `WARNING: no relay reachable` | That PC cannot reach the relay server (blocked network, captive portal, proxy). Try another network and note it. |
| `direct after: never` | Normal behind strict routers or CGNAT; the relay still works. Note it in the row. |
| `cannot open 127.0.0.1:25599` | That port is busy; use another port (section 5). |
| `nothing answers on 127.0.0.1:54321` (on PC A) | The LAN world is not open or the port is wrong; check the chat message on PC A. |
| Minecraft: "Failed to log in" / "Invalid session" | Both PCs used the same Microsoft account, or the launcher session is stale; restart Minecraft. |
| Anything else | Run the same command again with `$env:RUST_LOG="info"` set first (`$env:RUST_LOG="info"; .\p2p-spike.exe dial …`) and keep the output. |

## 9. Privacy and safety

- Without `--relay` the program uses the **public relays of n0** (the company behind iroh). They see
  both PCs' IP addresses while the test runs. Only encrypted data passes through them.
- On a direct path the two PCs see each other's IP addresses (that is what "direct" means).
- While `listen --forward` runs, anyone who knows the id can reach the LAN world through it. Keep
  the id between the two of you and stop `listen` with **Ctrl+C** after the test.
- Delete `spike-key.txt` to get a new id.

## 10. Later: our own relay (input for G3)

Once our relay is deployed (work package D1), run the same tests with `--relay` on **both** PCs,
for example:

```powershell
.\p2p-spike.exe listen --relay https://relay-eu1.example.org/
.\p2p-spike.exe dial <id> --relay https://relay-eu1.example.org/ --echo 1000
```

`listen` prints the dial command including the `--relay` part. Record `Relay connected after …`
and the `Public address seen by the relay` line (that proves QUIC address discovery on UDP 7842
works) in VERIFICATION.md.

## For developers

- `cargo test` runs the learning tests (`tests/`): two endpoints in one process over loopback and
  through iroh's in-process test relay. They pin the iroh behaviour documented in
  `docs/friends/IROH-NOTES.md`.
- The crate is standalone (own `Cargo.lock`, own `target/`) and not part of CI.
- `.cargo/config.toml` links the C runtime statically so the exe runs on a PC without the
  Visual C++ redistributable.
