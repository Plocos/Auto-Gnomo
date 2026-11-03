# Descarga y ensambla el WebView2 Fixed Version Runtime para empaquetar con Tauri.
# Ejecutar desde la raíz del frontend (junto a package.json):
#   powershell -ExecutionPolicy Bypass -File ./scripts/fetch-webview2.ps1

param(
  [string]$Version = "154.0.4258.53",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$srcTauri = Join-Path $PSScriptRoot "..\src-tauri" | Resolve-Path
Set-Location $srcTauri

$dest = "Microsoft.WebView2.FixedVersionRuntime.$Version.x64"
$keepLocales = @("en-US.pak", "es.pak", "es-419.pak", "es-ES.pak", "es-MX.pak")

if (-not $Force -and (Test-Path "$dest\msedgewebview2.exe") -and (Test-Path "$dest\msedge.dll")) {
  $mb = [math]::Round(((Get-ChildItem $dest -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
  Write-Host "Ya existe $dest ($mb MB). Usa -Force para volver a descargar."
  exit 0
}

function Get-Nupkg($id, $ver, $folder) {
  $url = "https://api.nuget.org/v3-flatcontainer/$($id.ToLowerInvariant())/$ver/$($id.ToLowerInvariant()).$ver.nupkg"
  $zip = "$folder.zip"
  Write-Host "Descargando $id $ver ..."
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  if (Test-Path $folder) { Remove-Item $folder -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $folder -Force
  Remove-Item $zip -Force
}

Get-Nupkg "WebView2.Runtime.X64" $Version "webview2-nuget"
Get-Nupkg "WebView2.Runtime.X64.Core" $Version "webview2-core"
Get-Nupkg "WebView2.Runtime.Locales" $Version "webview2-locales"

if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest | Out-Null

Copy-Item "webview2-nuget\contentFiles\any\any\WebView2\*" $dest -Recurse -Force
Copy-Item "webview2-core\contentFiles\any\any\WebView2\*" $dest -Recurse -Force

$locSrc = Get-ChildItem -Recurse "webview2-locales" -Directory -Filter "Locales" | Select-Object -First 1
if ($locSrc) {
  New-Item -ItemType Directory -Path "$dest\Locales" -Force | Out-Null
  Get-ChildItem $locSrc.FullName -File |
    Where-Object { $keepLocales -contains $_.Name } |
    ForEach-Object { Copy-Item $_.FullName "$dest\Locales\" -Force }
}

Remove-Item "webview2-nuget", "webview2-core", "webview2-locales" -Recurse -Force

if (-not (Test-Path "$dest\msedgewebview2.exe") -or -not (Test-Path "$dest\msedge.dll")) {
  throw "Runtime incompleto en $dest"
}

$mb = [math]::Round(((Get-ChildItem $dest -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host "Listo: $dest ($mb MB)"
Write-Host "Configurado en tauri.conf.json -> bundle.windows.webviewInstallMode.path"
