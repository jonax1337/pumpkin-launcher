# mc-api-probe

Prints the **exact method and field descriptors** of Minecraft classes with **Mojang names**, per Minecraft version, and
turns them into the evidence tables of `docs/friends/INGAME-API.md` (spike S0 of `docs/friends/INGAME.md`).

Node.js 20+ and a JDK (for `javap`) are needed. No packages, no build step, nothing is installed. A JDK 25 reads the
class files of every probed version (the 26.x client jars are Java 25 class files); the `javap` of an older JDK cannot.

## One run

```
export MC_API_PROBE_CACHE=D:/pumpkin-build/scratch/S0/cache      # downloads go here, outside the repo
export MC_API_PROBE_JAVA_HOME=D:/pumpkin-build/jdk/25            # or JAVA_HOME, or --java-home
node tools/mc-api-probe/cli.mjs probe --version 1.21.1 'PauseScreen#init' 'Screen#render' 'Button#builder'
node tools/mc-api-probe/cli.mjs probe --version 26.3   'PauseScreen#init' 'Screen#extractRenderState'
```

The first run for a version downloads `client.jar` and the official Mojang mapping file from Mojang's version manifest
(SHA-1 checked). Versions from 26.1 on are unobfuscated and have no mapping file. `Class#member` takes a fully qualified
class or the end of its name (`Screen`, `Button.Builder`); `<init>` selects the constructors. Members are resolved
through the class hierarchy, so an inherited method is reported with the class that declares it. The output shows
`descriptor` (JVM descriptor with Mojang class names) and `declaredIn` for every overload.

## Commands

| Command | Purpose |
|---|---|
| `releases` | release ids of the Mojang manifest |
| `fetch <id>...` | download jar and mappings into the cache |
| `probe --version <id> (--members <file> \| Class#member...)` | descriptors of the listed members (`--format json` for machines) |
| `list --version <id> <Class>` | every member the class declares |
| `find --version <id> <regex>` | classes by Mojang name |
| `code --version <id> Class#method [--grep regex]` | what a vanilla method calls (`javap -c`, Mojang names, `*` wildcard, `lambda$...` allowed) |
| `collect <id>...` | probe `members/ingame.txt` and write `results/<id>.json` |
| `report [--doc file]` | era tables, breaking changes, node list from `results/` and `nodes.json`; with `--doc` it replaces the regions between `<!-- name:begin -->` and `<!-- name:end -->` |
| `check-nodes` | every Minecraft id of `nodes.json` against the Mojang manifest (release, no gaps, `javaMin`, no duplicates) |
| `intermediary [--spec Class#member] <id>...` | Fabric intermediary names (what a Mixin must target at runtime on obfuscated versions) |
| `neoforge-hooks <version>...`, `forge-hooks <version>...`, `fabric-floor <id>...` | loader evidence from the Maven repositories |

## Regenerating the document tables

```
node tools/mc-api-probe/cli.mjs collect 1.20 1.20.1 ... 26.3          # about 15 s per version
node tools/mc-api-probe/cli.mjs report --doc docs/friends/INGAME-API.md
node tools/mc-api-probe/cli.mjs check-nodes
```

`members/ingame.txt` is the list of members the compat layer needs. A line ending in `@used` marks a member the mod
calls or overrides; only those decide where a **breaking change** (a node boundary) is. Everything else is context.

## Tests

```
cd tools/mc-api-probe && node --test
```

The tests use small fixtures (Proguard text, `javap` output, a hand-built zip) and need neither network nor JDK.

## What is stored in the repository

`results/<id>.json` holds the resolved descriptors per version (about 60 KB each). Jars and mapping files are never
committed; they live in `MC_API_PROBE_CACHE`.
