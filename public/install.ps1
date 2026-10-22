# unown installer for Windows - the one-line bootstrap (PowerShell).
#
#   irm https://unown-nine.vercel.app/install.ps1 | iex
#   irm https://unown-nine.vercel.app/install.ps1 -OutFile install.ps1
#   .\install.ps1 -Source          # full stack (source checkout)
#   .\install.ps1 -Main            # source install at the edge branch
#
# Two modes:
#
#   default (standalone binary) - downloads the windows-x64 (or windows-arm64
#     with -Experimental) release archive, verifies its SHA-256 against the SAME
#     release's sha256sums.txt, and installs the CLI atomically under
#     ${env:UNOWN_INSTALL_ROOT} (default %LOCALAPPDATA%\unown)\versions\
#     <version>\ with PATH shims and %USERPROFILE%\.unown\install.json
#     metadata. No git and no bun are required. The binary is the CLI only -
#     the engine and learning stack need -Source.
#
#   -Source - checks git, checks/installs bun (bun's own PowerShell installer),
#     clones the newest STABLE release tag (vX.Y.Z, no prerelease suffix), and
#     runs the repo's own installer (bun run agent:install) which builds the
#     full stack and puts `unown` on your PATH (%USERPROFILE%\.local\bin\
#     unown.cmd + unown.ps1). -Main is an explicit edge install of the main
#     branch; -Version vX.Y.Z pins a tag. -Main and -Dest imply -Source;
#     -Binary remains accepted as an explicit spelling of the default.
#
# Release assets come from https://github.com/kanishka-namdeo/Unown/releases
# (override the base with UNOWN_RELEASES_BASE_URL). Latest is fetched from
# <base>/latest/download/<name>; a pin from <base>/download/v<version>/<name>.
#
# irm|iex mitigations implemented here (the standard set):
#   - param + [CmdletBinding()] parsing runs BEFORE anything executes; the
#     script body is one main function invoked at the END, so a truncated
#     download cannot execute half of itself
#   - $ErrorActionPreference = 'Stop': fail fast, no half-installs
#   - refuses to run as Administrator
#   - -Version / -Dest / -Main / -Binary / -Force / -Experimental /
#     -NoModifyPath parameters; -Help; ASCII output; CRLF-safe
#   - review-before-running works too:
#       irm https://unown-nine.vercel.app/install.ps1 -OutFile install.ps1
#       Get-Content .\install.ps1   # review it
#       .\install.ps1
#   - source integrity: the clone comes over HTTPS from GitHub; release tags
#     carry SLSA build-provenance attestations on the GitHub Release
#
# The script is served from the repo's Vercel deployment (public/install.ps1
# in the repository - https://github.com/kanishka-namdeo/Unown).

