# Richtet die JDKs für einen Knoten ein: lädt vollständige Temurin-JDKs von der Adoptium-API nach mod/.jdk/<Version>
# (ohne Adminrechte) und setzt JAVA_HOME (das JDK für Gradle) sowie PUMPKIN_JDK_<Version> (die JDKs, die Gradle als
# Toolchain findet), alles für diese PowerShell-Sitzung. Aufruf aus mod/: .\scripts\dev-env.ps1 [-Node <Knoten-Id>]
# Standard ist der erste Knoten in nodes.txt. Welches JDK ein Knoten braucht, steht in nodes.txt (Spalte java);
# das JDK, auf dem Gradle selbst läuft, in Spalte gradleJdk (Stonecutter verlangt Java 21, Fabric Loom Java 25).
# Bereits gesetzte PUMPKIN_JDK_<Version> werden nicht neu geladen. Mojangs Laufzeiten sind nur JREs ohne javac;
# deshalb immer eigene JDKs (SPEC 11.1).
param([string]$Node)
$ErrorActionPreference = 'Stop'
# Ohne Fortschrittsbalken lädt Windows PowerShell 5.1 ein Vielfaches schneller.
$ProgressPreference = 'SilentlyContinue'

$ModDir = Split-Path -Parent $PSScriptRoot

function Get-Architecture {
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'aarch64' } else { 'x64' }
}

# nodes.txt: Spalte 1 Id, Spalte 5 java, Spalte 7 gradleJdk. Kommentare und Leerzeilen entfallen.
function Get-Nodes {
    Get-Content (Join-Path $ModDir 'nodes.txt') |
        ForEach-Object { ($_ -replace '#.*', '').Trim() } |
        Where-Object { $_ } |
        ForEach-Object {
            $columns = $_ -split '\s+'
            [pscustomobject]@{ Id = $columns[0]; Java = [int]$columns[4]; GradleJdk = [int]$columns[6] }
        }
}

function Get-TemurinPackage($FeatureVersion) {
    $query = "architecture=$(Get-Architecture)&image_type=jdk&os=windows&vendor=eclipse"
    $assets = Invoke-RestMethod "https://api.adoptium.net/v3/assets/latest/$FeatureVersion/hotspot?$query"
    $package = @($assets)[0].binary.package
    if ($package.checksum -notmatch '^[0-9a-f]{64}$') { throw "Adoptium-API lieferte keine SHA-256-Prüfsumme." }
    $package
}

function Save-VerifiedArchive($package, $target) {
    Invoke-WebRequest -Uri $package.link -OutFile $target -UseBasicParsing
    $actual = (Get-FileHash -Algorithm SHA256 $target).Hash.ToLowerInvariant()
    if ($actual -ne $package.checksum) {
        Remove-Item $target
        throw "Prüfsumme von $($package.name) stimmt nicht: erwartet $($package.checksum), erhalten $actual."
    }
}

function Install-Jdk($FeatureVersion, $JdkDir) {
    $package = Get-TemurinPackage $FeatureVersion
    $staging = Join-Path ([IO.Path]::GetTempPath()) "pumpkin-jdk-$([guid]::NewGuid())"
    New-Item -ItemType Directory $staging | Out-Null
    try {
        $archive = Join-Path $staging $package.name
        Save-VerifiedArchive $package $archive
        Expand-Archive -Path $archive -DestinationPath $staging
        # Das Archiv enthält genau einen Ordner jdk-<Version>…; er wird zu mod/.jdk/<Version>.
        $extracted = Get-ChildItem -Directory $staging | Select-Object -First 1
        # Reste eines abgebrochenen Laufs (ohne javac) würden Move-Item verschachteln.
        if (Test-Path $JdkDir) { Remove-Item -Recurse -Force $JdkDir }
        New-Item -ItemType Directory (Split-Path -Parent $JdkDir) -Force | Out-Null
        Move-Item $extracted.FullName $JdkDir
    } finally {
        Remove-Item -Recurse -Force $staging
    }
    Write-Host "Temurin $($package.name) nach $JdkDir installiert (SHA-256 geprüft)."
}

# JAVA_HOME des JDKs der Version: ein gesetztes PUMPKIN_JDK_<Version> oder das geladene mod/.jdk/<Version>.
function Get-JdkHome($FeatureVersion) {
    $preset = [Environment]::GetEnvironmentVariable("PUMPKIN_JDK_$FeatureVersion")
    if ($preset) { return $preset }
    $jdkDir = Join-Path $ModDir ".jdk\$FeatureVersion"
    if (-not (Test-Path (Join-Path $jdkDir 'bin\javac.exe'))) { Install-Jdk $FeatureVersion $jdkDir }
    $jdkDir
}

$nodes = @(Get-Nodes)
if (-not $Node) { $Node = if ($env:PUMPKIN_NODE) { $env:PUMPKIN_NODE } else { $nodes[0].Id } }
$selected = $nodes | Where-Object { $_.Id -eq $Node }
if (-not $selected) { throw "Unbekannter Knoten: $Node (siehe nodes.txt)" }

$gameJava = $selected.Java
$gradleJava = $selected.GradleJdk
foreach ($featureVersion in ($gameJava, $gradleJava | Select-Object -Unique)) {
    [Environment]::SetEnvironmentVariable("PUMPKIN_JDK_$featureVersion", (Get-JdkHome $featureVersion))
}
$env:JAVA_HOME = [Environment]::GetEnvironmentVariable("PUMPKIN_JDK_$gradleJava")
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
Write-Host "Knoten ${Node}: JDK $gameJava für das Spiel, JAVA_HOME=$env:JAVA_HOME (JDK $gradleJava für Gradle)"
