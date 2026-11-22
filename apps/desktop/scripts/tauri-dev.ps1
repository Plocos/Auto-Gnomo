# Asegura cargo/rustup en PATH (la terminal a veces no hereda el PATH nuevo del usuario).
$ErrorActionPreference = "Stop"
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path (Join-Path $cargoBin "cargo.exe")) {
  $env:Path = "$cargoBin;" + $env:Path
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "cargo no está en el PATH. Instala Rust (rustup) y reintenta."
}
Set-Location (Join-Path $PSScriptRoot "..")
# En desarrollo se usa el WebView2 del sistema. El runtime embebido solo hace falta en el instalador.
& pnpm exec tauri dev --config ./src-tauri/tauri.dev.json @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