[CmdletBinding()]
param(
  [string]$Version = "",
  [string]$Dest = "Unown",
  [switch]$Main,
  [switch]$Source,
  [switch]$Binary,
  [switch]$Force,
  [switch]$Experimental,
  [switch]$NoModifyPath,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'
$Repo = 'https://github.com/kanishka-namdeo/Unown.git'
$ReleasesBaseDefault = 'https://github.com/kanishka-namdeo/Unown/releases'

# $PSBoundParameters is function-scoped inside Main; capture script-level binding
# now so -Dest can be rejected together with -Binary and can imply -Source.
$script:DestBound = $PSBoundParameters.ContainsKey('Dest')

$script:RequestedVersion = ''
$script:ExistingMode = ''
$script:ExistingVersion = ''
$script:ExistingShim = ''
$script:ExistingPrev = ''

function Show-Usage {
  Write-Host @'
unown installer (Windows)

  .\install.ps1 [-Version vX.Y.Z] [-Force] [-Experimental] [-NoModifyPath]
  .\install.ps1 -Source [-Version vX.Y.Z] [-Dest DIR] [-Main] [-Force]

  default        standalone CLI binary: verified release download, no git/bun
  -Source        full stack: clone a stable release tag and run
                 bun run agent:install (needs git + bun)
  -Main          source install from the main branch (edge) instead of a tag
  -Binary        explicit spelling of the default binary install
  -Version       pin a release (vX.Y.Z or X.Y.Z)
  -Dest          source clone directory (default: .\Unown; not valid with binary)
  -Force         replace an install recorded in the other mode
  -Experimental  allow windows-arm64 (no CI runtime smoke)
  -NoModifyPath  do not append the shim directory to the user PATH (binary mode)
  -Help          this help

Version policy: without -Version the default binary mode installs the release
marked "latest"; -Source picks the newest stable vX.Y.Z tag. Prerelease tags
are never picked implicitly.

Existing installs: a bare run installs the binary. If install.json records a
source checkout, re-run with -Source to update it (or -Force to replace it).

After install: unown setup   (connect a model)
              unown doctor   (verify)
              unown update   (stay current)

NOTE: `irm ... | iex` runs with the parameters above at their defaults; to
use a flag, download the script first and run it (review-before-running).
'@
}

function Fail([string]$Message) {
  throw "install.ps1: $Message"
}

function Normalize-Version([string]$Value) {
  $text = $Value.Trim()
  if ($text.StartsWith('v') -or $text.StartsWith('V')) {
    $text = $text.Substring(1)
  }
  if ($text -notmatch '^\d+\.\d+\.\d+$') {
    Fail "invalid -Version '$Value': expected a stable release like v0.0.2 (no prerelease suffix)"
  }
  return $text
}

function Get-Platform {
  $arch = ''
  try {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  } catch {
    $arch = ''
  }
  if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
  if ($arch -eq 'x86' -and $env:PROCESSOR_ARCHITEW6432) {
    $arch = $env:PROCESSOR_ARCHITEW6432
  }
  switch ($arch.ToUpperInvariant()) {
    'AMD64' { return 'windows-x64' }
    'X64' { return 'windows-x64' }
    'ARM64' { return 'windows-arm64' }
    default { Fail "unsupported Windows architecture '$arch' (release assets: windows-x64, windows-arm64)" }
  }
}

function Resolve-LatestTag {
  Write-Host 'install.ps1: resolving the newest stable release tag...'
  $lines = & git ls-remote --tags --refs --sort=-v:refname $Repo 'v*'
  if ($LASTEXITCODE -ne 0) {
    Fail "could not list release tags from $Repo (git exited $LASTEXITCODE)"
  }
  foreach ($line in $lines) {
    if ($line -match 'refs/tags/(v\d+\.\d+\.\d+)$') {
      return $Matches[1]
    }
  }
  Fail "no stable release tags (vX.Y.Z) found in $Repo. Re-run with -Main to install the edge branch, or -Version vX.Y.Z to pin one."
}

function Assert-TagVersion([string]$Checkout, [string]$Tag) {
  $want = $Tag.Substring(1)
  $got = ''
  try {
    $pkg = Get-Content -Raw -LiteralPath (Join-Path $Checkout 'package.json') | ConvertFrom-Json
    $got = [string]$pkg.version
  } catch {
    Fail "could not read package.json in $Checkout ($($_.Exception.Message))"
  }
  if ($got -ne $want) {
    Fail "release tag $Tag does not match its package.json version (got '$got'). Refusing a half-pushed release. Remove $Checkout and re-run with -Main, or pick another -Version."
  }
}

function Test-ShimOurs([string]$Path, [string]$Root) {
  if (-not (Test-Path -LiteralPath $Path)) { return $true }
  $text = Get-Content -Raw -LiteralPath $Path
  return ($text -match 'UNOWN_INSTALL_ROOT' -and $text.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0)
}

function Invoke-ReleaseDownload([string]$Url, [string]$OutFile) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile
  } catch {
    Fail "download failed: $Url ($($_.Exception.Message)). Check network access to the release host; UNOWN_RELEASES_BASE_URL overrides the base."
  }
}

