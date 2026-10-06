# P2P connection tool

Standalone developer CLI for iroh connections, path observations, latency, throughput and TCP forwarding between two machines. It does not modify launcher or Minecraft files. The crate has its own lockfile and is not part of the launcher workspace.

## Build and connect

Building requires Rust stable/Cargo; on Windows use the MSVC toolchain and C++ Build Tools
described in [development setup](../../CONTRIBUTING.md#development-setup). WebView2 is not
needed for this standalone CLI. Run the following from the repository root:

```powershell
cd tools\p2p-spike
cargo build --release
```

The binary is `target/release/p2p-spike.exe`. For local use in the same terminal, run
`cd target\release` before the commands below. For another machine, copy that executable
and open a terminal in its destination directory. The Windows build links the C runtime
statically, so no Visual C++ redistributable is needed.

On the listening machine:

```powershell
.\p2p-spike.exe listen
```

It prints its id and a ready-to-use dial command. On the other machine:

```powershell
.\p2p-spike.exe dial <id> --echo 1000 --throughput 50
```

For a POSIX shell (Linux/macOS), build from the repository root:

```sh
cd tools/p2p-spike
cargo build --release
```

From that crate directory, run `./target/release/p2p-spike listen` on the listening
machine; on the dialing machine, use:

```sh
./target/release/p2p-spike dial <id> --echo 1000 --throughput 50
```

If copying a binary to another machine, use a build for that machine's OS/architecture
and run `./p2p-spike` from its destination directory. The arguments in the remaining
examples are identical; only the executable path changes. These invocation examples
do not establish tested cross-platform networking.

`id` prints the local identity. The key is stored in `spike-key.txt` in the working directory and persists across runs. `Ctrl+C` stops a listener or tunnel.

## Options and output

| Option | Purpose |
|---|---|
| `--echo <rounds>` | Measure one-byte round trips |
| `--throughput <MiB>` | Measure upload throughput |
| `--relay-only` | Disable direct connections |
| `--relay <URL>` | Replace n0's public relays; repeatable and used on both machines |
| `listen --forward <address>` | Forward incoming streams to a TCP destination |
| `dial <id> --local <address>` | Expose the remote destination at a local TCP address |

Output includes relay connection time, relay-observed public address, selected direct/relay path, dial time, time until a direct path, echo p50/p99 and throughput. `direct after: never` can be normal behind strict NAT; `skipped` means relay-only mode. `none reported` for the public address is normal in relay-only mode.

## Minecraft LAN forwarding

With a world opened to LAN on the host, use its announced port:

```powershell
.\p2p-spike.exe listen --forward 127.0.0.1:54321
```

On the guest:

```powershell
.\p2p-spike.exe dial <id> --local 127.0.0.1:25599
```

Minecraft's Direct Connection address is then `127.0.0.1:25599`. Both games need the same Minecraft version and different Microsoft accounts. The ports are examples; a busy local port can be replaced in both the command and game address.

## Troubleshooting and privacy

A dial timeout can mean the listener is stopped, the id is wrong or the network blocks connectivity. `WARNING: no relay reachable` indicates blocked relay access. An occupied local port needs a different binding. A failed connection to the host's LAN port can mean the world is not open to LAN. `RUST_LOG=info` enables tracing.

Default n0 relays see both machines' IP addresses; traffic is encrypted. Direct peers see each other's IP addresses. While forwarding is active, anyone knowing the listener id can reach its TCP destination, so share the id privately and stop the listener when no longer needed. Removing `spike-key.txt` creates a new identity on the next run.

`cargo test` provides loopback and in-process relay fixtures. Relay deployment is documented in [RELAY-OPS.md](../../docs/friends/RELAY-OPS.md).
