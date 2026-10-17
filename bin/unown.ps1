# unown.ps1 -- PowerShell launcher for the unown CLI (Windows).
# Resolves bun via Get-Command, then runs "<repo>\bin\unown" with it,
# propagating the exit code via $LASTEXITCODE. ASCII only; LF endings.
# NOTE: if script execution is disabled on your machine, run once:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

$bun = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bun) {
    Write-Host "unown: bun was not found on PATH. Install it with:"
    Write-Host '  powershell -c "irm bun.sh/install.ps1 | iex"'
    Write-Host "then open a NEW terminal and retry."
    exit 1
}

& $bun.Source "$PSScriptRoot/unown" @args
exit $LASTEXITCODE