function Install-Source {
  # git
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Fail 'git is required for the -Source install (https://git-scm.com - the standard Git-for-Windows install is fine). Use the default binary install (no git), or install git and re-run with -Source.'
  }

  # bun (bootstrap via bun's own PowerShell installer when missing)
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host 'install.ps1: bun not found - installing it (https://bun.sh)'
    irm bun.sh/install.ps1 | iex
    # bun lands in %USERPROFILE%\.bun\bin; make it visible for THIS script
    $bunBin = Join-Path $env:USERPROFILE '.bun\bin'
    if ((Test-Path -LiteralPath $bunBin) -and ($env:PATH -notlike "*$bunBin*")) {
      $env:PATH = "$bunBin;$env:PATH"
    }
    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
      Fail 'bun install failed - install it manually (irm bun.sh/install.ps1 | iex), then re-run'
    }
  }

  # clone
  if (Test-Path -LiteralPath $Dest) {
    Fail "$Dest already exists - remove it or pass -Dest DIR"
  }

  if ($Main) {
    Write-Host "install.ps1: cloning Unown (main - edge) into .\$Dest"
    & git clone --quiet $Repo $Dest
    if ($LASTEXITCODE -ne 0) {
      Fail "git clone failed (exit $LASTEXITCODE). Remove $Dest if a partial checkout was left behind, then retry."
    }
  } else {
    $tag = ''
    if ($script:RequestedVersion) {
      $tag = 'v' + $script:RequestedVersion
    } else {
      $tag = Resolve-LatestTag
    }
    Write-Host "install.ps1: cloning Unown at $tag (stable release) into .\$Dest"
    & git clone --quiet --branch $tag $Repo $Dest
    if ($LASTEXITCODE -ne 0) {
      Fail "git clone of $tag failed (exit $LASTEXITCODE). If that tag does not exist, run without -Version for the newest stable release (or -Main for the edge branch). Remove $Dest if a partial checkout was left behind."
    }
    Assert-TagVersion $Dest $tag
  }

  $checkout = (Resolve-Path -LiteralPath $Dest).Path

  # install (deps + pi build + .env + PATH shims) - UNOWN_NO_LINK is 0 by
  # default; scripts/link.ts writes the .cmd/.ps1 shims and appends the user
  # PATH via the registry (never setx).
  $installed = ''
  Push-Location -LiteralPath $checkout
  try {
    & bun run agent:install
    if ($LASTEXITCODE -ne 0) {
      Fail "agent:install failed (exit $LASTEXITCODE)"
    }
    $installed = (& bun bin/unown --version 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0) { $installed = '' }
  } finally {
    Pop-Location
  }

  if (-not $installed) {
    try {
      $pkg = Get-Content -Raw -LiteralPath (Join-Path $checkout 'package.json') | ConvertFrom-Json
      $installed = [string]$pkg.version
    } catch {
      $installed = ''
    }
  }
  if (-not $installed) { $installed = 'unknown' }
  $installed = ([string]$installed).Trim()

  $shim = ''
  $shimCandidates = @()
  if ($env:UNOWN_BIN_DIR) {
    $shimCandidates += (Join-Path $env:UNOWN_BIN_DIR 'unown.cmd')
    $shimCandidates += (Join-Path $env:UNOWN_BIN_DIR 'unown.ps1')
  }
  $shimCandidates += (Join-Path $HOME '.local\bin\unown.cmd')
  $shimCandidates += (Join-Path $HOME '.local\bin\unown.ps1')
  foreach ($candidate in $shimCandidates) {
    if (Test-Path -LiteralPath $candidate) {
      $shim = $candidate
      break
    }
  }
  if (-not $shim) { $shim = 'not found yet - run: bun run agent:link' }

  Write-Host ''
  Write-Host "unown $installed installed (checkout)"
  Write-Host "  checkout: $checkout"
  Write-Host "  shim:     $shim"
  Write-Host ''
  Write-Host 'next steps:'
  Write-Host ('  cd "' + $checkout + '"; unown setup     # connect a model provider')
  Write-Host '  unown doctor                  # verify the chat path end to end'
  Write-Host '  unown update                  # stay current (self-update)'
  Write-Host ''
  Write-Host 'Windows note: if the PATH was just updated, restart your terminal;'
  Write-Host 'PowerShell may need "Set-ExecutionPolicy -Scope CurrentUser RemoteSigned" once for the .ps1 shim.'
  Write-Host 'uninstall anytime: unown uninstall'
}

