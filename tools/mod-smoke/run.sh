#!/usr/bin/env sh
# Starts one cell of the in-game mod smoke test (tools/mod-smoke/README.md).
# Usage, from anywhere:  PUMPKIN_SMOKE_DATA=/path/to/data tools/mod-smoke/run.sh <cell> [scenario]
# Needs mod/build/mod-index/ from `gradlew modIndex` (or PUMPKIN_SMOKE_DIST). The scenario is one of
# hold (default) | release | wrong-jar:<node> | spawn-java:<path>. Further variables: README.md in this folder.
set -eu

cell="${1:?usage: run.sh <cell> [scenario]}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"

export PUMPKIN_SMOKE_CELL="$cell"
export PUMPKIN_SMOKE_SCENARIO="${2:-hold}"
export PUMPKIN_SMOKE_DATA="${PUMPKIN_SMOKE_DATA:-${TMPDIR:-/tmp}/pumpkin-smoke}"

exec cargo test --manifest-path "$repo/src-tauri/Cargo.toml" --locked --features smoke --test smoke smoke_cell -- --exact --nocapture
