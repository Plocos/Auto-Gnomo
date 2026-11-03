# Asegura cargo/rustup en PATH (apps GUI / pnpm a veces no heredan el PATH del usuario).
$ErrorActionPreference = "Stop"
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path (Join-Path $cargoBin "cargo.exe")) {
  $env:Path = "$cargoBin;" + $env:Path
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "cargo no está en el PATH. Instala Rust (rustup) y reintenta."
}
Set-Location (Join-Path $PSScriptRoot "..")
& pnpm exec tauri build @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
