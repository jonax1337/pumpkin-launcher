[CmdletBinding()]
param(
    [string]$NsisSdkPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $NsisSdkPath) {
    $roots = @(
        $env:NSISDIR,
        (Join-Path $env:LOCALAPPDATA 'tauri\NSIS'),
        (Join-Path ${env:ProgramFiles(x86)} 'NSIS'),
        (Join-Path $env:ProgramFiles 'NSIS')
    ) | Where-Object { $_ }
    foreach ($root in $roots) {
        $candidate = Join-Path $root 'Examples\Plugin\nsis'
        if (Test-Path -LiteralPath (Join-Path $candidate 'pluginapi.h')) {
            $NsisSdkPath = $candidate
            break
        }
    }
}
if (-not $NsisSdkPath -or -not (Test-Path -LiteralPath (Join-Path $NsisSdkPath 'pluginapi.h'))) {
    throw 'NSIS Unicode SDK not found. Pass -NsisSdkPath <NSIS\Examples\Plugin\nsis>.'
}
$NsisSdkPath = (Resolve-Path -LiteralPath $NsisSdkPath).Path

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
    throw 'Install Visual Studio Build Tools with Desktop development with C++ and a Windows 11 SDK.'
}
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $installation) {
    throw 'No Visual Studio installation containing the MSVC x86/x64 compiler was found.'
}
$vcvars = Join-Path $installation 'VC\Auxiliary\Build\vcvarsall.bat'
if (-not (Test-Path -LiteralPath $vcvars)) {
    throw "MSVC environment script not found: $vcvars"
}

$source = Join-Path $PSScriptRoot 'PumpkinTheme.cpp'
$output = Join-Path $PSScriptRoot 'PumpkinTheme.dll'
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ('PumpkinTheme-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    # Only SDK headers are used; no NSIS pluginapi library or third-party runtime is linked.
    # Fonts and OFL notices are embedded; normal app builds need no font conversion tools.
    $object = Join-Path $temporary 'PumpkinTheme.obj'
    $library = Join-Path $temporary 'PumpkinTheme.lib'
    $resource = Join-Path $temporary 'PumpkinTheme.res'
    $resourceSource = Join-Path $PSScriptRoot 'PumpkinTheme.rc'
    $arguments = @(
        '/nologo', '/LD', '/std:c++17', '/O2', '/W4', '/WX', '/EHsc', '/MT',
        '/DUNICODE', '/D_UNICODE', '/D_WIN32_WINNT=0x0601',
        "/I`"$NsisSdkPath`"", "/Fo`"$object`"", "`"$source`"", "`"$resource`"",
        '/link', '/MACHINE:X86', '/INCREMENTAL:NO', '/Brepro', '/DYNAMICBASE', '/NXCOMPAT',
        "/OUT:`"$output`"", "/IMPLIB:`"$library`"",
        'user32.lib', 'gdi32.lib', 'comctl32.lib', 'uxtheme.lib', 'dwmapi.lib'
    )
    $command = "call `"$vcvars`" x86 && rc.exe /nologo /i `"$PSScriptRoot`" /fo `"$resource`" `"$resourceSource`" && cl.exe $($arguments -join ' ')"
    # Pass cmd's command line verbatim, without Windows PowerShell's native-argument quote rewriting.
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $env:ComSpec
    $startInfo.Arguments = "/d /s /c `"$command`""
    $startInfo.UseShellExecute = $false
    $buildProcess = [System.Diagnostics.Process]::Start($startInfo)
    try {
        # Wait only for cmd, not persistent compiler-server descendants.
        $buildProcess.WaitForExit()
        $buildExitCode = $buildProcess.ExitCode
    } finally {
        $buildProcess.Dispose()
    }
    if ($buildExitCode -ne 0) {
        throw "PumpkinTheme x86 build failed with exit code $buildExitCode."
    }
    Write-Output "Built $output (x86 Unicode, static MSVC runtime)."
} finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force
}
