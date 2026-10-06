# mc-api-probe

Inspect exact Minecraft method and field descriptors using Mojang names. Stored results support compatibility work without keeping game JARs in the repository.

Requires Node.js 20+ and a JDK providing `javap`; JDK 25 can read all supported class-file versions, including 26.x. No packages or build step are needed.

## Usage

Run from the repository root:

```sh
export MC_API_PROBE_CACHE=/path/outside/repo/mc-api-cache
export MC_API_PROBE_JAVA_HOME=/path/to/jdk25
node tools/mc-api-probe/cli.mjs probe --version 1.21.1 'PauseScreen#init' 'Button#builder'
node tools/mc-api-probe/cli.mjs collect 1.21.1
node tools/mc-api-probe/cli.mjs report
```

`--cache` overrides `MC_API_PROBE_CACHE`; when neither is set, the cache is
`<OS temporary directory>/mc-api-probe-cache`. `--java-home` overrides
`MC_API_PROBE_JAVA_HOME`, then `JAVA_HOME`. Downloads use Mojang's manifest and verify SHA-1.
From 26.1, clients are unobfuscated and have no mapping file.

`probe` prints an ad hoc result (or writes the file selected by `--out`); it does not
populate `results/`. `collect` writes persistent `tools/mc-api-probe/results/<id>.json`
using the member specification. `report` reads those collected JSON files, not the previous
probe's stdout. It prints a report unless `--doc` is supplied; it may refresh the cached
release manifest but does not recollect descriptors. Use the same `--out <directory>` for
`collect` and `report` when keeping persistent results elsewhere.

`Class#member` accepts a fully qualified class or a short suffix such as `Button.Builder`; `<init>` selects constructors. Inherited methods report their declaring class. JSON output includes `descriptor` and `declaredIn` for every overload.

## Commands

| Command | Purpose |
|---|---|
| `releases` | List release ids from Mojang's manifest |
| `fetch <id>...` | Cache client JARs and mappings |
| `probe --version <id> (--members <file> \| Class#member...)` | Inspect members; `--format json` selects JSON |
| `list --version <id> <Class>` | List declared members |
| `find --version <id> <regex>` | Find classes by Mojang name |
| `code --version <id> Class#method [--grep regex]` | Inspect bytecode calls with Mojang names |
| `collect <id>...` | Resolve `members/ingame.txt` into `results/<id>.json` |
| `report` | Print version tables, member tables, breakpoints and probe node data |
| `check-nodes` | Compare the tool's `nodes.json` with Mojang's release manifest |
| `intermediary [--spec Class#member] <id>...` | Resolve Fabric runtime names |
| `neoforge-hooks <version>...`, `forge-hooks <version>...`, `fabric-floor <id>...` | Inspect loader evidence from Maven |

`members/ingame.txt` marks directly used members with `@used`; those determine breaking-change boundaries. `results/` contains resolved descriptors, not game binaries. The probe's `nodes.json` is report input; the actual Bridge build targets are defined in [`mod/nodes.txt`](../../mod/nodes.txt).

## Optional document output

`report --doc <file>` updates an existing Markdown document only when it contains all four matching marker pairs: `versions`, `probe-tables`, `breakpoints` and `nodes`, each written as `<!-- name:begin -->` and `<!-- name:end -->`. It has no default document path and does not create a missing document. Use plain `report` for output without a Markdown dependency. `report --out <directory>` reads collected JSON from that directory.

To regenerate the [Minecraft API reference](../../docs/bridge/MINECRAFT-API.md), run `node tools/mc-api-probe/cli.mjs report --doc docs/bridge/MINECRAFT-API.md` from the repository root.

The offline fixture suite is available with `node --test` from this folder; it needs neither a network connection nor a JDK.
