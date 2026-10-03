# Lädt ein vollständiges Temurin-25-JDK von der Adoptium-API nach mod/.jdk (ohne Adminrechte) und setzt
# JAVA_HOME und PATH für diese PowerShell-Sitzung. Aufruf aus mod/: .\scripts\dev-env.ps1
# Mojangs Laufzeiten sind nur JREs ohne javac; deshalb immer ein eigenes JDK (SPEC 11.1).
$ErrorActionPreference = 'Stop'
# Ohne Fortschrittsbalken lädt Windows PowerShell 5.1 ein Vielfaches schneller.
$ProgressPreference = 'SilentlyContinue'

$JavaFeatureVersion = 25
$JdkDir = Join-Path (Split-Path -Parent $PSScriptRoot) '.jdk'

function Get-Architecture {
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'aarch64' } else { 'x64' }
}

function Get-TemurinPackage {
    $query = "architecture=$(Get-Architecture)&image_type=jdk&os=windows&vendor=eclipse"
    $assets = Invoke-RestMethod "https://api.adoptium.net/v3/assets/latest/$JavaFeatureVersion/hotspot?$query"
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

function Install-Jdk {
    $package = Get-TemurinPackage
    $staging = Join-Path ([IO.Path]::GetTempPath()) "pumpkin-jdk-$([guid]::NewGuid())"
    New-Item -ItemType Directory $staging | Out-Null
    try {
        $archive = Join-Path $staging $package.name
        Save-VerifiedArchive $package $archive
        Expand-Archive -Path $archive -DestinationPath $staging
        # Das Archiv enthält genau einen Ordner jdk-25…; er wird zu mod/.jdk.
        $extracted = Get-ChildItem -Directory $staging | Select-Object -First 1
        # Reste eines abgebrochenen Laufs (ohne javac) würden Move-Item verschachteln.
        if (Test-Path $JdkDir) { Remove-Item -Recurse -Force $JdkDir }
        Move-Item $extracted.FullName $JdkDir
    } finally {
        Remove-Item -Recurse -Force $staging
    }
    Write-Host "Temurin $($package.name) nach $JdkDir installiert (SHA-256 geprüft)."
}

if (-not (Test-Path (Join-Path $JdkDir 'bin\javac.exe'))) { Install-Jdk }
$env:JAVA_HOME = $JdkDir
$env:PATH = "$JdkDir\bin;$env:PATH"
Write-Host "JAVA_HOME=$JdkDir"
