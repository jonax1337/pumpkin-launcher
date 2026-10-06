# Startet eine Zelle des Rauchtests der Mod im Spiel (tools/mod-smoke/README.md).
# Aufruf aus dem Repo-Stamm:
#   .\tools\mod-smoke\run.ps1 -Cell 26.3-fabric -Data D:\pumpkin-build\smoke\data
# Voraussetzung: der Gradle-Lauf `gradlew modIndex` in mod/ hat build/mod-index/ geschrieben (oder -Dist zeigt darauf).
# Der Cargo-Zielordner kommt aus CARGO_TARGET_DIR (nie auf E: legen, wenn dort wenig Platz ist).
param(
    [Parameter(Mandatory)][string]$Cell,
    # hold | release | wrong-jar:<Knoten> | spawn-java:<Pfad>
    [string]$Scenario = 'hold',
    [string]$Data = (Join-Path ([IO.Path]::GetTempPath()) 'pumpkin-smoke'),
    [string]$Dist,
    [string]$Out,
    [int]$TimeoutSecs = 240,
    [string]$LoaderVersion
)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$env:PUMPKIN_SMOKE_CELL = $Cell
$env:PUMPKIN_SMOKE_SCENARIO = $Scenario
$env:PUMPKIN_SMOKE_DATA = $Data
$env:PUMPKIN_SMOKE_TIMEOUT_SECS = $TimeoutSecs
if ($Dist) { $env:PUMPKIN_SMOKE_DIST = $Dist }
if ($Out) { $env:PUMPKIN_SMOKE_OUT = $Out }
if ($LoaderVersion) { $env:PUMPKIN_SMOKE_LOADER_VERSION = $LoaderVersion }

cargo test --manifest-path (Join-Path $Repo 'src-tauri/Cargo.toml') --locked --features smoke --test smoke smoke_cell -- --exact --nocapture
exit $LASTEXITCODE
