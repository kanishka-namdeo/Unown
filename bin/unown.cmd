@echo off
rem unown.cmd -- cmd.exe launcher for the unown CLI (Windows).
rem Resolves bun.exe on PATH with "where bun" (first hit), then runs
rem "<repo>\bin\unown" with it, propagating the exit code. ASCII only; LF
rem line endings (cmd handles LF fine). No goto/labels on purpose: label
rem scanning is unreliable in LF-only batch files, so the whole launcher is
rem label-free. Paths with spaces work because every expansion is quoted.

where bun >nul 2>nul
if errorlevel 1 (
    echo unown: bun was not found on PATH. Install it with:
    echo   powershell -c "irm bun.sh/install.ps1 | iex"
    echo then open a NEW terminal and retry.
    exit /b 1
)

set "BUN_EXE="
for /f "delims=" %%i in ('where bun') do (
    if not defined BUN_EXE set "BUN_EXE=%%i"
)

@"%BUN_EXE%" "%~dp0unown" %*
exit /b %errorlevel%
