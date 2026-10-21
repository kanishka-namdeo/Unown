# unown installer for Windows — the one-line bootstrap (PowerShell).
#
#   irm https://unown-nine.vercel.app/install.ps1 | iex
#
# or pinned to a release:
#   irm https://unown-nine.vercel.app/install.ps1 -OutFile install.ps1
#   .\install.ps1 -Version v2.1.0
#
# Windows-native twin of public/install.sh (same contract): checks git,
# checks/installs bun (bun's own PowerShell installer), clones the repo
# (default: main; -Version pins a release tag), and runs the repo's own
# installer (bun run agent:install) which builds everything and puts `unown`
# on your PATH (%USERPROFILE%\.local\bin\unown.cmd + unown.ps1).
#
# irm|iex mitigations implemented here (the standard set):
#   - param + [CmdletBinding()] parsing runs BEFORE anything executes; the
#     script body is one main function invoked at the END, so a truncated
#     download cannot execute half of itself
#   - $ErrorActionPreference = 'Stop': fail fast, no half-installs
#   - -Version / -Dest parameters; -Help; ASCII only; CRLF-safe
#   - review-before-running works too:
#       irm https://unown-nine.vercel.app/install.ps1 -OutFile install.ps1
#       Get-Content .\install.ps1   # review it
#       .\install.ps1
#   - integrity: the clone comes over HTTPS from GitHub; releases are git
#     tags with SLSA build-provenance attestations on the GitHub Release
#
# The script is served from the repo's Vercel deployment (public/install.ps1
# in the repository — https://github.com/kanishka-namdeo/Unown).

[CmdletBinding()]
param(
  [string]$Version = "",
  [string]$Dest = "Unown",
  [switch]$Help
)

$ErrorActionPreference = 'Stop'
$Repo = 'https://github.com/kanishka-namdeo/Unown.git'

function Show-Usage {
  Write-Host @'
unown installer (Windows)

  .\install.ps1 [-Version vX.Y.Z] [-Dest DIR]

  -Version   pin to a release tag (default: main branch)
  -Dest      clone directory (default: .\Unown)
  -Help      this help

After install: unown setup   (connect a model)
              unown doctor   (verify)
              unown update   (stay current)

NOTE: `irm ... | iex` runs with the parameters above at their defaults; to
pin a version, download the script first and run it with -Version.
'@
}

function Main {
  if ($Help) { Show-Usage; return }

  # refuse admin: builds + PATH shims belong to a user account
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and $env:UNOWN_INSTALL_ALLOW_ROOT -ne '1') {
    Write-Error 'install.ps1: refusing to run as Administrator (override: $env:UNOWN_INSTALL_ALLOW_ROOT=1)'
  }

  # git
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error 'install.ps1: git is required (https://git-scm.com — the standard Git-for-Windows install is fine)'
  }

  # bun (bootstrap via bun's own PowerShell installer when missing)
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host 'install.ps1: bun not found - installing it (https://bun.sh)'
    irm bun.sh/install.ps1 | iex
    # bun lands in %USERPROFILE%\.bun\bin; make it visible for THIS script
    $bunBin = Join-Path $env:USERPROFILE '.bun\bin'
    if ((Test-Path $bunBin) -and ($env:PATH -notlike "*$bunBin*")) {
      $env:PATH = "$bunBin;$env:PATH"
    }
    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
      Write-Error 'install.ps1: bun install failed - install it manually (irm bun.sh/install.ps1 | iex), then re-run'
    }
  }

  # clone
  if (Test-Path $Dest) {
    Write-Error "install.ps1: $Dest already exists - remove it or pass -Dest DIR"
  }
  if ($Version) {
    Write-Host "install.ps1: cloning Unown at $Version into .\$Dest"
    git clone --quiet --branch $Version $Repo $Dest
    if ($LASTEXITCODE -ne 0) { Write-Error "install.ps1: git clone failed (exit $LASTEXITCODE)" }
  } else {
    Write-Host "install.ps1: cloning Unown (main) into .\$Dest"
    git clone --quiet $Repo $Dest
    if ($LASTEXITCODE -ne 0) { Write-Error "install.ps1: git clone failed (exit $LASTEXITCODE)" }
  }

  # install (deps + pi build + .env + PATH shims) - UNOWN_NO_LINK is 0 by
  # default; scripts/link.ts writes the .cmd/.ps1 shims and appends the user
  # PATH via the registry (never setx).
  Push-Location $Dest
  try {
    bun run agent:install
    if ($LASTEXITCODE -ne 0) { Write-Error "install.ps1: agent:install failed (exit $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }

  Write-Host ''
  Write-Host 'next steps:'
  Write-Host "  cd $Dest; unown setup     # connect a model provider"
  Write-Host '  unown doctor               # verify the chat path end to end'
  Write-Host '  unown update               # stay current (self-update)'
  Write-Host ''
  Write-Host 'Windows note: if the PATH was just updated, restart your terminal;'
  Write-Host 'PowerShell may need "Set-ExecutionPolicy -Scope CurrentUser RemoteSigned" once for the .ps1 shim.'
  Write-Host 'uninstall anytime: unown uninstall'
}

# Single entry point at the END of the file (truncated-download safety).
Main