function Install-Binary {
  $platform = Get-Platform

  if ($platform -eq 'windows-arm64') {
    if (-not $Experimental) {
      Fail 'windows-arm64 has no CI runtime smoke - re-run with -Experimental to install it anyway'
    }
    Write-Host 'install.ps1: WARNING: windows-arm64 has no CI runtime smoke; installing anyway (-Experimental)'
  }

  $installRoot = ''
  if ($env:UNOWN_INSTALL_ROOT) {
    $installRoot = $env:UNOWN_INSTALL_ROOT
  } elseif ($env:LOCALAPPDATA) {
    $installRoot = Join-Path $env:LOCALAPPDATA 'unown'
  } else {
    $installRoot = Join-Path $HOME 'AppData\Local\unown'
  }
  $installRoot = [IO.Path]::GetFullPath($installRoot)

  $binDir = ''
  if ($env:UNOWN_BIN_DIR) {
    $binDir = $env:UNOWN_BIN_DIR
  } else {
    $binDir = Join-Path $HOME '.local\bin'
  }
  $binDir = [IO.Path]::GetFullPath($binDir).TrimEnd('\')
  $cmdPath = Join-Path $binDir 'unown.cmd'
  $ps1Path = Join-Path $binDir 'unown.ps1'
  if (-not $Force) {
    foreach ($existingShim in @($cmdPath, $ps1Path)) {
      if (-not (Test-ShimOurs $existingShim $installRoot)) {
        Fail "an existing command is at $existingShim and is not this binary install. Refusing to overwrite it; re-run with -Force to replace it, or uninstall the existing install first."
      }
    }
  }

  $releasesBase = $ReleasesBaseDefault
  if ($env:UNOWN_RELEASES_BASE_URL) {
    $releasesBase = $env:UNOWN_RELEASES_BASE_URL
  }
  $releasesBase = $releasesBase.TrimEnd('/')

  if ($script:RequestedVersion) {
    $releaseBase = "$releasesBase/download/v$($script:RequestedVersion)"
  } else {
    $releaseBase = "$releasesBase/latest/download"
  }

  $archiveName = "unown-$platform.zip"

  try {
    New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
  } catch {
    Fail "could not create the install root $installRoot (set UNOWN_INSTALL_ROOT to a writable directory)"
  }

  $tmp = Join-Path $installRoot ('.install-tmp-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null

  try {
    # version.txt is authoritative when present; the archive's VERSION file is
    # the fallback, and both must agree with an explicit -Version.
    $releaseVersion = ''
    $versionTxt = Join-Path $tmp 'version.txt'
    $haveVersionTxt = $false
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/version.txt" -OutFile $versionTxt
      $haveVersionTxt = $true
    } catch {
      $haveVersionTxt = $false
    }
    if ($haveVersionTxt) {
      $releaseVersion = ([string](Get-Content -Raw -LiteralPath $versionTxt)).Trim()
    }
    if ($releaseVersion) {
      if ($releaseVersion -notmatch '^\d+\.\d+\.\d+$') {
        Fail "the release's version.txt is not plain semver (got '$releaseVersion')"
      }
      if ($script:RequestedVersion -and $script:RequestedVersion -ne $releaseVersion) {
        Fail "pinned version v$($script:RequestedVersion) does not match version.txt ($releaseVersion) in that release"
      }
    }

    $archive = Join-Path $tmp $archiveName
    $sumsPath = Join-Path $tmp 'sha256sums.txt'

    Write-Host "install.ps1: downloading $archiveName from $releaseBase"
    Invoke-ReleaseDownload "$releaseBase/$archiveName" $archive
    Invoke-ReleaseDownload "$releaseBase/sha256sums.txt" $sumsPath

    $expected = $null
    foreach ($line in (Get-Content -LiteralPath $sumsPath)) {
      if ($line -match '^\s*([0-9a-fA-F]{64})\s+\*?(\S.*?)\s*$') {
        if ($Matches[2] -eq $archiveName) {
          $expected = $Matches[1].ToLowerInvariant()
          break
        }
      }
    }
    if (-not $expected) {
      Fail "no usable SHA-256 entry for $archiveName in $releaseBase/sha256sums.txt. Refusing to install an unverified download."
    }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
    if ($expected -ne $actual) {
      Fail "SHA-256 mismatch for ${archiveName}: expected $expected, got $actual. Refusing to install a corrupted or tampered download."
    }
    Write-Host "install.ps1: checksum verified ($actual)"

    $extract = Join-Path $tmp 'extract'
    New-Item -ItemType Directory -Path $extract | Out-Null
    try {
      Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
    } catch {
      Fail "could not extract $archiveName ($($_.Exception.Message))"
    }

    $stage = Join-Path $extract "unown-$platform"
    $stagedExe = Join-Path $stage 'unown.exe'
    $versionFile = Join-Path $stage 'VERSION'
    if (-not (Test-Path -LiteralPath $stagedExe)) {
      Fail "archive $archiveName does not contain unown-$platform\unown.exe"
    }
    if (-not (Test-Path -LiteralPath $versionFile)) {
      Fail "archive $archiveName has no VERSION file"
    }

    $archiveVersion = ([string](Get-Content -Raw -LiteralPath $versionFile)).Trim()
    if ($archiveVersion -notmatch '^\d+\.\d+\.\d+$') {
      Fail "the archive's VERSION file is not plain semver (got '$archiveVersion')"
    }
    if ($script:RequestedVersion -and $script:RequestedVersion -ne $archiveVersion) {
      Fail "version mismatch: -Version says $($script:RequestedVersion), the archive says $archiveVersion"
    }
    if ($releaseVersion -and $releaseVersion -ne $archiveVersion) {
      Fail "version mismatch: version.txt says $releaseVersion, the archive says $archiveVersion"
    }
    $installVersion = $archiveVersion

    # The builds are unsigned. SmartScreen's Mark-of-the-Web otherwise blocks
    # the version check; clearing it is best effort.
    try { Unblock-File -LiteralPath $stagedExe } catch { }

    try {
      $out = & $stagedExe --version
      $code = $LASTEXITCODE
    } catch {
      Fail "the downloaded binary failed to run ($($_.Exception.Message)). SmartScreen may have blocked this unsigned build: run 'Unblock-File $stagedExe' and retry."
    }
    $outText = (($out | Out-String).Trim())
    if ($code -ne 0) {
      Fail "the downloaded binary failed to run (exit $code, output: '$outText'). SmartScreen may have blocked this unsigned build: run 'Unblock-File $stagedExe' and retry."
    }
    if ($outText -cne $installVersion) {
      Fail "binary --version printed '$outText', expected '$installVersion'. Refusing to install a mismatched artifact."
    }

    # previousVersion: the same-mode install this one replaces (upgrade/reinstall)
    $previousVersion = ''
    if ($script:ExistingMode -eq 'binary' -and $script:ExistingVersion) {
      if ($script:ExistingVersion -ne $installVersion) {
        $previousVersion = $script:ExistingVersion
      } elseif ($script:ExistingPrev) {
        $previousVersion = $script:ExistingPrev
      }
    }

    # Move the verified tree into versions\<version>. A reinstall of the same
    # version swaps via a backup so a failure restores what was there.
    $versionsDir = Join-Path $installRoot 'versions'
    New-Item -ItemType Directory -Force -Path $versionsDir | Out-Null
    $final = Join-Path $versionsDir $installVersion
    $exeFinal = Join-Path $final 'unown.exe'
    # A same-version reinstall must not move a binary another process may be
    # running (Windows refuses to replace a mapped executable). If the version
    # dir verifies, reuse it and leave the staged copy for cleanup.
    $reuse = $false
    if (Test-Path -LiteralPath $exeFinal) {
      try {
        $existingOut = (& $exeFinal --version 2>&1 | Out-String).Trim()
        $reuse = ($LASTEXITCODE -eq 0 -and $existingOut -ceq $installVersion)
      } catch {
        $reuse = $false
      }
    }
    if ($reuse) {
      Write-Host "install.ps1: v$installVersion is already installed - reusing it"
    } else {
      $backup = $null
      if (Test-Path -LiteralPath $final) {
        $backup = Join-Path $tmp ('previous-' + $installVersion)
        try {
          Move-Item -LiteralPath $final -Destination $backup
        } catch {
          Fail "could not move the existing $final aside; nothing was changed"
        }
      }
      try {
        Move-Item -LiteralPath $stage -Destination $final
      } catch {
        if ($backup -and (Test-Path -LiteralPath $backup)) {
          Move-Item -LiteralPath $backup -Destination $final
        }
        Fail "could not move the verified install into $final; the previous version was left in place"
      }
      if ($backup -and (Test-Path -LiteralPath $backup)) {
        Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
      }
    }

    try {
      New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    } catch {
      Fail "could not create the bin directory $binDir (set UNOWN_BIN_DIR to a writable directory)"
    }

    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $cmdText = "@echo off`r`nset `"UNOWN_INSTALL_ROOT=$($installRoot.Replace('%', '%%'))`"`r`n`"$exeFinal`" %*`r`n"
    $ps1Text = "`$env:UNOWN_INSTALL_ROOT = '$($installRoot.Replace("'", "''"))'`r`n& '$($exeFinal.Replace("'", "''"))' @args`r`nexit `$LASTEXITCODE`r`n"
    $cmdTmp = "$cmdPath.tmp"
    $ps1Tmp = "$ps1Path.tmp"
    try {
      [IO.File]::WriteAllText($cmdTmp, $cmdText, $utf8)
      [IO.File]::WriteAllText($ps1Tmp, $ps1Text, $utf8)
      Move-Item -Force -LiteralPath $cmdTmp -Destination $cmdPath
      Move-Item -Force -LiteralPath $ps1Tmp -Destination $ps1Path
    } catch {
      Remove-Item -LiteralPath $cmdTmp -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $ps1Tmp -Force -ErrorAction SilentlyContinue
      Fail "could not replace the shims in ${binDir}: $($_.Exception.Message). Re-run the installer to retry."
    }

    # Metadata: ~/.unown/install.json (or $env:UNOWN_HOME), temp + rename.
    $unownHome = ''
    if ($env:UNOWN_HOME) {
      $unownHome = $env:UNOWN_HOME
    } else {
      $unownHome = Join-Path $HOME '.unown'
    }
    $unownHome = [IO.Path]::GetFullPath($unownHome)
    try {
      New-Item -ItemType Directory -Force -Path $unownHome | Out-Null
    } catch {
      Fail "could not create $unownHome for the install metadata (set UNOWN_HOME to a writable directory)"
    }
    $metaPath = Join-Path $unownHome 'install.json'
    $meta = [ordered]@{
      schema = 1
      mode = 'binary'
      version = $installVersion
      platform = $platform
      root = $installRoot
      bin = $exeFinal
      shim = $cmdPath
    }
    if ($previousVersion) { $meta['previousVersion'] = $previousVersion }
    $meta['installedAt'] = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    $json = ($meta | ConvertTo-Json -Compress)
    $metaTmp = "$metaPath.tmp"
    try {
      [IO.File]::WriteAllText($metaTmp, $json + "`n", $utf8)
    } catch {
      Fail "could not write $metaPath (the previous metadata was left untouched): $($_.Exception.Message)"
    }
    try {
      Move-Item -Force -LiteralPath $metaTmp -Destination $metaPath
    } catch {
      Remove-Item -LiteralPath $metaTmp -Force -ErrorAction SilentlyContinue
      Fail "could not write $metaPath (the previous metadata was left untouched)"
    }

    if ($NoModifyPath) {
      Write-Host "install.ps1: -NoModifyPath given - add this directory to PATH yourself:"
      Write-Host "  $binDir"
    } else {
      $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
      if ($null -eq $userPath) { $userPath = '' }
      $needle = $binDir.TrimEnd('\')
      $present = $false
      foreach ($entry in ($userPath -split ';')) {
        if ($entry.Trim().TrimEnd('\') -ieq $needle) {
          $present = $true
          break
        }
      }
      if (-not $present) {
        if ($userPath.Trim()) {
          $newPath = $userPath.TrimEnd(';') + ';' + $binDir
        } else {
          $newPath = $binDir
        }
        try {
          [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
          Write-Host "install.ps1: added $binDir to your user PATH."
        } catch {
          Write-Host "install.ps1: could not update the user PATH ($($_.Exception.Message))."
          Write-Host "  add this directory manually: $binDir"
        }
      }
      Write-Host 'install.ps1: restart your terminal (new window) before running unown.'
    }

    Write-Host ''
    Write-Host "unown $installVersion installed (binary)"
    Write-Host "  binary: $exeFinal"
    Write-Host "  shim:   $cmdPath (+ unown.ps1)"
    Write-Host ''
    Write-Host 'next steps:'
    Write-Host '  unown setup                 # connect a model provider'
    Write-Host '  unown doctor                # verify the chat path end to end'
    Write-Host '  unown update                # update this binary install'
    Write-Host ''
    Write-Host 'note: this is the CLI only - the engine/learning stack needs the source install:'
    Write-Host '  .\install.ps1 -Source'
    Write-Host ''
    Write-Host 'the release binaries are unsigned (no code-signing certificate).'
    Write-Host 'provenance check (optional, against the archive you downloaded):'
    Write-Host "  gh attestation verify $archiveName --repo kanishka-namdeo/Unown"
  } finally {
    if (Test-Path -LiteralPath $tmp) {
      Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Main {
  if ($Help) { Show-Usage; return }

  if (-not $HOME) {
    Fail 'HOME is not set - the installer needs it for the install root and shims'
  }

  if ($Binary -and $Main) {
    Fail '-Main and -Binary are mutually exclusive: -Binary installs a release archive, -Main clones the edge branch'
  }
  if ($Binary -and $script:DestBound) {
    Fail '-Dest is a source-mode flag; the binary install lives under UNOWN_INSTALL_ROOT and cannot use -Dest'
  }
  if ($Binary -and $Source) {
    Fail '-Binary and -Source are mutually exclusive: pick the CLI-only binary or the full-stack checkout'
  }
  if ($Main -and $Version) {
    Fail '-Main and -Version are mutually exclusive: pick the edge branch or a pinned release'
  }
  if ($script:DestBound -and -not $Dest) {
    Fail '-Dest needs a directory (for example: -Dest .\Unown)'
  }

  if ($Version) {
    $script:RequestedVersion = Normalize-Version $Version
  }

  # -Main and -Dest are source-mode flags: they select the full stack.
  $sourceMode = $Source -or $Main -or $script:DestBound
  $mode = 'binary'
  if ($sourceMode) { $mode = 'checkout' }

  # refuse admin: builds + PATH shims belong to a user account
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and $env:UNOWN_INSTALL_ALLOW_ROOT -ne '1') {
    Fail 'refusing to run as Administrator (override: $env:UNOWN_INSTALL_ALLOW_ROOT=1)'
  }

  # Existing install metadata: a mode change needs -Force.
  $unownHome = ''
  if ($env:UNOWN_HOME) {
    $unownHome = $env:UNOWN_HOME
  } else {
    $unownHome = Join-Path $HOME '.unown'
  }
  $unownHome = [IO.Path]::GetFullPath($unownHome)
  $metaPath = Join-Path $unownHome 'install.json'
  if (Test-Path -LiteralPath $metaPath) {
    $meta = $null
    try {
      $meta = Get-Content -Raw -LiteralPath $metaPath | ConvertFrom-Json
    } catch {
      $meta = $null
    }
    if ($null -eq $meta -or -not $meta.mode) {
      if (-not $Force) {
        Fail "cannot read the install mode from $metaPath. Refusing to guess; pass -Force to install the $mode mode anyway, or remove that file."
      }
    } else {
      $script:ExistingMode = [string]$meta.mode
      # The runtime writes "checkout"; accept the task's "source" spelling too.
      if ($script:ExistingMode -eq 'source') { $script:ExistingMode = 'checkout' }
      if ($meta.version) { $script:ExistingVersion = [string]$meta.version }
      if ($meta.shim) { $script:ExistingShim = [string]$meta.shim }
      if ($meta.previousVersion) { $script:ExistingPrev = [string]$meta.previousVersion }
      if ($script:ExistingMode -ne $mode -and -not $Force) {
        $where = ''
        if ($script:ExistingShim) { $where = " at $($script:ExistingShim)" }
        $hint = ''
        if ($mode -eq 'binary') {
          $hint = ' To keep the existing source install, re-run with -Source.'
        } else {
          $hint = ' To update the existing binary install, re-run without -Source.'
        }
        Fail "an existing $($script:ExistingMode) install is recorded$where ($metaPath); refusing to install the $mode mode over it.$hint Re-run with -Force to replace it, or uninstall the $($script:ExistingMode) install first."
      }
    }
  }

  # TLS 1.2 for Windows PowerShell 5.1; harmless where it is already the default.
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  } catch {
  }

  if ($mode -eq 'binary') {
    Install-Binary
  } else {
    Install-Source
  }
}

# Single entry point at the END of the file (truncated-download safety).
Main
